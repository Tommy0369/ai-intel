import { mkdir, writeFile, rm } from "node:fs/promises";
import path from "node:path";
import { assertDataRootReady, ensureLayout } from "./disk.js";
import { nowIso } from "./http.js";
import {
  clusterCorpus,
  type ClusterMember,
  type ClusterOptions,
  type TopicCluster,
} from "./cluster.js";
import { resolveBridgeRoot } from "./ship.js";
import { loadCatalog } from "./corpus.js";
import type { AppConfig, CatalogEntry, SourceKind } from "./types.js";
import {
  enrichCluster,
  enrichEntries,
  enrichSnippet,
  loadEnrichMapResolved,
  uniqueEnrichCoverage,
  type EnrichRecord,
} from "./enrich.js";
import { selectUniqueMembers } from "./enrich-canonicalize.js";

function todayStamp(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function runStamp(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

/**
 * フォルダ名用の安全スラッグ（日本語可・パス危険文字のみ除去）。
 */
function folderSlug(raw: string, max = 40): string {
  const s = (raw ?? "")
    .replace(/[\/\\:*?"<>|]+/g, "-")
    .replace(/\s+/g, "")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, max)
    .replace(/^-+|-+$/g, "");
  return s || "topic";
}

/**
 * 話題フォルダ名: 01_biz_マーケ・事業：日経クロストレンドBtoB大賞
 * （一覧で中身が分かる日本語タイトル優先）
 */
function topicFolderName(cluster: TopicCluster): string {
  const nn = String(cluster.index).padStart(2, "0");
  const cat = folderSlug(cluster.category, 16);
  const topic =
    folderSlug(cluster.titleJa, 56) ||
    folderSlug(cluster.label, 48) ||
    `topic-${cluster.index}`;
  return `${nn}_${cat}_${topic}`;
}

function clip(s: string, n: number): string {
  const t = (s ?? "").replace(/\s+/g, " ").trim();
  return t.length <= n ? t : `${t.slice(0, n - 1)}…`;
}

/** URL・Markdown記号を落として本文だけにする（LLM不使用の整形のみ） */
function cleanText(s: string): string {
  return (s ?? "")
    .replace(/https?:\/\/\S+/g, "")
    .replace(/^#+\s*/gm, "")
    .replace(/[`*_>#]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function dateOnly(iso?: string): string {
  if (!iso) return "";
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return iso.slice(0, 10);
  return new Date(t).toISOString().slice(0, 10);
}

/** まとまりの強さ（メンバー数から素朴に導出。データ由来のみ） */
export type Relatedness = "高" | "中" | "低";
function relatednessOf(size: number): Relatedness {
  if (size >= 10) return "高";
  if (size >= 4) return "中";
  return "低";
}

/** クラスタ内の出典分布（実データ） */
function sourceBreakdown(cluster: TopicCluster): Record<string, number> {
  const out: Record<string, number> = {};
  for (const m of cluster.members) {
    out[m.source] = (out[m.source] ?? 0) + 1;
  }
  return out;
}

/** 代表記事: 要約が最も長いものを選ぶ（なければ先頭） */
function representativeMember(cluster: TopicCluster): ClusterMember {
  let best = cluster.members[0];
  for (const m of cluster.members) {
    if ((m.summary?.length ?? 0) > (best.summary?.length ?? 0)) best = m;
  }
  return best;
}

function memberDisplayTitle(m: ClusterMember): string {
  return (m.titleJa && m.titleJa.trim()) || m.title;
}

function topicTitle(cluster: TopicCluster): string {
  return cluster.titleJa?.trim() || cluster.label;
}

/** よく出るAI関連の固有名（正規表記） */
const KNOWN_ENTITIES = [
  "OpenAI", "Anthropic", "Google", "DeepMind", "Gemini", "ChatGPT", "GPT-5",
  "GPT-4", "GPT", "Claude", "Llama", "Meta", "Microsoft", "Copilot", "NVIDIA",
  "Mistral", "DeepSeek", "Qwen", "Hugging Face", "HuggingFace", "LangChain",
  "LlamaIndex", "Perplexity", "Cohere", "Stability AI", "Midjourney", "Apple",
  "Amazon", "AWS", "Azure", "Reddit", "GitHub", "YouTube", "Nemotron", "Grok",
  "xAI", "Runway", "Sora", "Vercel", "Notion", "Slack",
];

const ENTITY_STOP = new Set([
  "The", "This", "That", "These", "Those", "With", "From", "How", "What",
  "When", "Why", "New", "AI", "And", "For", "Your", "Our", "Here", "There",
]);

/** タイトル+要約から人物/企業/モデル/サービス等をローカル抽出（LLM不使用） */
function extractEntities(cluster: TopicCluster): string[] {
  const blob = cluster.members
    .map((m) => `${m.title} ${m.summary}`)
    .join("\n");
  const found = new Map<string, number>();

  for (const name of KNOWN_ENTITIES) {
    const re = new RegExp(
      `\\b${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`,
      "gi",
    );
    const hits = (blob.match(re) || []).length;
    if (hits) found.set(name, (found.get(name) ?? 0) + hits * 10);
  }

  const caps =
    blob.match(/\b[A-Z][a-zA-Z0-9]+(?:\s+[A-Z][a-zA-Z0-9]+){0,2}\b/g) ?? [];
  for (const raw of caps) {
    const term = raw.trim();
    if (term.length < 3) continue;
    if (ENTITY_STOP.has(term)) continue;
    if (found.has(term)) continue;
    if (KNOWN_ENTITIES.some((k) => k.toLowerCase() === term.toLowerCase())) {
      continue;
    }
    found.set(term, (found.get(term) ?? 0) + 1);
  }

  const kata = blob.match(/[\u30a0-\u30ff]{3,}/g) ?? [];
  for (const k of kata) found.set(k, (found.get(k) ?? 0) + 1);

  return [...found.entries()]
    .filter(([, n]) => n >= 2 || n >= 10)
    .sort((a, b) => b[1] - a[1])
    .map(([term]) => term)
    .slice(0, 15);
}

/** クラスタの短い要点（ローカル整理。事実はSource側に置く） */
function extractiveOverview(cluster: TopicCluster): string {
  const topics = cluster.keywords.slice(0, 4).join(" / ");
  const rep = representativeMember(cluster);
  const head = topics ? `主な論点は「${topics}」。` : "";
  return clip(
    `${cluster.size} 件の近い話題を束ねた文脈。${head}代表例:「${memberDisplayTitle(rep)}」`,
    240,
  );
}

/** タイトル正規化（重複判定用） */
function normalizeTitleKey(title: string): string {
  return title
    .replace(/^【[^】]+】\s*/g, "")
    .replace(/【お知らせ】|【告知】/g, "")
    .replace(/[…．.。!！?？「」『』【】\[\]()（）]/g, "")
    .replace(/\s+/g, "")
    .slice(0, 48)
    .toLowerCase();
}

interface DedupedMember {
  key: string;
  title: string;
  members: ClusterMember[];
  summary: string;
  date: string;
}

/** ほぼ同じタイトルを1件にまとめる */
function dedupeMembers(members: ClusterMember[]): DedupedMember[] {
  const map = new Map<string, DedupedMember>();
  for (const m of members) {
    const title = memberDisplayTitle(m);
    const key = normalizeTitleKey(title) || m.id;
    const prev = map.get(key);
    if (!prev) {
      map.set(key, {
        key,
        title,
        members: [m],
        summary: cleanText(m.summary),
        date: dateOnly(m.date),
      });
      continue;
    }
    prev.members.push(m);
    if ((m.summary?.length ?? 0) > (prev.summary?.length ?? 0)) {
      prev.summary = cleanText(m.summary);
    }
    const d = dateOnly(m.date);
    if (d && (!prev.date || d < prev.date)) prev.date = d;
  }
  return [...map.values()];
}

const SUBTOPIC_RULES: Array<{ id: string; label: string; re: RegExp }> = [
  { id: "award", label: "受賞・表彰・ランキング", re: /大賞|受賞|award|prize|rank|表彰|グランプリ/i },
  { id: "course", label: "講座・セミナー・説明会", re: /講座|セミナー|説明会|ウェビナー|course|workshop|lecture/i },
  { id: "forecast", label: "予測・展望・トレンド分析", re: /予測|展望|2030|forecast|outlook|trend|大予測/i },
  { id: "ops", label: "営業・オペレーション改革", re: /営業|改革|オペ|operation|sales transform|工程/i },
  { id: "pricing", label: "料金・価格・コスト", re: /料金|価格|コスト|price|cost|billing|mrr|arr/i },
  { id: "funding", label: "資金・IPO・買収", re: /資金|調達|ipo|買収|funding|acquire|投資/i },
  { id: "product", label: "製品・発表・リリース", re: /発表|リリース|launch|announce|製品|出荷/i },
  { id: "safety", label: "安全・規制・権利", re: /安全|規制|著作権|lawsuit|align|jailbreak|権利/i },
  { id: "agent", label: "エージェント・自動化", re: /agent|エージェント|automat|orchestr/i },
  { id: "health", label: "健康・睡眠・運動", re: /睡眠|運動|筋トレ|nutrition|sleep|fitness|workout/i },
  { id: "dining", label: "飲食・店舗運営", re: /飲食|店舗|restaurant|menu|外食/i },
  { id: "marketing", label: "マーケ・集客・成長", re: /マーケ|集客|marketing|growth|funnel|顧客/i },
  { id: "review", label: "レビュー文献・メタ分析", re: /systematic review|meta[- ]?analysis|scoping review|システマティック|メタアナリシス|レビュー論文/i },
];

function subtopicOf(m: ClusterMember): { id: string; label: string } {
  const hay = `${m.titleJa ?? ""} ${m.title} ${m.summary ?? ""}`;
  for (const r of SUBTOPIC_RULES) {
    if (r.re.test(hay)) return { id: r.id, label: r.label };
  }
  return { id: "other", label: "その他・周辺トピック" };
}

function groupBySubtopic(
  members: ClusterMember[],
): Array<{ label: string; items: DedupedMember[] }> {
  const buckets = new Map<string, { label: string; raw: ClusterMember[] }>();
  for (const m of members) {
    const st = subtopicOf(m);
    const b = buckets.get(st.id) ?? { label: st.label, raw: [] };
    b.raw.push(m);
    buckets.set(st.id, b);
  }
  return [...buckets.values()]
    .map((b) => ({ label: b.label, items: dedupeMembers(b.raw) }))
    .sort((a, b) => b.items.length - a.items.length);
}

/**
 * NotebookLM にそのまま渡せる CONTEXT.md を生成（LLM不使用・extractive）。
 * 重複統合・論点細分化・時系列フェーズまで含める。
 */
function enrichStats(cluster: TopicCluster, enrich?: Map<string, EnrichRecord>) {
  if (!enrich) {
    return {
      withBody: 0,
      failed: 0,
      total: cluster.members.length,
      uniqueTotal: 0,
      coverage: 0,
      representativeOk: false,
    };
  }
  const cov = uniqueEnrichCoverage(cluster.members, enrich);
  return {
    withBody: cov.withBody,
    failed: cov.failed,
    total: cluster.members.length,
    uniqueTotal: cov.uniqueTotal,
    coverage: cov.coverage,
    representativeOk: cov.representativeOk,
  };
}

function renderEnrichBlock(
  m: { id: string; summary: string },
  enrich?: Map<string, EnrichRecord>,
  max = 1800,
): string[] {
  const r = enrich?.get(m.id);
  const lines: string[] = [];
  if (r?.text) {
    const label = r.kind === "transcript" ? "字幕（抽出）" : "本文（抽出）";
    lines.push(`#### ${label}`, "");
    const got = r.canonicalUrl || r.finalUrl;
    if (got && got !== r.url) {
      lines.push(`- 取得URL: ${got}`);
    }
    if (r.lang) lines.push(`- 言語: ${r.lang}`);
    lines.push(`- 文字数: ${r.chars}`, "");
    lines.push(enrichSnippet(r, max), "");
  } else if (r?.status === "failed") {
    lines.push(
      `#### 向こう側（未取得）`,
      "",
      `取得失敗: ${r.error || "unknown"}。URLのみ。`,
      "",
    );
  } else {
    lines.push(
      `#### 向こう側（未取得）`,
      "",
      `まだ本文/字幕を取得していません（URLと要約のみ）。`,
      "",
    );
  }
  return lines;
}

function memberBestUrl(
  m: { id: string; url: string },
  enrich?: Map<string, EnrichRecord>,
): string {
  const r = enrich?.get(m.id);
  const cand = r?.canonicalUrl || r?.finalUrl || m.url;
  if (cand && !/news\.google\.com/i.test(cand)) return cand;
  return m.url;
}

function buildContextMarkdown(
  cluster: TopicCluster,
  stamp: string,
  enrich?: Map<string, EnrichRecord>,
): string {
  const rep = representativeMember(cluster);
  const title = topicTitle(cluster);
  const unique = dedupeMembers(cluster.members);
  const subtopics = groupBySubtopic(cluster.members);
  const entities = extractEntities(cluster);
  const er = enrichStats(cluster, enrich);
  const lines: string[] = [];

  lines.push(`# ${title}`, "");
  lines.push(
    `> このファイルは収集記事から**ローカル生成**した文脈です（外部AI不使用）。`,
    `> 同じ話題の記事を重複統合し、論点ごとに細分化してあります。`,
    `> 可能なら URL の向こう側（本文・字幕）も埋め込んでいます。`,
    "",
    `- 生成: ${stamp}`,
    `- 分野: ${cluster.category}`,
    `- 記事数: ${cluster.members.length}（ユニーク見出し ${unique.length}）`,
    `- まとまり: ${relatednessOf(cluster.size)}`,
    `- 細分化トピック: ${subtopics.length}`,
    `- 向こう側取得（ユニーク記事）: ${er.withBody}/${er.uniqueTotal || unique.length} 件` +
      `（カバレッジ ${Math.round((er.coverage || 0) * 100)}%` +
      (er.failed ? ` / 失敗 ${er.failed}` : "") +
      `）`,
    `- 生URL件数: ${er.total}（重複含む。失敗感はユニーク基準で見る）`,
    er.representativeOk
      ? `- 品質: 本文あり（NotebookLM投入可）`
      : `- 品質: 本文なし（URLと要約のみ。bodies/ を確認）`,
    "",
  );

  lines.push(`## 1. この話題の要点`, "");
  lines.push(extractiveOverview(cluster), "");
  lines.push(`- 代表記事: ${memberDisplayTitle(rep)}`);
  lines.push(
    `- 読み方: まず「論点の細分化」で全体像を掴み、必要なら各出典を掘る`,
    "",
  );

  lines.push(`## 2. 論点の細分化`, "");
  lines.push(
    `このまとまりを **${subtopics.length} つの小トピック** に分けた。`,
    "",
  );
  subtopics.forEach((st, i) => {
    const letter = String.fromCharCode("A".charCodeAt(0) + i);
    lines.push(`### ${letter}. ${st.label}（${st.items.length}件）`, "");
    for (const item of st.items) {
      const urls =
        item.members.length > 1
          ? ` 〔出典 ${item.members.length} 件〕`
          : "";
      lines.push(`- **${clip(item.title, 80)}**${urls}`);
      if (item.summary) lines.push(`  - ${clip(item.summary, 160)}`);
      else lines.push(`  - （要約なし・タイトルのみ）`);
    }
    lines.push("");
  });

  lines.push(`## 3. 重複と差分`, "");
  const dups = unique.filter((u) => u.members.length > 1);
  if (dups.length) {
    lines.push(
      `同じ（またはほぼ同じ）見出しが複数ソースから来ているもの:`,
      "",
    );
    for (const d of dups) {
      lines.push(`- **${clip(d.title, 70)}** × ${d.members.length}`);
      for (const m of d.members) {
        lines.push(
          `  - ${m.source}${memberBestUrl(m, enrich) ? ` — ${memberBestUrl(m, enrich)}` : ""}`,
        );
      }
    }
  } else {
    lines.push(`明確な重複見出しは少ない。視点の違いを個別に確認すること。`);
  }
  lines.push("");

  lines.push(`## 4. コア文脈（要約の長い順）`, "");
  const core = [...unique]
    .sort((a, b) => (b.summary?.length ?? 0) - (a.summary?.length ?? 0))
    .slice(0, 8);
  for (const m of core) {
    lines.push(`- ${clip(m.summary || m.title, 220)}`);
  }
  lines.push("");

  lines.push(`## 5. キーワード`, "");
  for (const kw of cluster.keywords.slice(0, 10)) lines.push(`- ${kw}`);
  if (!cluster.keywords.length) lines.push("- （キーワード抽出なし）");
  lines.push("");

  lines.push(`## 6. 主要エンティティ`, "");
  if (entities.length) {
    for (const e of entities) lines.push(`- ${e}`);
  } else {
    lines.push("- （固有名の抽出なし）");
  }
  lines.push("");

  const dated = [...cluster.members]
    .map((m) => ({
      date: dateOnly(m.date),
      title: memberDisplayTitle(m),
      source: m.source,
    }))
    .filter((x) => x.date)
    .sort((a, b) => a.date.localeCompare(b.date));
  if (dated.length) {
    lines.push(`## 7. 時系列の流れ`, "");
    const first = dated[0].date;
    const last = dated[dated.length - 1].date;
    lines.push(`期間: ${first} 〜 ${last}`, "");
    // 日付ごとにまとめる
    const byDay = new Map<string, typeof dated>();
    for (const d of dated) {
      const arr = byDay.get(d.date) ?? [];
      arr.push(d);
      byDay.set(d.date, arr);
    }
    for (const [day, items] of byDay) {
      lines.push(`### ${day}`, "");
      const seen = new Set<string>();
      for (const it of items) {
        const k = normalizeTitleKey(it.title);
        if (seen.has(k)) continue;
        seen.add(k);
        lines.push(`- ${clip(it.title, 90)} \`(${it.source})\``);
      }
      lines.push("");
    }
  }

  lines.push(`## 8. 出典サマリー（全件・向こう側込み）`, "");
  cluster.members.forEach((m, i) => {
    const st = subtopicOf(m);
    lines.push(
      `### ${String(i + 1).padStart(2, "0")}. ${memberDisplayTitle(m)}`,
    );
    lines.push(`- 小トピック: ${st.label}`);
    lines.push(`- 出典: ${m.source} / ${m.category}`);
    lines.push(`- 日付: ${dateOnly(m.date) || "—"}`);
    lines.push(`- タグ: ${m.tags.length ? m.tags.join(", ") : "—"}`);
    if (m.url) lines.push(`- URL: ${memberBestUrl(m, enrich)}`);
    lines.push("");
    lines.push("#### フィード要約", "");
    lines.push(cleanText(m.summary) || "（要約なし。タイトルのみ）");
    lines.push("");
    lines.push(...renderEnrichBlock(m, enrich, 2200));
  });

  lines.push(`## 9. 出典一覧`, "");
  cluster.members.forEach((m, i) => {
    const idx = String(i + 1).padStart(2, "0");
    const best = memberBestUrl(m, enrich);
    const url = best ? ` — ${best}` : "";
    lines.push(`- ${idx}: \`${m.id}\`${url}`);
  });
  lines.push("");

  lines.push(`## 10. NotebookLMへの使い方`, "");
  lines.push(
    `1. このフォルダの \`CONTEXT.md\` と \`bodies/\` 内の本文ファイルをアップロード（本丸は bodies）`,
    `2. 必要なら \`SOURCES.md\` も追加`,
    `3. \`PROMPT.md\` の指示を貼る`,
    `4. 「細分化トピックごとに要約」「重複を統合」「事業への示唆」を依頼`,
    "",
  );

  return lines.join("\n");
}

function clusterManifest(cluster: TopicCluster, stamp: string, folder: string) {
  return {
    schema: "ai-intel-notebook.cluster.v2",
    stamp,
    index: cluster.index,
    titleJa: cluster.titleJa,
    label: cluster.label,
    slug: cluster.slug,
    folder,
    category: cluster.category,
    keywords: cluster.keywords,
    size: cluster.size,
    relatedness: relatednessOf(cluster.size),
    bySource: sourceBreakdown(cluster),
    representativeTitle: memberDisplayTitle(representativeMember(cluster)),
    entities: extractEntities(cluster),
    members: cluster.members.map((m) => ({
      id: m.id,
      title: m.title,
      titleJa: m.titleJa,
      source: m.source,
      category: m.category,
      date: dateOnly(m.date),
      tags: m.tags,
      url: m.url,
    })),
    files: {
      context: "CONTEXT.md",
      sourcesMd: "SOURCES.md",
      prompt: "PROMPT.md",
      sourcesTxt: "sources.txt",
      bodies: "bodies/",
      manifest: "manifest.json",
    },
  };
}

function safeBodyName(index: number, title: string, id: string): string {
  const slug = title
    .replace(/【[^】]*】/g, "")
    .replace(/[^\w\u3040-\u30ff\u4e00-\u9fff]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "")
    .slice(0, 40);
  return `${String(index).padStart(2, "0")}_${slug || id.slice(0, 12)}.md`;
}

/** NotebookLM用の本文バンドル（ユニーク×本文ありのみ） */
function buildBodyFiles(
  cluster: TopicCluster,
  enrich: Map<string, EnrichRecord>,
): Array<{ name: string; body: string; id: string }> {
  const fakeEntries = cluster.members.map((m) => ({
    id: m.id,
    title: m.title,
    title_ja: m.titleJa,
    url: m.url,
    source: m.source as import("./types.js").SourceKind,
    category: m.category,
    collected_at: "",
    tags: m.tags,
    lang: "en",
    path: "",
  }));
  const unique = selectUniqueMembers(fakeEntries);
  const files: Array<{ name: string; body: string; id: string }> = [];
  let n = 0;
  for (const u of unique) {
    const r =
      enrich.get(u.entry.id) ||
      u.aliases.map((a) => enrich.get(a.id)).find(Boolean);
    if (!r?.text) continue;
    n++;
    const title = r.title || u.entry.title_ja || u.entry.title;
    const name = safeBodyName(n, title, u.entry.id);
    const body = [
      `# ${title}`,
      "",
      `- id: ${u.entry.id}`,
      `- kind: ${r.kind}`,
      `- url: ${r.finalUrl || r.url}`,
      r.url !== (r.finalUrl || r.url) ? `- collectedUrl: ${r.url}` : "",
      r.strategy ? `- strategy: ${r.strategy}` : "",
      `- chars: ${r.chars}`,
      u.aliases.length
        ? `- duplicatesCollapsed: ${u.aliases.length}`
        : "",
      "",
      r.kind === "transcript" ? "## 字幕" : "## 本文",
      "",
      r.text,
      "",
    ]
      .filter((l) => l !== "")
      .join("\n");
    files.push({ name, body, id: u.entry.id });
  }
  return files;
}

function renderSourcesMd(
  cluster: TopicCluster,
  stamp: string,
  enrich?: Map<string, EnrichRecord>,
): string {
  const title = topicTitle(cluster);
  const er = enrichStats(cluster, enrich);
  const lines = [
    `# まとめ元記事 — ${title}`,
    "",
    `生成: ${stamp}`,
    `分野: ${cluster.category}`,
    `件数: ${cluster.members.length}（ユニーク ${er.uniqueTotal}）`,
    `向こう側取得（ユニーク）: ${er.withBody}/${er.uniqueTotal}（カバレッジ ${Math.round((er.coverage || 0) * 100)}%）`,
  ];
  if (cluster.keywords.length) {
    lines.push(`共通キーワード: ${cluster.keywords.join(", ")}`);
  }
  lines.push(
    "",
    "これは **同じ話題** と判定された複数記事の集約です。",
    "本丸の本文は `bodies/` フォルダ。ここには抜粋とメタデータも載せます。",
    "このフォルダごと NotebookLM の新しいノートブックにアップロードして、",
    "重複を除いた統合要約・コンテンツを作らせてください。",
    "",
    "---",
    "",
  );

  cluster.members.forEach((m, i) => {
    lines.push(`## ${i + 1}. ${m.titleJa || m.title}`);
    lines.push("");
    if (m.titleJa && m.titleJa !== m.title) {
      lines.push(`- 原題: ${m.title}`);
    }
    lines.push(`- URL: ${memberBestUrl(m, enrich)}`);
    lines.push(`- 出典: ${m.source} / ${m.category}`);
    lines.push(`- id: \`${m.id}\``);
    lines.push("");
    lines.push("### 要約");
    lines.push("");
    lines.push(m.summary?.trim() || "_要約なし（タイトルと URL のみ）_");
    lines.push("");
    const r = enrich?.get(m.id);
    if (r?.text) {
      lines.push(r.kind === "transcript" ? "### 字幕" : "### 本文");
      lines.push("");
      lines.push(enrichSnippet(r, 12000));
      lines.push("");
    } else {
      lines.push("### 向こう側");
      lines.push("");
      lines.push(
        r?.error
          ? `_未取得: ${r.error}_`
          : "_未取得（URLのみ。enrich を実行すると本文/字幕が入る）_",
      );
      lines.push("");
    }
    lines.push("---");
    lines.push("");
  });

  return lines.join("\n");
}

function renderClusterPrompt(cluster: TopicCluster): string {
  const title = topicTitle(cluster);
  const subs = groupBySubtopic(cluster.members)
    .map((s) => `- ${s.label}（${s.items.length}件）`)
    .join("\n");
  return `# NotebookLM への指示（貼り付け用）

あなたは情報整理アシスタントです。
アップロードした \`bodies/\`（記事本文）と \`CONTEXT.md\`（論点・重複整理）を材料に、日本語でコンテンツを作ってください。
本文の一次情報は **bodies/** を優先し、CONTEXT は地図として使ってください。

対象トピック: **${title}**
分野: ${cluster.category} / 記事数: ${cluster.members.length}

すでに CONTEXT.md では次の小トピックに細分化済みです:
${subs || "- （細分化なし）"}

## やってほしいこと

1. 各小トピックごとに「要点3行」を書く
2. 記事どうしで **重複している内容** はまとめ、**食い違い・違う視点** は分けて示す
3. 事実と意見・推測を分ける
4. それぞれの主張には元記事のURLを添える
5. 事業・発信への示唆を3つ（行動できる粒度で）
6. 最後に「で、結局どういうこと?」を中学生にも分かる1段落で

## 制約

- 元記事にないことは推測で埋めず「要確認」と書く
- YouTube 由来はタイトルとURLのみの場合がある（中身を作りすぎない）
- bodies に無い主張は作らない
`;
}

function renderIndexMd(
  stamp: string,
  clusters: Array<TopicCluster & { folder: string }>,
  totalItems: number,
): string {
  const lines = [
    `# Notebook 話題フォルダ INDEX — ${stamp}`,
    "",
    `生成: ${nowIso()}`,
    `全収集(読込成功): ${totalItems} 件`,
    `話題フォルダ: ${clusters.length} 個`,
    "",
    "情報収集班の収集物から、**内容が近い記事**をカテゴリ内で細かく束ねたもの。",
    "**フォルダ1つ = NotebookLM のノートブック1つ** を想定しています。",
    "",
    "## 使い方",
    "",
    "1. 下の表から話題フォルダを選ぶ",
    "2. NotebookLM で新しいノートブックを作り、タイトルに日本語トピック名を使う",
    "3. そのフォルダの `CONTEXT.md` と `bodies/*.md`（本丸）をアップロード",
    "4. `PROMPT.md` の指示を貼って要約・コンテンツを作らせる",
    "",
    "| # | 分野 | 日本語タイトル | 件数 | フォルダ |",
    "|---|------|----------------|------|----------|",
  ];
  for (const c of clusters) {
    lines.push(
      `| ${c.index} | ${c.category} | ${clip(topicTitle(c), 40)} | ${c.size} | \`${c.folder}/\` |`,
    );
  }
  lines.push(
    "",
    "## フォルダ内ファイル",
    "",
    "- `bodies/` … **記事本文・字幕（NotebookLMの本丸）**",
    "- `CONTEXT.md` … 論点・重複・時系列の地図",
    "- `SOURCES.md` … 元記事一覧＋要約／抜粋",
    "- `PROMPT.md` … 貼り付け用の指示文",
    "- `sources.txt` … URL 一覧",
    "- `manifest.json` … 機械可読メタ（enrich coverage 含む）",
    "",
  );
  return lines.join("\n");
}

export interface NotebookResult {
  stamp: string;
  outDir: string;
  latestDir: string;
  localDir: string;
  bridgeRoot: string;
  clusterCount: number;
  totalItems: number;
  clusteredItems: number;
  /** 互換用: INDEX へのパス（旧 ALL_CONTEXT の代わり） */
  allContextPath: string;
  indexPath: string;
  /** 単体書き出し時のみ */
  folder?: string;
  folderPath?: string;
  titleJa?: string;
  index?: number;
  /** 一括時の enrich 集計 */
  enrichOk?: number;
  enrichFailed?: number;
  uniqueTotal?: number;
  bodyFiles?: number;
  coverageOkCount?: number;
}

async function writeClusterFolder(
  writeBoth: (rel: string, body: string) => Promise<void>,
  cluster: TopicCluster & { folder: string },
  stamp: string,
  dataRoot: string,
): Promise<{
  bodyFiles: number;
  coverage: number;
  representativeOk: boolean;
}> {
  const enrich = await loadEnrichMapResolved(
    dataRoot,
    cluster.members.map((m) => m.id),
  );
  const dir = cluster.folder;
  const bodyFiles = buildBodyFiles(cluster, enrich);

  // 古い bodies を消してから書き直す（両ルート）
  // writeBoth はファイル単位なので、README で一覧を示す
  await writeBoth(
    path.join(dir, "bodies", "00_README.md"),
    [
      "# bodies — NotebookLM 用本文バンドル",
      "",
      `生成: ${stamp}`,
      `本文ファイル: ${bodyFiles.length} 件`,
      "",
      "このフォルダの `.md` を CONTEXT.md と一緒に NotebookLM へアップロードしてください。",
      "重複見出しは取得時に潰してあるので、件数は生URLより少なくて正常です。",
      "",
      ...bodyFiles.map((f, i) => `${i + 1}. \`${f.name}\``),
      "",
    ].join("\n"),
  );
  for (const f of bodyFiles) {
    await writeBoth(path.join(dir, "bodies", f.name), f.body);
  }

  await writeBoth(
    path.join(dir, "SOURCES.md"),
    renderSourcesMd(cluster, stamp, enrich),
  );
  await writeBoth(
    path.join(dir, "sources.txt"),
    cluster.members.map((m) => memberBestUrl(m, enrich)).join("\n") + "\n",
  );
  await writeBoth(path.join(dir, "PROMPT.md"), renderClusterPrompt(cluster));
  await writeBoth(
    path.join(dir, "CONTEXT.md"),
    buildContextMarkdown(cluster, stamp, enrich),
  );
  const manifest = clusterManifest(cluster, stamp, dir);
  const er = enrichStats(cluster, enrich);
  await writeBoth(
    path.join(dir, "manifest.json"),
    JSON.stringify(
      {
        ...manifest,
        enrich: {
          withBody: er.withBody,
          failed: er.failed,
          total: er.total,
          uniqueTotal: er.uniqueTotal,
          coverage: er.coverage,
          representativeOk: er.representativeOk,
          bodyFiles: bodyFiles.map((f) => f.name),
        },
      },
      null,
      2,
    ) + "\n",
  );
  return {
    bodyFiles: bodyFiles.length,
    coverage: er.coverage || 0,
    representativeOk: Boolean(er.representativeOk),
  };
}

function makeWriteBoth(outDir: string, localDir: string) {
  return async function writeBoth(rel: string, body: string): Promise<void> {
    const a = path.join(outDir, rel);
    const b = path.join(localDir, rel);
    await mkdir(path.dirname(a), { recursive: true });
    await mkdir(path.dirname(b), { recursive: true });
    await writeFile(a, body, "utf8");
    await writeFile(b, body, "utf8");
  };
}

export async function runNotebook(
  config: AppConfig,
  opts?: ClusterOptions & { enrich?: boolean; forceEnrich?: boolean },
): Promise<NotebookResult> {
  await assertDataRootReady(config);
  await ensureLayout(config.dataRoot);

  const result = await clusterCorpus(
    config.dataRoot,
    resolveClusterOptions(config, opts),
  );

  if (!result.clusters.length) {
    throw new Error(
      "同じ話題のグループが見つかりませんでした。先に npm run collect / daily で収集するか、config の clusterSimilarity を下げてください。",
    );
  }

  const doEnrich = opts?.enrich !== false;
  const catalog = doEnrich ? await loadCatalog(config.dataRoot) : [];
  const byId = new Map(catalog.map((e) => [e.id, e]));

  let enrichOk = 0;
  let enrichFailed = 0;
  let uniqueTotal = 0;

  if (doEnrich) {
    console.log(
      `\n全 ${result.clusters.length} 話題の向こう側を取得中（ユニーク記事のみ）…`,
    );
    for (const cluster of result.clusters) {
      const entries = cluster.members
        .map((m) => byId.get(m.id))
        .filter((e): e is CatalogEntry => Boolean(e));
      console.log(
        `\n▶ #${String(cluster.index).padStart(2, "0")} ${cluster.titleJa}（raw ${entries.length}）`,
      );
      const er = await enrichEntries(config, entries, {
        force: opts?.forceEnrich,
        unique: true,
      });
      enrichOk += er.okCount;
      enrichFailed += er.failedCount;
      uniqueTotal += er.uniqueTotal;
      console.log(
        `  → ok=${er.okCount} failed=${er.failedCount} unique=${er.uniqueTotal}/${er.total}`,
      );
    }
  }

  const stamp = runStamp();
  const bridgeRoot = resolveBridgeRoot(config);
  const outDir = path.join(bridgeRoot, "notebook");
  const localDir = path.join(config.dataRoot, "notebook", "out");
  const latestDir = outDir;

  await rm(outDir, { recursive: true, force: true });
  await rm(localDir, { recursive: true, force: true });
  await mkdir(outDir, { recursive: true });
  await mkdir(localDir, { recursive: true });

  const withFolder = result.clusters.map((c) => ({
    ...c,
    folder: topicFolderName(c),
  }));

  const writeBoth = makeWriteBoth(outDir, localDir);

  let bodyFiles = 0;
  let coverageOkCount = 0;
  for (const cluster of withFolder) {
    const written = await writeClusterFolder(
      writeBoth,
      cluster,
      stamp,
      config.dataRoot,
    );
    bodyFiles += written.bodyFiles;
    if (written.representativeOk || written.coverage >= 0.5) {
      coverageOkCount++;
    }
  }

  const indexMd = renderIndexMd(stamp, withFolder, result.totalItems);
  await writeBoth("00_INDEX.md", indexMd);

  const indexPath = path.join(outDir, "00_INDEX.md");

  const manifest = {
    schema: "ai-intel-notebook.v4",
    kind: "notebook_topic_folders",
    layout: "topic_folders",
    stamp,
    generatedAt: nowIso(),
    totalItems: result.totalItems,
    clusteredItems: result.clusteredItems,
    clusterCount: result.clusters.length,
    options: result.options,
    enrich: doEnrich
      ? {
          ok: enrichOk,
          failed: enrichFailed,
          uniqueTotal,
          bodyFiles,
          coverageOkCount,
        }
      : null,
    naming: "{nn}_{category}_{titleJa}/CONTEXT.md + bodies/",
    clusters: withFolder.map((c) => ({
      index: c.index,
      titleJa: c.titleJa,
      label: c.label,
      slug: c.slug,
      folder: c.folder,
      category: c.category,
      keywords: c.keywords,
      size: c.size,
      files: {
        context: path.join(c.folder, "CONTEXT.md"),
        bodies: path.join(c.folder, "bodies"),
        sourcesMd: path.join(c.folder, "SOURCES.md"),
        prompt: path.join(c.folder, "PROMPT.md"),
        sourcesTxt: path.join(c.folder, "sources.txt"),
        manifest: path.join(c.folder, "manifest.json"),
      },
      memberIds: c.members.map((m) => m.id),
      urls: c.members.map((m) => m.url),
    })),
  };
  await writeBoth("00_MANIFEST.json", JSON.stringify(manifest, null, 2) + "\n");

  return {
    stamp,
    outDir,
    latestDir,
    localDir,
    bridgeRoot,
    clusterCount: result.clusters.length,
    totalItems: result.totalItems,
    clusteredItems: result.clusteredItems,
    allContextPath: indexPath,
    indexPath,
    enrichOk,
    enrichFailed,
    uniqueTotal,
    bodyFiles,
    coverageOkCount,
  };
}

/**
 * 選択した話題（index: 1始まり）だけ詳細CONTEXTフォルダを書き出す。
 * 既存の他フォルダは消さない。
 */
export async function runNotebookOne(
  config: AppConfig,
  clusterIndex: number,
  opts?: ClusterOptions & { enrich?: boolean; forceEnrich?: boolean },
): Promise<
  NotebookResult & {
    enrichOk?: number;
    enrichFailed?: number;
    uniqueTotal?: number;
    bodyFiles?: number;
    coverage?: number;
    coverageOk?: boolean;
  }
> {
  await assertDataRootReady(config);
  await ensureLayout(config.dataRoot);

  if (!Number.isFinite(clusterIndex) || clusterIndex < 1) {
    throw new Error("clusterIndex は 1 以上の整数で指定してください");
  }

  let enrichOk = 0;
  let enrichFailed = 0;
  let uniqueTotal = 0;
  if (opts?.enrich !== false) {
    // 既定: 選択話題は向こう側を取ってから CONTEXT を書く
    console.log("向こう側（本文・字幕）を取得中…（ユニーク記事のみ）");
    const er = await enrichCluster(
      config,
      clusterIndex,
      resolveClusterOptions(config, opts),
      { force: opts?.forceEnrich },
    );
    enrichOk = er.okCount;
    enrichFailed = er.failedCount;
    uniqueTotal = er.uniqueTotal;
    console.log(
      `  enrich: ok=${er.okCount} failed=${er.failedCount} skipped=${er.skippedCount}` +
        ` unique=${er.uniqueTotal}/${er.total}`,
    );
  }

  const result = await clusterCorpus(
    config.dataRoot,
    resolveClusterOptions(config, opts),
  );
  const cluster = result.clusters.find((c) => c.index === clusterIndex);
  if (!cluster) {
    throw new Error(
      `話題 #${String(clusterIndex).padStart(2, "0")} が見つかりません（現在 ${result.clusters.length} 件）`,
    );
  }

  const stamp = runStamp();
  const bridgeRoot = resolveBridgeRoot(config);
  const outDir = path.join(bridgeRoot, "notebook");
  const localDir = path.join(config.dataRoot, "notebook", "out");
  const latestDir = outDir;
  await mkdir(outDir, { recursive: true });
  await mkdir(localDir, { recursive: true });

  const withFolder = { ...cluster, folder: topicFolderName(cluster) };
  const writeBoth = makeWriteBoth(outDir, localDir);

  // 同番号の古いフォルダ（タイトル変更で別名になった残骸）を掃除
  try {
    const { readdir } = await import("node:fs/promises");
    const prefix = `${String(cluster.index).padStart(2, "0")}_`;
    for (const root of [outDir, localDir]) {
      const names = await readdir(root).catch(() => [] as string[]);
      for (const name of names) {
        if (!name.startsWith(prefix)) continue;
        if (name === withFolder.folder) continue;
        await rm(path.join(root, name), { recursive: true, force: true });
      }
    }
  } catch {
    // 掃除失敗は致命的ではない
  }

  const written = await writeClusterFolder(
    writeBoth,
    withFolder,
    stamp,
    config.dataRoot,
  );
  const coverageOk =
    written.representativeOk || written.coverage >= 0.5;
  if (!coverageOk) {
    console.warn(
      "⚠ 本文カバレッジ不足: bodies/ が空か少ない。NotebookLM投入前に enrich を見直してください。",
    );
  } else {
    console.log(
      `  bodies: ${written.bodyFiles} ファイル / coverage ${Math.round(written.coverage * 100)}%`,
    );
  }

  // INDEX に1件追記/更新（ある場合は差し替え）
  const indexLine = `| ${withFolder.index} | ${withFolder.category} | ${clip(topicTitle(withFolder), 40)} | ${withFolder.size} | \`${withFolder.folder}/\` |`;
  const indexPath = path.join(outDir, "00_INDEX.md");
  let indexBody = "";
  try {
    const { readFile } = await import("node:fs/promises");
    indexBody = await readFile(indexPath, "utf8");
  } catch {
    indexBody = renderIndexMd(stamp, [withFolder], result.totalItems);
  }
  if (indexBody.includes("| # |")) {
    const re = new RegExp(`^\\|\\s*${withFolder.index}\\s*\\|.*$`, "m");
    if (re.test(indexBody)) {
      indexBody = indexBody.replace(re, indexLine);
    } else {
      // 表の末尾（空行の前）に追記
      indexBody = indexBody.replace(
        /(\|---\|[^\n]*\n)([\s\S]*?)(\n## |\n*$)/,
        (_m, head, rows, tail) => `${head}${rows.trimEnd()}\n${indexLine}${tail || "\n"}`,
      );
    }
  } else {
    indexBody = renderIndexMd(stamp, [withFolder], result.totalItems);
  }
  await writeBoth("00_INDEX.md", indexBody);

  const folderPath = path.join(outDir, withFolder.folder);

  return {
    stamp,
    outDir,
    latestDir,
    localDir,
    bridgeRoot,
    clusterCount: 1,
    totalItems: result.totalItems,
    clusteredItems: withFolder.size,
    allContextPath: path.join(folderPath, "CONTEXT.md"),
    indexPath,
    folder: withFolder.folder,
    folderPath,
    titleJa: topicTitle(withFolder),
    index: withFolder.index,
    enrichOk,
    enrichFailed,
    uniqueTotal,
    bodyFiles: written.bodyFiles,
    coverage: written.coverage,
    coverageOk,
  };
}

/* ============================================================
 * 解析（UI表示用）: フォルダ書き出しはせず、クラスタ + CONTEXTプレビューをJSONで返す
 * ============================================================ */

export interface NotebookMemberView {
  id: string;
  title: string;
  titleJa?: string;
  source: SourceKind;
  category: string;
  date: string;
  tags: string[];
  summary: string;
  url: string;
}

export interface NotebookClusterView {
  index: number;
  label: string;
  titleJa: string;
  folderName: string;
  slug: string;
  category: string;
  keywords: string[];
  size: number;
  relatedness: Relatedness;
  bySource: Record<string, number>;
  representativeTitle: string;
  entities: string[];
  overview: string;
  members: NotebookMemberView[];
  contextMarkdown: string;
}

export interface NotebookAnalysis {
  ok: true;
  generatedAt: string;
  totalItems: number;
  candidateCount: number;
  targetCount: number;
  options: {
    similarity: number;
    minSize: number;
    maxGroups: number;
    maxSize: number;
  };
  clusters: NotebookClusterView[];
}

function resolveClusterOptions(
  config: AppConfig,
  opts?: ClusterOptions,
): ClusterOptions {
  const cfg = config as AppConfig & {
    clusterSimilarity?: number;
    clusterMinSize?: number;
    clusterMaxGroups?: number;
    clusterMaxSize?: number;
  };
  return {
    similarity: opts?.similarity ?? cfg.clusterSimilarity,
    minSize: opts?.minSize ?? cfg.clusterMinSize,
    maxGroups: opts?.maxGroups ?? cfg.clusterMaxGroups,
    maxSize: opts?.maxSize ?? cfg.clusterMaxSize,
  };
}

export async function analyzeCorpus(
  config: AppConfig,
  opts?: ClusterOptions,
): Promise<NotebookAnalysis> {
  await assertDataRootReady(config);
  await ensureLayout(config.dataRoot);

  const result = await clusterCorpus(
    config.dataRoot,
    resolveClusterOptions(config, opts),
  );
  const stamp = todayStamp();
  const allIds = result.clusters.flatMap((c) => c.members.map((m) => m.id));
  const enrich = await loadEnrichMapResolved(config.dataRoot, allIds);

  const clusters: NotebookClusterView[] = result.clusters.map((c) => ({
    index: c.index,
    label: c.label,
    titleJa: c.titleJa,
    folderName: topicFolderName(c),
    slug: c.slug,
    category: c.category,
    keywords: c.keywords,
    size: c.size,
    relatedness: relatednessOf(c.size),
    bySource: sourceBreakdown(c),
    representativeTitle: memberDisplayTitle(representativeMember(c)),
    entities: extractEntities(c),
    overview: extractiveOverview(c),
    members: c.members.map((m) => ({
      id: m.id,
      title: m.title,
      titleJa: m.titleJa,
      source: m.source,
      category: m.category,
      date: dateOnly(m.date),
      tags: m.tags,
      summary: cleanText(m.summary),
      url: m.url,
    })),
    contextMarkdown: buildContextMarkdown(c, stamp, enrich),
  }));

  const analysis: NotebookAnalysis = {
    ok: true,
    generatedAt: nowIso(),
    totalItems: result.totalItems,
    candidateCount: result.candidateCount,
    targetCount: result.clusters.length,
    options: result.options,
    clusters,
  };

  try {
    const cacheDir = path.join(config.dataRoot, "notebook");
    await mkdir(cacheDir, { recursive: true });
    await writeFile(
      path.join(cacheDir, "analysis-cache.json"),
      JSON.stringify(analysis) + "\n",
      "utf8",
    );
  } catch {
    // キャッシュ失敗は致命的ではない
  }

  return analysis;
}
