/**
 * 重複監視体制（Dup Watch）
 *
 * 収集時の seen-urls 完全一致だけでは取りこぼす:
 * - www 有無 / クエリ違い / YouTube 短縮URL
 * - Google News 集約 ↔ 出版社URL
 * - ほぼ同じタイトルの別ソース転載
 *
 * フロー: scan（検出・ウォッチ期間）→ apply（代表以外を quarantine）→ rebuild catalog → links
 */
import {
  access,
  appendFile,
  mkdir,
  readFile,
  rename,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { assertDataRootReady, ensureLayout } from "./disk.js";
import { nowIso } from "./http.js";
import { loadCatalog } from "./corpus.js";
import { normalizeUrl } from "./dedup.js";
import { normalizeTitleKey } from "./enrich-canonicalize.js";
import { rebuildCatalogFromDisk } from "./writer.js";
import { writeIndexMd } from "./catalog.js";
import { runLinksHtml } from "./links-html.js";
import type { AppConfig, CatalogEntry, SourceKind } from "./types.js";

export type DupKind =
  | "same-url"
  | "near-url"
  | "youtube-id"
  | "same-title"
  | "similar-title"
  | "same-canonical-url"
  | "same-content-hash";

export type DupGroupStatus = "holding" | "applied" | "skipped";

export interface DupMember {
  id: string;
  title: string;
  titleJa?: string;
  url: string;
  source: SourceKind;
  category: string;
  path: string;
  collectedAt: string;
  score: number;
}

export interface DupGroup {
  id: string;
  kind: DupKind;
  key: string;
  keepId: string;
  dropIds: string[];
  members: DupMember[];
  reason: string;
  foundAt: string;
  reviewUntil: string;
  status: DupGroupStatus;
  appliedAt?: string;
}

export interface DupWatchOptions {
  /** ウォッチ期間（時間）。既定: config.dupWatchHours ?? vetReviewHours ?? 24 */
  watchHours?: number;
  /** true なら検出後すぐに quarantine（ウォッチ期間スキップ） */
  applyNow?: boolean;
  /** 類似タイトルの Jaccard しきい値（既定 0.9） */
  similarThreshold?: number;
  /** 類似照合の最大比較数（安全弁） */
  maxSimilarComparisons?: number;
  /** apply 後に LINKS.html も更新 */
  refreshLinks?: boolean;
}

export interface DupWatchResult {
  scanned: number;
  groups: number;
  dropCandidates: number;
  applied: number;
  holding: number;
  byKind: Record<DupKind, number>;
  reportPath: string;
  ledgerPath: string;
  quarantineDir: string;
  groupsList: DupGroup[];
}

const SOURCE_KEEP: Record<SourceKind, number> = {
  arxiv: 90,
  europepmc: 92,
  docs: 80,
  github: 72,
  rss: 60,
  youtube: 50,
  reddit: 35,
  x: 30,
};

function dupDir(dataRoot: string): string {
  return path.join(dataRoot, "vet", "dup");
}

function fingerprintUrl(raw: string): string {
  try {
    const u = new URL(normalizeUrl(raw));
    let host = u.hostname.toLowerCase().replace(/^www\./, "");
    // youtube 正規化は別キーでも見る
    const pathOnly = u.pathname.replace(/\/+$/, "") || "/";
    const params = [...u.searchParams.entries()]
      .filter(([k]) => !k.startsWith("utm_") && k !== "ref" && k !== "si" && k !== "feature")
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}=${v}`)
      .join("&");
    return `${host}${pathOnly}${params ? `?${params}` : ""}`;
  } catch {
    return normalizeUrl(raw).toLowerCase();
  }
}

/** YouTube 動画ID（同じ動画の別URLをまとめる） */
export function youtubeVideoId(url: string): string | null {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, "");
    if (host === "youtu.be") {
      const id = u.pathname.split("/").filter(Boolean)[0];
      return id?.length === 11 ? id : null;
    }
    if (host.endsWith("youtube.com")) {
      if (u.pathname === "/watch") {
        const v = u.searchParams.get("v");
        return v?.length === 11 ? v : null;
      }
      const m = u.pathname.match(/\/(shorts|embed|live)\/([A-Za-z0-9_-]{11})/);
      return m?.[2] ?? null;
    }
  } catch {
    // ignore
  }
  return null;
}

function keepScore(e: CatalogEntry): number {
  let s = SOURCE_KEEP[e.source] ?? 40;
  const url = e.url || "";
  if (/news\.google\.com/i.test(url)) s -= 25;
  if (/doi\.org|arxiv\.org|pubmed|europepmc/i.test(url)) s += 15;
  if (/apnews|reuters|bbc\.|nytimes|nature\.com|sciencedirect/i.test(url)) s += 12;
  if (/techcrunch|theverge|anthropic|openai/i.test(url)) s += 8;
  const titleLen = (e.title_ja || e.title || "").length;
  s += Math.min(10, Math.floor(titleLen / 20));
  const pub = e.published_at ? Date.parse(e.published_at) : NaN;
  const col = e.collected_at ? Date.parse(e.collected_at) : NaN;
  const ts = Number.isFinite(pub) ? pub : col;
  if (Number.isFinite(ts)) {
    // 新しいほどわずかに加点
    const ageDays = (Date.now() - ts) / 86_400_000;
    s += Math.max(0, 8 - Math.min(8, ageDays / 30));
  }
  return s;
}

function toMember(e: CatalogEntry): DupMember {
  return {
    id: e.id,
    title: e.title,
    titleJa: e.title_ja,
    url: e.url,
    source: e.source,
    category: e.category,
    path: e.path,
    collectedAt: e.collected_at,
    score: keepScore(e),
  };
}

function pickKeep(members: DupMember[]): DupMember {
  return [...members].sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.id.localeCompare(b.id);
  })[0];
}

function groupId(kind: DupKind, key: string): string {
  return createHash("sha1")
    .update(`${kind}|${key}`)
    .digest("hex")
    .slice(0, 14);
}

function tokenSet(title: string): Set<string> {
  const key = normalizeTitleKey(title);
  const parts = key.split(" ").filter((t) => t.length >= 2);
  return new Set(parts);
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  return inter / (a.size + b.size - inter);
}

function buildGroups(
  catalog: CatalogEntry[],
  opts: {
    similarThreshold: number;
    maxSimilarComparisons: number;
    watchHours: number;
    now: number;
  },
): DupGroup[] {
  const byId = new Map(catalog.map((e) => [e.id, e]));
  const buckets = new Map<string, { kind: DupKind; key: string; ids: Set<string> }>();

  const add = (kind: DupKind, key: string, id: string) => {
    if (!key) return;
    const mapKey = `${kind}::${key}`;
    let b = buckets.get(mapKey);
    if (!b) {
      b = { kind, key, ids: new Set() };
      buckets.set(mapKey, b);
    }
    b.ids.add(id);
  };

  for (const e of catalog) {
    if (!e.url) continue;
    add("same-url", normalizeUrl(e.url), e.id);
    add("near-url", fingerprintUrl(e.url), e.id);
    if (e.canonical_url && !/news\.google\.com/i.test(e.canonical_url)) {
      add("same-canonical-url", normalizeUrl(e.canonical_url), e.id);
    }
    if (e.content_hash && e.content_hash.length >= 16) {
      add("same-content-hash", e.content_hash, e.id);
    }
    const yid = youtubeVideoId(e.url);
    if (yid) add("youtube-id", yid, e.id);
    const tk = normalizeTitleKey(e.title_ja || e.title);
    if (tk.length >= 16) add("same-title", `${e.category}::${tk}`, e.id);
  }

  // 類似タイトル（カテゴリ内・長さ帯で候補を絞る）
  const byCat = new Map<string, CatalogEntry[]>();
  for (const e of catalog) {
    const list = byCat.get(e.category) ?? [];
    list.push(e);
    byCat.set(e.category, list);
  }
  let comparisons = 0;
  const unionFindParent = new Map<string, string>();
  const find = (x: string): string => {
    let p = unionFindParent.get(x) ?? x;
    while (p !== (unionFindParent.get(p) ?? p)) p = unionFindParent.get(p)!;
    unionFindParent.set(x, p);
    return p;
  };
  const unite = (a: string, b: string) => {
    const pa = find(a);
    const pb = find(b);
    if (pa !== pb) unionFindParent.set(pa, pb);
  };

  for (const [, list] of byCat) {
    const withTokens = list
      .map((e) => ({
        e,
        tokens: tokenSet(e.title_ja || e.title),
        len: (e.title_ja || e.title || "").length,
      }))
      .filter((x) => x.tokens.size >= 4);

    withTokens.sort((a, b) => a.len - b.len);
    for (let i = 0; i < withTokens.length; i++) {
      unionFindParent.set(withTokens[i].e.id, find(withTokens[i].e.id));
      for (let j = i + 1; j < withTokens.length; j++) {
        if (comparisons >= opts.maxSimilarComparisons) break;
        if (withTokens[j].len - withTokens[i].len > 24) break;
        comparisons++;
        const sim = jaccard(withTokens[i].tokens, withTokens[j].tokens);
        if (sim >= opts.similarThreshold) {
          unite(withTokens[i].e.id, withTokens[j].e.id);
        }
      }
      if (comparisons >= opts.maxSimilarComparisons) break;
    }
  }

  const similarClusters = new Map<string, Set<string>>();
  for (const id of unionFindParent.keys()) {
    const root = find(id);
    const set = similarClusters.get(root) ?? new Set();
    set.add(id);
    similarClusters.set(root, set);
  }
  for (const [root, ids] of similarClusters) {
    if (ids.size < 2) continue;
    const mapKey = `similar-title::sim:${root}`;
    buckets.set(mapKey, {
      kind: "similar-title",
      key: `sim:${root}`,
      ids: new Set(ids),
    });
  }

  const reviewUntil = new Date(
    opts.now + opts.watchHours * 3_600_000,
  ).toISOString();
  const foundAt = new Date(opts.now).toISOString();

  const groups: DupGroup[] = [];
  const alreadyDropped = new Set<string>();
  const alreadyKept = new Set<string>();

  const order: DupKind[] = [
    "same-url",
    "same-canonical-url",
    "same-content-hash",
    "youtube-id",
    "near-url",
    "same-title",
    "similar-title",
  ];
  const sortedBuckets = [...buckets.values()].sort(
    (a, b) => order.indexOf(a.kind) - order.indexOf(b.kind),
  );

  for (const b of sortedBuckets) {
    if (b.ids.size < 2) continue;
    const entries = [...b.ids]
      .map((id) => byId.get(id))
      .filter((e): e is CatalogEntry => !!e)
      .filter((e) => !alreadyDropped.has(e.id));
    if (entries.length < 2) continue;

    // すでに keep 済みのメンバーがいればそれを優先残し
    const preferredKeep = entries.find((e) => alreadyKept.has(e.id));
    const members = entries.map(toMember);
    const keep = preferredKeep
      ? members.find((m) => m.id === preferredKeep.id) ?? pickKeep(members)
      : pickKeep(members);
    const drops = members.filter(
      (m) => m.id !== keep.id && !alreadyDropped.has(m.id),
    );
    if (!drops.length) continue;

    alreadyKept.add(keep.id);
    for (const d of drops) alreadyDropped.add(d.id);

    const reason =
      b.kind === "same-url"
        ? "正規化URLが同一"
        : b.kind === "same-canonical-url"
          ? "canonical_url が同一"
          : b.kind === "same-content-hash"
            ? "content_hash（本文）が同一"
            : b.kind === "near-url"
              ? "ホスト+パスが実質同一（www/追跡パラメータ差）"
              : b.kind === "youtube-id"
                ? "同一 YouTube 動画ID"
                : b.kind === "same-title"
                  ? "正規化タイトルが同一"
                  : "タイトル類似度が高い（同一記事の転載の可能性）";

    groups.push({
      id: groupId(b.kind, b.key),
      kind: b.kind,
      key: b.key.slice(0, 160),
      keepId: keep.id,
      dropIds: drops.map((d) => d.id),
      members: [keep, ...drops],
      reason,
      foundAt,
      reviewUntil,
      status: "holding",
    });
  }

  return groups;
}

async function ensureDupLayout(dataRoot: string): Promise<void> {
  await mkdir(path.join(dupDir(dataRoot), "quarantine"), { recursive: true });
}

async function writeReports(
  dataRoot: string,
  groups: DupGroup[],
  meta: { scanned: number; watchHours: number },
): Promise<{ reportPath: string; ledgerPath: string }> {
  const root = dupDir(dataRoot);
  await ensureDupLayout(dataRoot);
  const ledgerPath = path.join(root, "ledger.jsonl");
  const reportPath = path.join(root, "REPORT.md");
  const holdingPath = path.join(root, "HOLDING.md");

  const lines = groups.map((g) => JSON.stringify(g));
  await writeFile(ledgerPath, lines.join("\n") + (lines.length ? "\n" : ""), "utf8");

  const byKind: Record<string, number> = {};
  let dropN = 0;
  for (const g of groups) {
    byKind[g.kind] = (byKind[g.kind] ?? 0) + 1;
    dropN += g.dropIds.length;
  }

  const report = [
    `# 重複監視レポート`,
    "",
    `更新: ${nowIso()}`,
    "",
    `スキャン: **${meta.scanned}** 件`,
    `重複グループ: **${groups.length}**`,
    `除去候補: **${dropN}**`,
    `ウォッチ期間: **${meta.watchHours}** 時間`,
    "",
    "## 種別",
    "",
    ...Object.entries(byKind).map(([k, n]) => `- \`${k}\`: ${n}`),
    "",
    "## 進め方",
    "",
    "1. このレポートで「残す / 落とす」を確認",
    "2. ウォッチ期間中は `HOLDING.md` に待機",
    "3. 問題なければ `npm run dup:apply` で quarantine へ隔離",
    "4. カタログ再構築 + LINKS.html 更新まで自動",
    "",
    "## グループ（最大80）",
    "",
  ];

  for (const g of groups.slice(0, 80)) {
    const keep = g.members.find((m) => m.id === g.keepId);
    report.push(`### ${g.kind} · 落とす ${g.dropIds.length} · \`${g.id}\``);
    report.push("");
    report.push(`- 理由: ${g.reason}`);
    report.push(`- 残す: **${keep?.titleJa || keep?.title || g.keepId}**`);
    report.push(`  - ${keep?.url ?? ""}`);
    for (const d of g.members.filter((m) => m.id !== g.keepId).slice(0, 5)) {
      report.push(`- 落とす: ${d.titleJa || d.title}`);
      report.push(`  - ${d.url}`);
    }
    if (g.dropIds.length > 5) report.push(`- …他 ${g.dropIds.length - 5} 件`);
    report.push("");
  }

  await writeFile(reportPath, report.join("\n"), "utf8");

  const holding = [
    `# 重複ウォッチ中（HOLDING）`,
    "",
    `更新: ${nowIso()}`,
    "",
    `ウォッチ終了後に \`npm run dup:apply\` で隔離できます。`,
    `即時適用: \`npm run dup:apply -- --now\``,
    "",
    `| グループ | 種別 | 残す | 落とす数 | reviewUntil |`,
    `|----------|------|------|----------|-------------|`,
    ...groups.map((g) => {
      const keep = g.members.find((m) => m.id === g.keepId);
      const title = (keep?.titleJa || keep?.title || g.keepId).replace(/\|/g, "/").slice(0, 40);
      return `| \`${g.id}\` | ${g.kind} | ${title} | ${g.dropIds.length} | ${g.reviewUntil.slice(0, 16)} |`;
    }),
    "",
  ];
  await writeFile(holdingPath, holding.join("\n"), "utf8");

  await appendFile(
    path.join(root, "history.jsonl"),
    JSON.stringify({
      at: nowIso(),
      scanned: meta.scanned,
      groups: groups.length,
      drops: dropN,
      watchHours: meta.watchHours,
    }) + "\n",
    "utf8",
  );

  return { reportPath, ledgerPath };
}

