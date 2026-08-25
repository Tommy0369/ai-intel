import { mkdir, readFile, writeFile, appendFile } from "node:fs/promises";
import path from "node:path";
import { assertDataRootReady, ensureLayout } from "./disk.js";
import { nowIso } from "./http.js";
import { loadCatalog, pickTop, sortByRecency, topTags } from "./corpus.js";
import { runCollect } from "./orchestrator.js";
import { runPrepare } from "./prepare.js";
import { loadSources } from "./config.js";
import type { AppConfig, CatalogEntry, Category, SourcesConfig } from "./types.js";
import { CATEGORIES } from "./types.js";

function todayStamp(d = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function tokenSet(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/https?:\/\/\S+/g, " ")
      .split(/[^a-z0-9\u3040-\u30ff\u4e00-\u9fff+]+/i)
      .filter((t) => t.length >= 3)
      .filter(
        (t) =>
          ![
            "the",
            "and",
            "for",
            "with",
            "from",
            "this",
            "that",
            "https",
            "com",
            "org",
            "www",
          ].includes(t),
      ),
  );
}

function overlapScore(a: CatalogEntry, b: CatalogEntry): number {
  const ta = tokenSet(`${a.title} ${(a.tags ?? []).join(" ")} ${a.category}`);
  const tb = tokenSet(`${b.title} ${(b.tags ?? []).join(" ")} ${b.category}`);
  let hit = 0;
  for (const t of ta) if (tb.has(t)) hit++;
  let score = hit;
  if (a.category !== b.category) score += 1.5; // cross-category bonus
  if (a.source !== b.source) score += 0.5;
  return score;
}

export interface Imagination {
  id: string;
  title: string;
  thesis: string;
  newItem: CatalogEntry;
  oldItem: CatalogEntry;
  bridge: string;
  buildPrompt: string;
  experiment: string[];
}

function bridgeLabel(neu: CatalogEntry, old: CatalogEntry): string {
  if (neu.category !== old.category) {
    return `${neu.category} × ${old.category} の交差`;
  }
  return `${neu.source} の新情報 × 既存 ${old.source} 知見`;
}

function inventTitle(neu: CatalogEntry, old: CatalogEntry): string {
  const templates = [
    `「${clip(neu.title, 42)}」を「${clip(old.title, 42)}」に移植する`,
    `${neu.category} の新潮流で ${old.category} を再発明する`,
    `${clip(neu.title, 36)} × ${clip(old.title, 36)} から生まれる体験`,
  ];
  const idx =
    Math.abs(hash(`${neu.id}:${old.id}`)) % templates.length;
  return templates[idx];
}

function clip(s: string, n: number): string {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length <= n ? t : t.slice(0, n - 1) + "…";
}

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return h;
}

function inventImaginations(
  neu: CatalogEntry[],
  corpus: CatalogEntry[],
  limit = 8,
): Imagination[] {
  const oldPool = corpus.filter((c) => !neu.some((n) => n.id === c.id));
  const scored: Imagination[] = [];

  for (const n of neu.slice(0, 40)) {
    let best: { old: CatalogEntry; score: number } | null = null;
    for (const o of oldPool) {
      const score = overlapScore(n, o);
      if (score < 2) continue;
      if (!best || score > best.score) best = { old: o, score };
    }
    if (!best) continue;

    const bridge = bridgeLabel(n, best.old);
    const title = inventTitle(n, best.old);
    const id = `img_${hash(`${n.id}:${best.old.id}`).toString(16).replace("-", "n")}`;
    scored.push({
      id,
      title,
      thesis: `今日の「${clip(n.title, 60)}」と、既存の「${clip(best.old.title, 60)}」を融合すると、まだ世にない体験の種が生まれる。`,
      newItem: n,
      oldItem: best.old,
      bridge,
      buildPrompt: [
        "あなたは想像力のあるAI実装パートナーです。",
        "次の2つを融合した、まだ存在しないプロダクト/体験のMVPを設計し、コードまで書いてください。",
        "",
        `【今日の新情報】${n.title}`,
        `URL: ${n.url}`,
        `category/source: ${n.category}/${n.source}`,
        "",
        `【既存コーパス】${best.old.title}`,
        `URL: ${best.old.url}`,
        `category/source: ${best.old.category}/${best.old.source}`,
        "",
        `橋渡し: ${bridge}`,
        "制約: 小さく動くもの。外付けHDDの ai-intel データも必要なら読んでよい。",
      ].join("\n"),
      experiment: [
        "2つのソースを1段落でつなぐストーリーを書く",
        "ユーザーが30秒で価値を感じる画面/CLIを1つ作る",
        "学習メモを learning/notes/ に残す",
      ],
    });
  }

  // Prefer cross-category and higher overlap diversity
  const uniq = new Map<string, Imagination>();
  for (const img of scored.sort(
    (a, b) =>
      overlapScore(b.newItem, b.oldItem) - overlapScore(a.newItem, a.oldItem),
  )) {
    const key = `${img.newItem.id}|${img.oldItem.category}`;
    if (uniq.has(key)) continue;
    uniq.set(key, img);
    if (uniq.size >= limit) break;
  }
  return [...uniq.values()];
}