async function loadLedger(dataRoot: string): Promise<DupGroup[]> {
  try {
    const raw = await readFile(path.join(dupDir(dataRoot), "ledger.jsonl"), "utf8");
    return raw
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((l) => JSON.parse(l) as DupGroup);
  } catch {
    return [];
  }
}

async function fileExists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

async function quarantineMember(
  dataRoot: string,
  member: DupMember,
  groupId: string,
): Promise<boolean> {
  const qDir = path.join(dupDir(dataRoot), "quarantine", groupId);
  await mkdir(qDir, { recursive: true });
  let moved = false;

  const candidates = [
    path.join(dataRoot, member.path),
    path.join(dataRoot, "by-source", member.source, path.basename(member.path)),
  ];

  for (const src of candidates) {
    if (!(await fileExists(src))) continue;
    const dest = path.join(qDir, path.basename(src));
    // 同名回避
    let finalDest = dest;
    if (await fileExists(finalDest)) {
      finalDest = path.join(qDir, `${member.id}-${path.basename(src)}`);
    }
    try {
      await rename(src, finalDest);
      moved = true;
    } catch {
      // ignore individual fail
    }
  }
  return moved;
}

export async function runDupWatch(
  config: AppConfig,
  opts: DupWatchOptions = {},
): Promise<DupWatchResult> {
  await assertDataRootReady(config);
  await ensureLayout(config.dataRoot);
  await ensureDupLayout(config.dataRoot);

  const watchHours =
    opts.watchHours ??
    config.dupWatchHours ??
    config.vetReviewHours ??
    24;
  const similarThreshold = opts.similarThreshold ?? 0.9;
  const maxSimilarComparisons = opts.maxSimilarComparisons ?? 400_000;

  console.log(`\n🔍 重複監視スキャン…（ウォッチ ${watchHours}h）`);
  const catalog = await loadCatalog(config.dataRoot);
  const now = Date.now();
  const groups = buildGroups(catalog, {
    similarThreshold,
    maxSimilarComparisons,
    watchHours,
    now,
  });

  const { reportPath, ledgerPath } = await writeReports(config.dataRoot, groups, {
    scanned: catalog.length,
    watchHours,
  });

  const byKind = {
    "same-url": 0,
    "near-url": 0,
    "youtube-id": 0,
    "same-title": 0,
    "similar-title": 0,
    "same-canonical-url": 0,
    "same-content-hash": 0,
  } as Record<DupKind, number>;
  let dropCandidates = 0;
  for (const g of groups) {
    byKind[g.kind]++;
    dropCandidates += g.dropIds.length;
  }

  console.log(
    `  groups=${groups.length} dropCandidates=${dropCandidates} report=${reportPath}`,
  );

  let applied = 0;
  if (opts.applyNow) {
    const applyRes = await runDupApply(config, {
      force: true,
      refreshLinks: opts.refreshLinks ?? true,
    });
    applied = applyRes.applied;
  }

  return {
    scanned: catalog.length,
    groups: groups.length,
    dropCandidates,
    applied,
    holding: opts.applyNow ? 0 : groups.length,
    byKind,
    reportPath,
    ledgerPath,
    quarantineDir: path.join(dupDir(config.dataRoot), "quarantine"),
    groupsList: groups,
  };
}

export interface DupApplyOptions {
  /** true なら reviewUntil 前でも適用 */
  force?: boolean;
  refreshLinks?: boolean;
}

export interface DupApplyResult {
  applied: number;
  skippedHolding: number;
  movedFiles: number;
  catalogTotal: number;
  reportPath: string;
}

export async function runDupApply(
  config: AppConfig,
  opts: DupApplyOptions = {},
): Promise<DupApplyResult> {
  await assertDataRootReady(config);
  await ensureLayout(config.dataRoot);
  await ensureDupLayout(config.dataRoot);

  const groups = await loadLedger(config.dataRoot);
  const now = Date.now();
  let applied = 0;
  let skippedHolding = 0;
  let movedFiles = 0;
  const byId = new Map(
    (await loadCatalog(config.dataRoot)).map((e) => [e.id, e]),
  );

  const updated: DupGroup[] = [];

  for (const g of groups) {
    if (g.status === "applied") {
      updated.push(g);
      continue;
    }
    const until = Date.parse(g.reviewUntil);
    if (!opts.force && Number.isFinite(until) && now < until) {
      skippedHolding++;
      updated.push(g);
      continue;
    }

    for (const dropId of g.dropIds) {
      const entry = byId.get(dropId);
      const member =
        g.members.find((m) => m.id === dropId) ??
        (entry
          ? toMember(entry)
          : null);
      if (!member) continue;
      const ok = await quarantineMember(config.dataRoot, member, g.id);
      if (ok) movedFiles++;
    }

    applied++;
    updated.push({
      ...g,
      status: "applied",
      appliedAt: nowIso(),
    });
  }

  const ledgerPath = path.join(dupDir(config.dataRoot), "ledger.jsonl");
  await writeFile(
    ledgerPath,
    updated.map((g) => JSON.stringify(g)).join("\n") +
      (updated.length ? "\n" : ""),
    "utf8",
  );

  console.log("  catalog rebuild…");
  const catalogTotal = await rebuildCatalogFromDisk(config.dataRoot);
  await writeIndexMd(config.dataRoot, {
    total: catalogTotal,
    lastRun: nowIso(),
  });

  if (opts.refreshLinks !== false) {
    try {
      await runLinksHtml(config);
    } catch (err) {
      console.warn(
        "  links refresh failed:",
        err instanceof Error ? err.message : err,
      );
    }
  }

  const applyReport = path.join(dupDir(config.dataRoot), "APPLY.md");
  await writeFile(
    applyReport,
    [
      `# 重複隔離の適用`,
      "",
      `更新: ${nowIso()}`,
      "",
      `- 適用グループ: ${applied}`,
      `- ウォッチ中スキップ: ${skippedHolding}`,
      `- 移動ファイル: ${movedFiles}`,
      `- カタログ: ${catalogTotal}`,
      "",
      `隔離先: \`vet/dup/quarantine/\``,
      "",
    ].join("\n"),
    "utf8",
  );

  console.log(
    `✓ dup:apply applied=${applied} skipped=${skippedHolding} moved=${movedFiles} catalog=${catalogTotal}`,
  );

  return {
    applied,
    skippedHolding,
    movedFiles,
    catalogTotal,
    reportPath: applyReport,
  };
}

export async function runDupStatus(config: AppConfig): Promise<{
  groups: number;
  holding: number;
  applied: number;
  dropPending: number;
  reportPath: string;
  latest: DupGroup[];
}> {
  await assertDataRootReady(config);
  const groups = await loadLedger(config.dataRoot);
  const holding = groups.filter((g) => g.status === "holding");
  const applied = groups.filter((g) => g.status === "applied");
  const dropPending = holding.reduce((n, g) => n + g.dropIds.length, 0);
  return {
    groups: groups.length,
    holding: holding.length,
    applied: applied.length,
    dropPending,
    reportPath: path.join(dupDir(config.dataRoot), "REPORT.md"),
    latest: holding.slice(0, 30),
  };
}