function link(e: CatalogEntry): string {
  return `- [${e.title}](${e.url}) \`${e.source}\`/\`${e.category}\``;
}

function buildLatestMd(
  stamp: string,
  neu: CatalogEntry[],
  collectMeta: Record<string, unknown>,
): string {
  const byCat: Partial<Record<Category, CatalogEntry[]>> = {};
  for (const e of neu) {
    (byCat[e.category] ??= []).push(e);
  }
  const lines = [
    `# Daily Latest — ${stamp}`,
    "",
    `生成: ${nowIso()}`,
    "",
    "今朝、全媒体から拾った**新規**情報です（既存コーパスとの差分）。",
    "",
    "## 収集サマリ",
    "",
    `- 新規件数: ${neu.length}`,
    `- written: ${collectMeta.written ?? "?"}`,
    `- fetched: ${collectMeta.fetched ?? "?"}`,
    `- skipped(重複など): ${collectMeta.skipped ?? "?"}`,
    "",
  ];

  if (!neu.length) {
    lines.push("_本日の新規は0件でした。既存コーパスとの融合イマジネーションは前日差分/直近から生成します。_", "");
  }

  lines.push("## カテゴリ別 最新", "");
  for (const c of CATEGORIES) {
    const list = byCat[c];
    if (!list?.length) continue;
    lines.push(`### ${c} (${list.length})`, "");
    for (const e of pickTop(list, 12)) lines.push(link(e));
    lines.push("");
  }

  const tags = topTags(neu, 15);
  if (tags.length) {
    lines.push("## 今日のタグ", "");
    lines.push(tags.map((t) => `\`${t.tag}\`(${t.count})`).join(" · "));
    lines.push("");
  }

  lines.push(
    "## 朝の5分プロンプト",
    "",
    "「今日の最新だけを前提に、世界で何が動いたかを日本語で1分スピーチ用にまとめて。次に試すべき実験を1つ。」",
    "",
  );
  return lines.join("\n");
}

function buildFusionMd(
  stamp: string,
  neu: CatalogEntry[],
  corpus: CatalogEntry[],
): string {
  const lines = [
    `# Fusion Map — ${stamp}`,
    "",
    `生成: ${nowIso()}`,
    "",
    "今日の新情報と、既存コーパスの接点です。イマジネーションの燃料。",
    "",
  ];

  const sampleNew = pickTop(sortByRecency(neu), 15);
  const old = corpus.filter((c) => !neu.some((n) => n.id === c.id));

  for (const n of sampleNew) {
    const related = [...old]
      .map((o) => ({ o, score: overlapScore(n, o) }))
      .filter((x) => x.score >= 2)
      .sort((a, b) => b.score - a.score)
      .slice(0, 3);
    lines.push(`## ${n.title}`);
    lines.push("");
    lines.push(link(n));
    lines.push("");
    if (!related.length) {
      lines.push("_強い既存接点は未検出（新しいテーマの可能性）_");
    } else {
      lines.push("既存との融合候補:");
      lines.push("");
      for (const r of related) {
        lines.push(
          `- (score ${r.score.toFixed(1)}) ${r.o.title} — ${r.o.url} [\`${r.o.category}\`]`,
        );
      }
    }
    lines.push("");
  }

  return lines.join("\n");
}

function buildImaginationMd(stamp: string, ideas: Imagination[]): string {
  const lines = [
    `# Imagination Engine — ${stamp}`,
    "",
    `生成: ${nowIso()}`,
    "",
    "今日の最新 × 既存コーパスから生まれた**新しいイマジネーション**。",
    "選んだものの `AIへの実装依頼` を Cursor / 他AI に渡してください。",
    "",
    "## 使い方",
    "",
    "1. 刺さる想像を1つ選ぶ",
    "2. 下の実装依頼をチャットに貼る",
    "3. できた種を `create/projects/<id>/` に残す",
    "4. 翌朝の daily がまた新しい融合を足す",
    "",
  ];

  if (!ideas.length) {
    lines.push("_融合イマジネーションを生成できませんでした（新規が少ない等）。_");
    lines.push("");
    return lines.join("\n");
  }

  for (const img of ideas) {
    lines.push(`## ${img.title}`);
    lines.push("");
    lines.push(`- id: \`${img.id}\``);
    lines.push(`- 橋渡し: ${img.bridge}`);
    lines.push(`- テーゼ: ${img.thesis}`);
    lines.push("");
    lines.push("### 材料");
    lines.push("");
    lines.push(`- 新: ${link(img.newItem).replace(/^- /, "")}`);
    lines.push(`- 旧: ${link(img.oldItem).replace(/^- /, "")}`);
    lines.push("");
    lines.push("### 実験ステップ");
    lines.push("");
    for (const s of img.experiment) lines.push(`- ${s}`);
    lines.push("");
    lines.push("### AIへの実装依頼");
    lines.push("");
    lines.push("```");
    lines.push(img.buildPrompt);
    lines.push("```");
    lines.push("");
  }

  lines.push(
    "## 想像力を育てる原則",
    "",
    "1. 新×旧の**交差**を好む（同じカテゴリ同士より面白い）",
    "2. 説明できるストーリーがある想像だけ残す",
    "3. 24時間以内に動く破片を作る",
    "",
  );
  return lines.join("\n");
}

function buildBriefMd(
  stamp: string,
  neuCount: number,
  ideas: Imagination[],
  dayDir: string,
): string {
  return `# Morning Brief — ${stamp}

生成: ${nowIso()}

毎朝9時の自動儀式の結果です。

## 今日の数字

- 新規取得: **${neuCount}** 件
- 生まれたイマジネーション: **${ideas.length}** 個

## 開く順

1. [\`LATEST.md\`](./LATEST.md) — 今日の最新まとめ
2. [\`FUSION.md\`](./FUSION.md) — 既存との接点
3. [\`IMAGINATION.md\`](./IMAGINATION.md) — 新しい想像
4. \`/Volumes/外付け320GB/ai-intel/ready/PROMPT.md\` — 全件活用

## トップイマジネーション

${
  ideas.length
    ? ideas
        .slice(0, 3)
        .map((i, n) => `${n + 1}. **${i.title}** (\`${i.id}\`)`)
        .join("\n")
    : "_なし_"
}

## 他AIへの一言

\`\`\`
/Volumes/外付け320GB/ai-intel/daily/${stamp}/BRIEF.md と IMAGINATION.md を読んで、
一番強いイマジネーションを1つ選び、今日中に動くMVPを実装して。
\`\`\`

日次フォルダ: \`${dayDir}\`
`;
}

export interface DailyResult {
  stamp: string;
  newCount: number;
  imaginationCount: number;
  dayDir: string;
}

export async function runDaily(config: AppConfig): Promise<DailyResult> {
  await assertDataRootReady(config);
  await ensureLayout(config.dataRoot);

  const stamp = todayStamp();
  const dayDir = path.join(config.dataRoot, "daily", stamp);
  await mkdir(dayDir, { recursive: true });

  const before = await loadCatalog(config.dataRoot);
  const beforeIds = new Set(before.map((e) => e.id));

  console.log(`\n☀ daily ${stamp} — collect all media…`);
  const sources: SourcesConfig = await loadSources();
  const collectResult = await runCollect(config, sources);

  const after = await loadCatalog(config.dataRoot);
  let neu = after.filter((e) => !beforeIds.has(e.id));

  // Fallback: if dedup ate everything, use same-day collected items
  if (!neu.length) {
    neu = after.filter((e) => (e.collected_at || "").startsWith(stamp));
  }
  // Still empty → use most recent slice as "morning focus"
  if (!neu.length) {
    neu = sortByRecency(after).slice(0, 25);
    console.log("  (新規0のため直近25件を朝フォーカスに使用)");
  }

  const realNew = after.filter((e) => !beforeIds.has(e.id));
  const focus = realNew.length ? realNew : neu;

  console.log(`  new items: ${realNew.length} (focus: ${focus.length})`);

  const ideas = inventImaginations(focus, after, 8);

  const latestBody = buildLatestMd(stamp, focus, {
    written: collectResult.written,
    fetched: collectResult.fetched,
    skipped: collectResult.skipped,
  });
  const fusionBody = buildFusionMd(stamp, focus, after);
  const imaginationBody = buildImaginationMd(stamp, ideas);
  const briefBody = buildBriefMd(stamp, realNew.length, ideas, dayDir);

  await writeFile(path.join(dayDir, "LATEST.md"), latestBody, "utf8");
  await writeFile(path.join(dayDir, "FUSION.md"), fusionBody, "utf8");
  await writeFile(path.join(dayDir, "IMAGINATION.md"), imaginationBody, "utf8");
  await writeFile(path.join(dayDir, "BRIEF.md"), briefBody, "utf8");

  // Pointers at daily/ root
  const dailyRoot = path.join(config.dataRoot, "daily");
  await writeFile(path.join(dailyRoot, "TODAY.md"), briefBody, "utf8");
  await writeFile(
    path.join(dailyRoot, "LATEST_IMAGINATION.md"),
    imaginationBody,
    "utf8",
  );

  const logLine = JSON.stringify({
    stamp,
    at: nowIso(),
    newCount: realNew.length,
    imaginationCount: ideas.length,
    written: collectResult.written,
    fetched: collectResult.fetched,
  });
  await appendFile(path.join(dailyRoot, "history.jsonl"), logLine + "\n", "utf8");

  // 起床キャッチアップ用: 本日完了スタンプ
  await writeFile(
    path.join(config.dataRoot, "state", "last-daily-day.txt"),
    stamp + "\n",
    "utf8",
  );

  // Refresh ready pack + learn/forge for fusion continuity
  console.log("▶ prepare (全件再パック)…");
  await runPrepare(config, { withLearnForge: true });

  // Keep a copy of imagination index growing
  const indexPath = path.join(config.dataRoot, "create", "IMAGINATION_INDEX.md");
  let prev = "";
  try {
    prev = await readFile(indexPath, "utf8");
  } catch {
    prev = "# Imagination Index\n\n日々のイマジネーションへの索引。\n\n";
  }
  const addition = [
    "",
    `## ${stamp}`,
    "",
    ...ideas.slice(0, 5).map((i) => `- [${i.title}](../daily/${stamp}/IMAGINATION.md) (\`${i.id}\`)`),
    "",
  ].join("\n");
  if (!prev.includes(`## ${stamp}`)) {
    await writeFile(indexPath, prev.trimEnd() + "\n" + addition, "utf8");
  }

  return {
    stamp,
    newCount: realNew.length,
    imaginationCount: ideas.length,
    dayDir,
  };
}
