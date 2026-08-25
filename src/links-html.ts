import { copyFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { assertDataRootReady, ensureLayout } from "./disk.js";
import { nowIso } from "./http.js";
import { loadCatalog, sortByRecency } from "./corpus.js";
import { resolveBridgeRoot } from "./ship.js";
import { glanceOf } from "./title-ja.js";
import { loadSources } from "./config.js";
import { readFleetStatus } from "./fleet/index.js";
import {
  DEFAULT_PATROL_MISSIONS,
  PATROL_WEIGHTS,
  type ShipKind,
} from "./fleet/types.js";
import type { AppConfig, CatalogEntry, Category, SourcesConfig } from "./types.js";
import { CATEGORIES } from "./types.js";

export type LinkKind = "video" | "web" | "paper";

/** NotebookLM のソース上限 */
export const NOTEBOOK_LM_PACK_SIZE = 300;

export interface LinksHtmlOptions {
  /** キーワード・バースト結果のバッジ */
  keywords?: string[];
  profile?: "patrol" | "burst";
  /**
   * 件数上限。未指定 / 0 / Infinity ならカタログ全件。
   */
  limit?: number;
  /** burst スナップショットも書く */
  snapshot?: boolean;
  /** 1束の URL 数（既定 300 = NotebookLM 上限） */
  packSize?: number;
}

export interface AgentCatRow {
  category: Category | string;
  label: string;
  agents: number;
  detail: string;
}

export interface AgentRoster {
  /** 船種ごとの論理エージェント（任務）数 */
  byShip: Array<{ ship: ShipKind; label: string; agents: number }>;
  /** コンテンツ棚ごとの担当エージェント数 */
  byCategory: AgentCatRow[];
  totalAgents: number;
  fleetRunId?: string;
  fleetProfile?: string;
  note: string;
}

const SHIP_LABEL: Record<ShipKind, string> = {
  youtube: "YouTube船",
  rss: "RSS/ニュース船",
  europepmc: "EuropePMC船",
  arxiv: "arXiv船",
  github: "GitHub船",
  reddit: "Reddit船",
  docs: "Docs船",
  x: "X船",
};

const CAT_LABEL: Partial<Record<Category, string>> = {
  llms: "LLM",
  agents: "エージェント",
  tools: "道具",
  research: "研究",
  industry: "産業AI",
  opensource: "OSS",
  multimodal: "マルチモーダル",
  safety: "安全",
  trends: "トレンド",
  mind: "心・心理",
  body: "からだ",
  dining: "飲食",
  biz: "ビジネス",
  reviews: "レビュー文献",
  other: "その他",
};

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function categoryLabel(cat: string): string {
  return CAT_LABEL[cat as Category] ?? cat;
}

/** URL を NotebookLM 上限サイズの束に分割（満たなければ実数のまま1束） */
export function chunkUrls(
  urls: string[],
  packSize = NOTEBOOK_LM_PACK_SIZE,
): string[][] {
  const unique = [...new Set(urls.map((u) => u.trim()).filter(Boolean))];
  const size = Math.max(1, Math.min(packSize, NOTEBOOK_LM_PACK_SIZE));
  const packs: string[][] = [];
  for (let i = 0; i < unique.length; i += size) {
    packs.push(unique.slice(i, i + size));
  }
  return packs.length ? packs : [[]];
}

export interface CategoryUrlGroup {
  category: string;
  label: string;
  urls: string[];
}

export interface UrlPackMeta {
  /** 例: カテゴリ「研究」 */
  grouping: string;
  groupingId: string;
  packIndex: number;
  packTotal: number;
  urls: string[];
}

export function groupCatalogUrlsByCategory(
  catalog: CatalogEntry[],
): CategoryUrlGroup[] {
  const map = new Map<string, string[]>();
  for (const e of catalog) {
    if (!e.url) continue;
    const cat = e.category || "other";
    const list = map.get(cat) ?? [];
    list.push(e.url);
    map.set(cat, list);
  }
  const extras = [...map.keys()]
    .filter((c) => !(CATEGORIES as string[]).includes(c))
    .sort();
  const keys = [...CATEGORIES.filter((c) => map.has(c)), ...extras];
  return keys.map((category) => ({
    category,
    label: categoryLabel(category),
    urls: [...new Set((map.get(category) ?? []).map((u) => u.trim()).filter(Boolean))],
  }));
}

export function buildCategoryPacks(
  catalog: CatalogEntry[],
  packSize = NOTEBOOK_LM_PACK_SIZE,
): { groups: CategoryUrlGroup[]; packs: UrlPackMeta[] } {
  const groups = groupCatalogUrlsByCategory(catalog);
  const size = Math.max(1, Math.min(packSize, NOTEBOOK_LM_PACK_SIZE));
  const packs: UrlPackMeta[] = [];
  for (const g of groups) {
    const chunks = chunkUrls(g.urls, size).filter((p) => p.length > 0);
    const grouping = `カテゴリ「${g.label}」`;
    chunks.forEach((urls, i) => {
      packs.push({
        grouping,
        groupingId: g.category,
        packIndex: i + 1,
        packTotal: chunks.length,
        urls,
      });
    });
  }
  return { groups, packs };
}

export function packHeading(pack: {
  grouping: string;
  packIndex: number;
  packTotal: number;
  count: number;
}): string {
  const split =
    pack.packTotal > 1 ? ` · 分割 ${pack.packIndex}/${pack.packTotal}` : "";
  return `${pack.grouping}${split}（実数 ${pack.count} 件）`;
}

/**
 * sources.json から「何体のエージェントがどの棚を担当しているか」を集計。
 * 論理船（フィード/クエリ1枠）= 1エージェント。
 */
export function buildAgentRoster(
  sources: SourcesConfig,
  fleet?: {
    state: { runId?: string; profile?: string; queued?: number } | null;
    missionByShip?: Partial<Record<ShipKind, number>>;
  },
): AgentRoster {
  const byCat = new Map<string, { agents: number; parts: string[] }>();
  const bump = (cat: string, n: number, part: string) => {
    if (n <= 0) return;
    const cur = byCat.get(cat) ?? { agents: 0, parts: [] };
    cur.agents += n;
    if (part) cur.parts.push(part);
    byCat.set(cat, cur);
  };

  if (sources.rss.enabled) {
    for (const f of sources.rss.feeds) {
      bump(f.categoryHint ?? "other", 1, `rss:${f.id}`);
    }
  }
  if (sources.youtube.enabled) {
    const nCh = sources.youtube.channels?.length ?? 0;
    if (nCh) bump("trends", nCh, `youtube:channels×${nCh}`);
    for (const s of sources.youtube.searchFeeds ?? []) {
      bump(s.categoryHint ?? "trends", 1, `youtube:search:${s.id}`);
    }
  }
  if (sources.arxiv.enabled) {
    const n =
      (sources.arxiv.categories?.length ?? 0) +
      (sources.arxiv.keywordQueries?.length ?? 0);
    if (n) bump("research", Math.max(1, n), `arxiv×${n}`);
  }
  if (sources.europePmc?.enabled) {
    const n = sources.europePmc.queries?.length ?? 0;
    if (n) bump("reviews", n, `europepmc×${n}`);
  }
  if (sources.github.enabled) {
    const n = sources.github.queries?.length ?? 0;
    if (n) bump("opensource", n, `github×${n}`);
  }
  if (sources.reddit.enabled) {
    const n = sources.reddit.subreddits?.length ?? 0;
    if (n) bump("trends", n, `reddit×${n}`);
  }
  if (sources.docs.enabled) {
    for (const f of sources.docs.feeds) {
      bump(f.categoryHint ?? "industry", 1, `docs:${f.id}`);
    }
  }
  if (sources.x.enabled) {
    for (const a of sources.x.accounts) {
      bump(a.categoryHint ?? "trends", 1, `x:@${a.handle}`);
    }
  }

  const byCategory: AgentCatRow[] = [...byCat.entries()]
    .map(([category, v]) => ({
      category,
      label: CAT_LABEL[category as Category] ?? category,
      agents: v.agents,
      detail:
        v.parts.length <= 4
          ? v.parts.join(" · ")
          : `${v.parts.slice(0, 3).join(" · ")} · ほか${v.parts.length - 3}系統`,
    }))
    .sort((a, b) => b.agents - a.agents);

  const live = fleet?.missionByShip;
  const byShip: AgentRoster["byShip"] = (
    Object.keys(PATROL_WEIGHTS) as ShipKind[]
  ).map((ship) => {
    const fromLive = live?.[ship];
    const weight = PATROL_WEIGHTS[ship];
    const agents =
      fromLive != null && fromLive > 0
        ? fromLive
        : Math.max(1, Math.floor(DEFAULT_PATROL_MISSIONS * weight));
    return { ship, label: SHIP_LABEL[ship], agents };
  });

  const totalAgents = byCategory.reduce((n, r) => n + r.agents, 0);

  return {
    byShip,
    byCategory,
    totalAgents,
    fleetRunId: fleet?.state?.runId,
    fleetProfile: fleet?.state?.profile,
    note:
      "論理エージェント数（フィード/クエリ1枠=1体）。OSプロセスではありません。" +
      (fleet?.state?.runId
        ? ` 直近船隊: ${fleet.state.runId}（${fleet.state.profile ?? "?"}・任務${fleet.state.queued ?? "?"}）`
        : ""),
  };
}

async function loadMissionByShip(
  dataRoot: string,
): Promise<Partial<Record<ShipKind, number>>> {
  try {
    const raw = await readFile(
      path.join(dataRoot, "fleet", "missions.jsonl"),
      "utf8",
    );
    const counts: Partial<Record<ShipKind, number>> = {};
    const seen = new Set<string>();
    for (const line of raw.trim().split("\n").filter(Boolean)) {
      const row = JSON.parse(line) as {
        id?: string;
        ship?: ShipKind;
        status?: string;
      };
      if (!row.id || !row.ship || row.status !== "queued") continue;
      if (seen.has(row.id)) continue;
      seen.add(row.id);
      counts[row.ship] = (counts[row.ship] ?? 0) + 1;
    }
    return counts;
  } catch {
    return {};
  }
}

export interface CategoryPackSummary {
  category: string;
  label: string;
  urlCount: number;
  packCount: number;
  dir: string;
}

/** NotebookLM 上限サイズの束を ready/links/packs/{category}/ に書き出す */
export async function writeCategoryUrlPacks(
  linksDir: string,
  groups: CategoryUrlGroup[],
  packSize = NOTEBOOK_LM_PACK_SIZE,
): Promise<{
  dir: string;
  packCount: number;
  byCategory: CategoryPackSummary[];
}> {
  const packsRoot = path.join(linksDir, "packs");
  await rm(packsRoot, { recursive: true, force: true });
  await mkdir(packsRoot, { recursive: true });
  const size = Math.max(1, Math.min(packSize, NOTEBOOK_LM_PACK_SIZE));
  const byCategory: CategoryPackSummary[] = [];

  for (const g of groups) {
    if (!g.urls.length) continue;
    const chunks = chunkUrls(g.urls, size).filter((p) => p.length > 0);
    const dir = path.join(packsRoot, g.category);
    await mkdir(dir, { recursive: true });
    const grouping = `カテゴリ「${g.label}」`;
    const indexLines = [
      `# ${grouping} の NotebookLM 束`,
      "",
      `まとまり: ${grouping}（id: ${g.category}）`,
      `総URL: ${g.urls.length} · 束数: ${chunks.length}`,
      `1束あたり最大 ${size} 件。満たない場合は実数のまま1束。`,
      "",
    ];
    let i = 0;
    for (const urls of chunks) {
      i += 1;
      const name = `pack-${String(i).padStart(3, "0")}.md`;
      await writeFile(
        path.join(dir, name),
        urlsOnlyMarkdown(
          urls,
          packHeading({
            grouping,
            packIndex: i,
            packTotal: chunks.length,
            count: urls.length,
          }),
          size,
          {
            grouping,
            groupingId: g.category,
            packIndex: i,
            packTotal: chunks.length,
          },
        ),
        "utf8",
      );
      const split = chunks.length > 1 ? ` ${i}/${chunks.length}` : "";
      indexLines.push(
        `- [${name}](./${name}) … ${grouping}${split} · 実数 ${urls.length}件`,
      );
    }
    await writeFile(
      path.join(dir, "INDEX.md"),
      `${indexLines.join("\n")}\n`,
      "utf8",
    );
    byCategory.push({
      category: g.category,
      label: g.label,
      urlCount: g.urls.length,
      packCount: chunks.length,
      dir,
    });
  }

  return {
    dir: packsRoot,
    packCount: byCategory.reduce((n, r) => n + r.packCount, 0),
    byCategory,
  };
}

export function classifyLink(entry: CatalogEntry): LinkKind {
  const tags = entry.tags ?? [];
  if (tags.includes("link:video") || entry.source === "youtube") return "video";
  if (
    tags.includes("link:paper") ||
    entry.source === "arxiv" ||
    entry.source === "europepmc" ||
    /arxiv\.org|doi\.org|pubmed\.ncbi|europepmc\.org/i.test(entry.url)
  ) {
    return "paper";
  }
  return "web";
}

function rowHtml(e: CatalogEntry, kind: LinkKind): string {
  const titleJa = glanceOf(e);
  const title = e.title;
  const cat = CAT_LABEL[e.category] ?? e.category;
  const when = (e.collected_at || "").slice(0, 19).replace("T", " ");
  const hay = escapeHtml(
    `${titleJa} ${title} ${e.url} ${cat} ${e.source} ${kind}`.toLowerCase(),
  );
  const urlAttr = escapeHtml(e.url);
  const catId = escapeHtml(e.category || "other");
  return `<tr data-hay="${hay}" data-kind="${kind}" data-url="${urlAttr}" data-cat="${catId}" data-cat-label="${escapeHtml(cat)}">
  <td class="t-check"><input type="checkbox" class="row-check" aria-label="選択" /></td>
  <td class="t-ja">${escapeHtml(titleJa)}</td>
  <td class="t-en">${escapeHtml(title)}</td>
  <td class="t-url"><a href="${urlAttr}" target="_blank" rel="noopener">${urlAttr}</a></td>
  <td class="t-cat">${escapeHtml(cat)}</td>
  <td class="t-src">${escapeHtml(e.source)}</td>
  <td class="t-when">${escapeHtml(when)}</td>
</tr>`;
}

function sectionTable(
  id: string,
  label: string,
  rows: string[],
): string {
  const colSpan = rows.length ? 7 : 7;
  return `
<section class="sec" id="${id}" data-sec="${id}">
  <div class="sec-head">
    <h2>${escapeHtml(label)} <span class="count">${rows.length}</span></h2>
    <button type="button" class="mini-btn sec-select-visible" data-sec="${id}">この欄の表示中を全選択</button>
  </div>
  <div class="table-wrap">
    <table>
      <thead>
        <tr>
          <th class="t-check"><input type="checkbox" class="sec-check-all" data-sec="${id}" title="この欄を全選択" aria-label="この欄を全選択" /></th>
          <th>日本語タイトル</th>
          <th>原文</th>
          <th>URL</th>
          <th>カテゴリ</th>
          <th>ソース</th>
          <th>収集日時</th>
        </tr>
      </thead>
      <tbody>
        ${rows.join("\n") || `<tr class="empty"><td colspan="${colSpan}">該当なし</td></tr>`}
      </tbody>
    </table>
  </div>
</section>`;
}

/** NotebookLM 向け: URL だけを1行ずつ（他情報なし）。先頭にまとまりを明記する。 */
export function urlsOnlyMarkdown(
  urls: string[],
  title = "URL一覧（NotebookLM用）",
  packSize = NOTEBOOK_LM_PACK_SIZE,
  meta?: {
    grouping?: string;
    groupingId?: string;
    packIndex?: number;
    packTotal?: number;
  },
): string {
  const unique = [...new Set(urls.map((u) => u.trim()).filter(Boolean))];
  const n = unique.length;
  const grouping = meta?.grouping ?? "まとまり未指定";
  const groupingId = meta?.groupingId;
  const packIndex = meta?.packIndex ?? 1;
  const packTotal = meta?.packTotal ?? 1;
  const under = n < packSize;
  const over = n > packSize;
  const splitLine =
    packTotal > 1
      ? `この束: ${packIndex} / ${packTotal}（同一まとまりを上限 ${packSize} 件で分割）`
      : `この束: 1 / 1（分割なし）`;
  const countLine = under
    ? `件数: ${n}（上限 ${packSize} 件に満たないため実数のまま1束）`
    : `件数: ${n}（NotebookLM 上限 ${packSize} 件）`;
  const overNote = over
    ? `\n⚠ このファイルは ${n} 件あり上限を超えます。ready/links/packs/ のカテゴリ別束（各最大 ${packSize}）を使ってください。`
    : "";
  const lines = [
    `# ${title}`,
    "",
    `まとまり: ${grouping}${groupingId ? `（id: ${groupingId}）` : ""}`,
    splitLine,
    `${countLine}${overNote}`,
    "",
    "以下は URL のみです。このままコピーして NotebookLM に貼れます。",
    "",
    "```",
    ...unique,
    "```",
    "",
    "---",
    "",
    "## URLのみ（コードブロックなし・貼り付け用）",
    "",
    ...unique,
    "",
  ];
  return lines.join("\n");
}

function renderAgentRosterHtml(roster: AgentRoster): string {
  const catRows = roster.byCategory
    .map(
      (r) =>
        `<li><span class="ag-label">${escapeHtml(r.label)}</span><span class="ag-n">${r.agents}</span><span class="ag-unit">体</span><span class="ag-detail">${escapeHtml(r.detail)}</span></li>`,
    )
    .join("\n");
  const shipRows = roster.byShip
    .map(
      (r) =>
        `<li><span class="ag-label">${escapeHtml(r.label)}</span><span class="ag-n">${r.agents}</span><span class="ag-unit">体</span></li>`,
    )
    .join("\n");
  return `
<section class="agent-roster" id="agent-roster" aria-label="収集エージェント配置">
  <div class="roster-head">
    <h2>収集エージェント配置 <span class="count">計 ${roster.totalAgents} 体</span></h2>
    <p class="roster-note">${escapeHtml(roster.note)}</p>
  </div>
  <div class="roster-grid">
    <div class="roster-col">
      <h3>カテゴリ別（情報収集の担当数）</h3>
      <ul class="ag-list">${catRows || "<li class='empty'>データなし</li>"}</ul>
    </div>
    <div class="roster-col">
      <h3>船種別（パトロール配分 / 直近任務）</h3>
      <ul class="ag-list">${shipRows}</ul>
    </div>
  </div>
</section>`;
}

function renderCategoryPacksHtml(
  groups: CategoryUrlGroup[],
  packSize: number,
): string {
  const rows = groups
    .map((g) => {
      const nPacks = Math.max(1, Math.ceil(g.urls.length / packSize) || 1);
      const actualNote =
        g.urls.length <= packSize
          ? `実数 ${g.urls.length} 件・1束`
          : `${g.urls.length} 件 → ${nPacks} 束（各最大 ${packSize}）`;
      return `<li><span class="ag-label">カテゴリ「${escapeHtml(g.label)}」</span><span class="ag-n">${nPacks}</span><span class="ag-unit">束</span><span class="ag-detail">${escapeHtml(actualNote)} · packs/${escapeHtml(g.category)}/</span></li>`;
    })
    .join("\n");
  const totalPacks = groups.reduce((n, g) => {
    if (!g.urls.length) return n;
    return n + Math.max(1, Math.ceil(g.urls.length / packSize));
  }, 0);
  return `
<section class="agent-roster cat-packs" id="cat-packs" aria-label="カテゴリ別 NotebookLM 束">
  <div class="roster-head">
    <h2>カテゴリ別 NotebookLM 束 <span class="count">計 ${totalPacks} 束</span></h2>
    <p class="roster-note">まとまりはカテゴリ。1束は最大 ${packSize} 件。満たなければ実数のまま1束。ファイルは ready/links/packs/カテゴリ名/</p>
  </div>
  <ul class="ag-list">${rows || "<li class='empty'>データなし</li>"}</ul>
</section>`;
}

function renderHtml(
  catalog: CatalogEntry[],
  opts: LinksHtmlOptions,
  roster: AgentRoster,
): string {
  const video: string[] = [];
  const web: string[] = [];
  const paper: string[] = [];

  for (const e of catalog) {
    const kind = classifyLink(e);
    const row = rowHtml(e, kind);
    if (kind === "video") video.push(row);
    else if (kind === "paper") paper.push(row);
    else web.push(row);
  }

  const kwBadges = (opts.keywords ?? [])
    .map((k) => `<span class="badge kw">${escapeHtml(k)}</span>`)
    .join("");
  const profileBadge = opts.profile
    ? `<span class="badge profile">${escapeHtml(opts.profile)}</span>`
    : "";
  const packSize = Math.max(
    1,
    Math.min(opts.packSize ?? NOTEBOOK_LM_PACK_SIZE, NOTEBOOK_LM_PACK_SIZE),
  );
  const { groups: catGroups, packs: catPacks } = buildCategoryPacks(
    catalog,
    packSize,
  );
  const packEstimate = Math.max(1, catPacks.length);

  return `<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>LINKS — 収集リンク一覧</title>
  <style>
    :root {
      --bg: #0f1419;
      --panel: #1a222c;
      --ink: #e8eef4;
      --muted: #8b9aab;
      --line: #2a3542;
      --accent: #3d9cf0;
      --video: #e85d4c;
      --web: #3d9cf0;
      --paper: #c9a227;
      --ok: #5ee08a;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: "Hiragino Sans", "Noto Sans JP", system-ui, sans-serif;
      background:
        radial-gradient(1200px 600px at 10% -10%, #1a2a3a 0%, transparent 55%),
        radial-gradient(900px 500px at 100% 0%, #1e1820 0%, transparent 50%),
        var(--bg);
      color: var(--ink);
      line-height: 1.45;
      min-height: 100vh;
    }
    header {
      padding: 1.25rem 1.5rem 0.75rem;
      border-bottom: 1px solid var(--line);
      background: linear-gradient(180deg, rgba(26,34,44,.92), rgba(15,20,25,.4));
      position: sticky;
      top: 0;
      z-index: 5;
      backdrop-filter: blur(8px);
    }
    h1 {
      margin: 0 0 0.35rem;
      font-size: 1.55rem;
      letter-spacing: 0.04em;
      font-weight: 700;
    }
    .meta { color: var(--muted); font-size: 0.9rem; margin-bottom: 0.75rem; }
    .badges { display: flex; flex-wrap: wrap; gap: 0.4rem; margin-bottom: 0.75rem; }
    .badge {
      display: inline-block;
      padding: 0.2rem 0.55rem;
      border: 1px solid var(--line);
      background: var(--panel);
      font-size: 0.8rem;
      border-radius: 2px;
    }
    .badge.kw { border-color: #4a6a40; color: #b8e0a8; }
    .badge.profile { border-color: #4a5a80; color: #a8c4e0; }
    .toolbar {
      display: flex;
      flex-wrap: wrap;
      gap: 0.6rem;
      align-items: center;
    }
    .tabs { display: flex; gap: 0.35rem; flex-wrap: wrap; }
    .tab, .act-btn, .mini-btn {
      appearance: none;
      border: 1px solid var(--line);
      background: var(--panel);
      color: var(--ink);
      padding: 0.4rem 0.75rem;
      cursor: pointer;
      font: inherit;
      border-radius: 2px;
    }
    .tab[aria-selected="true"] { border-color: var(--accent); color: #fff; }
    .tab[data-kind="video"][aria-selected="true"] { border-color: var(--video); }
    .tab[data-kind="web"][aria-selected="true"] { border-color: var(--web); }
    .tab[data-kind="paper"][aria-selected="true"] { border-color: var(--paper); }
    .act-btn.primary { border-color: var(--ok); color: var(--ok); font-weight: 600; }
    .act-btn:disabled { opacity: 0.45; cursor: not-allowed; }
    .mini-btn { font-size: 0.78rem; padding: 0.25rem 0.55rem; }
    .export-bar {
      display: flex;
      flex-wrap: wrap;
      gap: 0.5rem;
      align-items: center;
      margin-top: 0.75rem;
      padding-top: 0.75rem;
      border-top: 1px solid var(--line);
    }
    .sel-count { color: var(--gold, #ffd65e); font-size: 0.9rem; min-width: 7rem; }
    .toast {
      display: none;
      position: fixed;
      left: 50%;
      top: 32%;
      transform: translate(-50%, -50%);
      z-index: 10000;
      min-width: 14rem;
      max-width: min(28rem, 92vw);
      padding: 1.05rem 1.35rem 0.95rem;
      border: 2px solid var(--ok);
      color: #e8ffe8;
      background: rgba(10, 28, 16, 0.96);
      font-size: 1.2rem;
      font-weight: 700;
      letter-spacing: 0.06em;
      text-align: center;
      box-shadow: 0 16px 48px rgba(0, 0, 0, 0.55);
      pointer-events: none;
    }
    .toast.on { display: block; animation: toast-pop 0.16s ease-out; }
    .toast .toast-sub {
      display: block;
      margin-top: 0.4rem;
      font-size: 0.8rem;
      font-weight: 500;
      letter-spacing: 0;
      color: #b8e0a8;
    }
    @keyframes toast-pop {
      from { opacity: 0; transform: translate(-50%, -42%) scale(0.92); }
      to { opacity: 1; transform: translate(-50%, -50%) scale(1); }
    }
    .pack-btn.just-copied { border-color: var(--ok); color: #fff; background: #1c3a22; }
    #q {
      flex: 1;
      min-width: 12rem;
      padding: 0.45rem 0.65rem;
      border: 1px solid var(--line);
      background: #12181f;
      color: var(--ink);
      font: inherit;
      border-radius: 2px;
    }
    main { padding: 1rem 1.5rem 3rem; }
    .sec { margin-bottom: 2rem; }
    .sec.hidden { display: none; }
    .sec-head {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: space-between;
      gap: 0.5rem;
      margin-bottom: 0.5rem;
    }
    h2 {
      font-size: 1.1rem;
      margin: 0;
      display: flex;
      align-items: baseline;
      gap: 0.5rem;
    }
    .count {
      font-size: 0.85rem;
      color: var(--muted);
      font-weight: 500;
    }
    .table-wrap { overflow-x: auto; border: 1px solid var(--line); background: var(--panel); }
    table { width: 100%; border-collapse: collapse; font-size: 0.86rem; }
    th, td { padding: 0.55rem 0.65rem; text-align: left; border-bottom: 1px solid var(--line); vertical-align: top; }
    th { color: var(--muted); font-weight: 600; white-space: nowrap; background: #151c24; position: sticky; top: 0; }
    tr.hidden-row { display: none; }
    tr.selected { background: rgba(61,156,240,.12); }
    tr.empty td { color: var(--muted); text-align: center; padding: 1.5rem; }
    a { color: var(--accent); word-break: break-all; }
    .t-check { width: 2rem; text-align: center; }
    .t-ja { font-weight: 600; min-width: 10rem; max-width: 18rem; }
    .t-en { color: var(--muted); min-width: 10rem; max-width: 18rem; }
    .t-url { min-width: 14rem; }
    .t-cat, .t-src, .t-when { white-space: nowrap; color: var(--muted); }
    .agent-roster {
      margin: 0 1.5rem 1.25rem;
      padding: 1rem 1.1rem;
      border: 1px solid var(--line);
      background: linear-gradient(135deg, rgba(26,34,44,.95), rgba(18,24,32,.85));
    }
    .roster-head h2 { margin: 0 0 0.35rem; font-size: 1.05rem; }
    .roster-note { margin: 0 0 0.75rem; color: var(--muted); font-size: 0.82rem; }
    .roster-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 1rem;
    }
    .roster-col h3 {
      margin: 0 0 0.45rem;
      font-size: 0.88rem;
      color: var(--muted);
      font-weight: 600;
    }
    .ag-list {
      list-style: none;
      margin: 0;
      padding: 0;
      display: flex;
      flex-direction: column;
      gap: 0.28rem;
    }
    .ag-list li {
      display: grid;
      grid-template-columns: 1fr auto auto;
      gap: 0.35rem 0.5rem;
      align-items: baseline;
      padding: 0.28rem 0.4rem;
      border-bottom: 1px solid rgba(42,53,66,.7);
      font-size: 0.86rem;
    }
    .ag-list li .ag-detail {
      grid-column: 1 / -1;
      color: var(--muted);
      font-size: 0.75rem;
    }
    .ag-n { font-weight: 700; color: var(--ok); font-variant-numeric: tabular-nums; }
    .ag-unit { color: var(--muted); font-size: 0.78rem; }
    .pack-bar {
      display: flex;
      flex-wrap: wrap;
      gap: 0.45rem;
      align-items: center;
      margin-top: 0.65rem;
      padding: 0.55rem 0.65rem;
      border: 1px dashed var(--line);
      background: rgba(18,24,31,.55);
    }
    .pack-bar .pack-label { color: var(--muted); font-size: 0.85rem; }
    .pack-bar .pack-warn { color: #ffd65e; font-size: 0.85rem; }
    .pack-btns { display: flex; flex-wrap: wrap; gap: 0.35rem; align-items: center; }
    .pack-group-label {
      width: 100%;
      margin-top: 0.35rem;
      color: var(--ink);
      font-size: 0.8rem;
      font-weight: 600;
    }
    .pack-btn {
      appearance: none;
      border: 1px solid #4a6a40;
      background: #152018;
      color: #b8e0a8;
      padding: 0.28rem 0.55rem;
      cursor: pointer;
      font: inherit;
      font-size: 0.78rem;
      border-radius: 2px;
    }
    .pack-btn:hover { border-color: var(--ok); color: #fff; }
    #url-preview {
      display: none;
      margin: 0 1.5rem 1.5rem;
      border: 1px solid var(--line);
      background: var(--panel);
      padding: 0.75rem;
    }
    #url-preview.on { display: block; }
    #url-preview h3 { margin: 0 0 0.5rem; font-size: 0.95rem; color: var(--muted); }
    #url-preview textarea {
      width: 100%;
      min-height: 10rem;
      font-family: ui-monospace, Menlo, monospace;
      font-size: 0.8rem;
      background: #12181f;
      color: var(--ink);
      border: 1px solid var(--line);
      padding: 0.6rem;
      resize: vertical;
    }
    @media (max-width: 720px) {
      header, main { padding-left: 0.85rem; padding-right: 0.85rem; }
      .agent-roster { margin-left: 0.85rem; margin-right: 0.85rem; }
      .roster-grid { grid-template-columns: 1fr; }
      .t-en { display: none; }
      th:nth-child(3), td:nth-child(3) { display: none; }
    }
  </style>
</head>
<body>
  <header>
    <h1>LINKS</h1>
    <p class="meta">更新 ${escapeHtml(nowIso())} · 全 ${catalog.length} 件 · NotebookLM はソース最大 ${packSize} 件/ノート · カテゴリ別 ${packEstimate} 束</p>
    <div class="badges">${profileBadge}${kwBadges}<span class="badge">エージェント計 ${roster.totalAgents} 体</span></div>
    <div class="toolbar">
      <div class="tabs" role="tablist">
        <button type="button" class="tab" role="tab" data-kind="all" aria-selected="true">すべて</button>
        <button type="button" class="tab" role="tab" data-kind="video" aria-selected="false">動画 (${video.length})</button>
        <button type="button" class="tab" role="tab" data-kind="web" aria-selected="false">Web (${web.length})</button>
        <button type="button" class="tab" role="tab" data-kind="paper" aria-selected="false">論文 (${paper.length})</button>
      </div>
      <input id="q" type="search" placeholder="複数OK: スペース / カンマ区切り（すべて含む） 例: Anthropic safety, agent" autocomplete="off" />
    </div>
    <div class="export-bar" aria-label="URL書き出し">
      <span class="sel-count" id="sel-count">選択 0</span>
      <button type="button" class="act-btn" id="btn-select-visible">表示中を全選択</button>
      <button type="button" class="act-btn" id="btn-clear">選択解除</button>
      <button type="button" class="act-btn primary" id="btn-copy">選択をコピー（同一カテゴリ・≤${packSize}）</button>
      <button type="button" class="act-btn primary" id="btn-copy-tab">先頭カテゴリ束をコピー</button>
      <button type="button" class="act-btn" id="btn-md">カテゴリ別.mdで保存</button>
      <button type="button" class="act-btn" id="btn-preview">プレビュー表示</button>
    </div>
    <div class="pack-bar" id="pack-bar" aria-label="NotebookLM用のカテゴリ別束">
      <span class="pack-label">NotebookLM 用の束（カテゴリ別・最大 ${packSize} URL・満たなければ実数）:</span>
      <span class="pack-warn" id="pack-warn"></span>
      <div class="pack-btns" id="pack-btns"></div>
    </div>
  </header>
  ${renderAgentRosterHtml(roster)}
  ${renderCategoryPacksHtml(catGroups, packSize)}
  <main>
    ${sectionTable("video", "動画（YouTube）", video)}
    ${sectionTable("web", "ウェブサイト", web)}
    ${sectionTable("paper", "論文", paper)}
  </main>
  <div id="url-preview">
    <h3>URLのみ（ここから手動コピーも可）</h3>
    <textarea id="url-box" readonly spellcheck="false"></textarea>
  </div>
  <div class="toast" id="toast" role="status" aria-live="assertive"></div>
  <script>
    (function () {
      var PACK_SIZE = ${packSize};
      var q = document.getElementById("q");
      var tabs = document.querySelectorAll(".tab");
      var kind = "all";
      var toast = document.getElementById("toast");
      var selCount = document.getElementById("sel-count");
      var preview = document.getElementById("url-preview");
      var urlBox = document.getElementById("url-box");
      var packWarn = document.getElementById("pack-warn");
      var packBtns = document.getElementById("pack-btns");
      var toastTimer = null;

      function showToast(msg, sub) {
        toast.innerHTML = "";
        toast.appendChild(document.createTextNode(msg || "コピーしました"));
        if (sub) {
          var s = document.createElement("span");
          s.className = "toast-sub";
          s.textContent = sub;
          toast.appendChild(s);
        }
        toast.classList.add("on");
        if (toastTimer) clearTimeout(toastTimer);
        toastTimer = setTimeout(function () { toast.classList.remove("on"); }, 2200);
      }

      function visibleRows(sec) {
        return Array.prototype.slice.call(
          (sec || document).querySelectorAll("tbody tr[data-url]:not(.hidden-row)")
        ).filter(function (tr) {
          var s = tr.closest(".sec");
          return s && !s.classList.contains("hidden");
        });
      }

      function selectedUrls() {
        var urls = [];
        document.querySelectorAll("tbody tr[data-url] .row-check:checked").forEach(function (cb) {
          var tr = cb.closest("tr");
          if (tr && tr.getAttribute("data-url")) urls.push(tr.getAttribute("data-url"));
        });
        return unique(urls);
      }

      function tabUrls() {
        var urls = [];
        visibleRows().forEach(function (tr) {
          urls.push(tr.getAttribute("data-url"));
        });
        return unique(urls);
      }

      function unique(arr) {
        var seen = {};
        var out = [];
        arr.forEach(function (u) {
          if (!u || seen[u]) return;
          seen[u] = 1;
          out.push(u);
        });
        return out;
      }

      function chunk(urls, size) {
        var packs = [];
        for (var i = 0; i < urls.length; i += size) packs.push(urls.slice(i, i + size));
        return packs.length ? packs : [[]];
      }

      function urlsText(urls) {
        return urls.join("\\n");
      }

      function selectedRows() {
        return Array.prototype.slice.call(
          document.querySelectorAll("tbody tr[data-url] .row-check:checked")
        ).map(function (cb) { return cb.closest("tr"); }).filter(Boolean);
      }

      function activeRows() {
        var sel = selectedRows();
        return sel.length ? sel : visibleRows();
      }

      function packsFromRows(rows) {
        var byCat = {};
        var order = [];
        rows.forEach(function (tr) {
          if (!tr) return;
          var cat = tr.getAttribute("data-cat") || "other";
          var label = tr.getAttribute("data-cat-label") || cat;
          if (!byCat[cat]) {
            byCat[cat] = { cat: cat, label: label, urls: [] };
            order.push(cat);
          }
          var u = tr.getAttribute("data-url");
          if (u) byCat[cat].urls.push(u);
        });
        var packs = [];
        order.forEach(function (cat) {
          var g = byCat[cat];
          var urls = unique(g.urls);
          var chunks = chunk(urls, PACK_SIZE).filter(function (p) { return p.length; });
          chunks.forEach(function (part, i) {
            packs.push({
              grouping: "カテゴリ「" + g.label + "」",
              groupingId: cat,
              packIndex: i + 1,
              packTotal: chunks.length,
              urls: part
            });
          });
        });
        return packs;
      }

      function packLabel(pack) {
        if (pack.packTotal > 1) {
          return pack.grouping + " " + pack.packIndex + "/" + pack.packTotal + "（" + pack.urls.length + "件）";
        }
        return pack.grouping + "（実数 " + pack.urls.length + "件）";
      }

      function refreshPackBar() {
        var packs = packsFromRows(activeRows());
        if (!packs.length) {
          packWarn.textContent = "選択または表示中の URL がありません";
          packBtns.innerHTML = "";
          return;
        }
        var cats = {};
        packs.forEach(function (p) { cats[p.groupingId] = 1; });
        packWarn.textContent = Object.keys(cats).length + " カテゴリ → " + packs.length + " 束（最大 " + PACK_SIZE + "、満たなければ実数）";
        packBtns.innerHTML = "";
        var lastCat = "";
        packs.forEach(function (pack) {
          if (pack.groupingId !== lastCat) {
            lastCat = pack.groupingId;
            var lab = document.createElement("span");
            lab.className = "pack-group-label";
            lab.textContent = pack.grouping;
            packBtns.appendChild(lab);
          }
          var btn = document.createElement("button");
          btn.type = "button";
          btn.className = "pack-btn";
          btn.textContent = pack.packTotal > 1
            ? "分割" + pack.packIndex + "/" + pack.packTotal + " コピー（" + pack.urls.length + "）"
            : "コピー（実数 " + pack.urls.length + "）";
          btn.addEventListener("click", function () {
            copyText(urlsText(pack.urls), packLabel(pack), btn);
          });
          packBtns.appendChild(btn);
          var md = document.createElement("button");
          md.type = "button";
          md.className = "pack-btn";
          md.textContent = ".md";
          md.addEventListener("click", function () {
            downloadMd(pack);
          });
          packBtns.appendChild(md);
        });
      }

      function updateSel() {
        var n = selectedUrls().length;
        var packs = packsFromRows(selectedRows());
        selCount.textContent = n
          ? "選択 " + n + "（" + packs.length + "束）"
          : "選択 0";
        document.querySelectorAll("tbody tr[data-url]").forEach(function (tr) {
          var on = tr.querySelector(".row-check") && tr.querySelector(".row-check").checked;
          tr.classList.toggle("selected", !!on);
        });
        refreshPackBar();
      }

      function parseKeywords(raw) {
        return (raw || "")
          .toLowerCase()
          .split(/[\s,，、|／/]+/)
          .map(function (t) { return t.trim(); })
          .filter(function (t) { return t.length > 0; });
      }

      function hayMatchesAll(hay, keywords) {
        if (!keywords.length) return true;
        for (var i = 0; i < keywords.length; i++) {
          if (hay.indexOf(keywords[i]) === -1) return false;
        }
        return true;
      }

      function apply() {
        var keywords = parseKeywords(q.value);
        document.querySelectorAll(".sec").forEach(function (sec) {
          var id = sec.getAttribute("data-sec");
          var showSec = kind === "all" || kind === id;
          sec.classList.toggle("hidden", !showSec);
          if (!showSec) return;
          sec.querySelectorAll("tbody tr[data-hay]").forEach(function (tr) {
            var hay = tr.getAttribute("data-hay") || "";
            var ok = hayMatchesAll(hay, keywords);
            tr.classList.toggle("hidden-row", !ok);
          });
        });
        updateSel();
      }

      function copyViaExec(text) {
        var ta = document.createElement("textarea");
        ta.value = text;
        ta.setAttribute("readonly", "");
        ta.style.position = "fixed";
        ta.style.left = "-9999px";
        document.body.appendChild(ta);
        ta.select();
        ta.setSelectionRange(0, ta.value.length);
        var ok = false;
        try { ok = document.execCommand("copy"); } catch (e) { ok = false; }
        document.body.removeChild(ta);
        return ok;
      }

      async function copyText(text, detail, btn) {
        if (!text) {
          showToast("コピーする URL がありません");
          return;
        }
        var n = text.split("\\n").filter(Boolean).length;
        if (n > PACK_SIZE) {
          showToast("上限超えです", n + " 件は上限 " + PACK_SIZE + " を超えます。束ボタンで分けてください");
          refreshPackBar();
          return;
        }
        var ok = false;
        try {
          await navigator.clipboard.writeText(text);
          ok = true;
        } catch (e) {
          ok = copyViaExec(text);
        }
        if (ok) {
          showToast("コピーしました", detail || (n + " 件"));
          if (btn) {
            btn.classList.add("just-copied");
            setTimeout(function () { btn.classList.remove("just-copied"); }, 1200);
          }
          return;
        }
        urlBox.value = text;
        preview.classList.add("on");
        urlBox.focus();
        urlBox.select();
        showToast("手動コピーしてください", "クリップボード不可 → 下の枠を選択してコピー");
      }

      function downloadMd(pack) {
        if (!pack || !pack.urls.length) {
          showToast("保存する URL がありません");
          return;
        }
        var split = pack.packTotal > 1
          ? " · 分割 " + pack.packIndex + "/" + pack.packTotal
          : "";
        var head = "# " + pack.grouping + split + "（実数 " + pack.urls.length + " 件）";
        var under = pack.urls.length < PACK_SIZE;
        var body = [
          head,
          "",
          "まとまり: " + pack.grouping + "（id: " + pack.groupingId + "）",
          pack.packTotal > 1
            ? "この束: " + pack.packIndex + " / " + pack.packTotal + "（同一まとまりを上限 " + PACK_SIZE + " 件で分割）"
            : "この束: 1 / 1（分割なし）",
          "件数: " + pack.urls.length + (under
            ? "（上限 " + PACK_SIZE + " 件に満たないため実数のまま1束）"
            : "（NotebookLM 上限 " + PACK_SIZE + " 件）"),
          "",
          "以下は URL のみです。",
          "",
          "\`\`\`",
          pack.urls.join("\\n"),
          "\`\`\`",
          "",
          "---",
          "",
          "## URLのみ（貼り付け用）",
          "",
          pack.urls.join("\\n"),
          ""
        ].join("\\n");
        var stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
        var slug = pack.groupingId + "-" + String(pack.packIndex).padStart(3, "0");
        var blob = new Blob([body], { type: "text/markdown;charset=utf-8" });
        var a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = "urls-" + slug + "-" + stamp + ".md";
        a.click();
        URL.revokeObjectURL(a.href);
        showToast(packLabel(pack) + " を .md で保存しました");
      }

      function downloadAllPacks() {
        var packs = packsFromRows(activeRows());
        if (!packs.length) {
          showToast("保存する URL がありません");
          return;
        }
        packs.forEach(function (pack, idx) {
          setTimeout(function () { downloadMd(pack); }, idx * 120);
        });
        showToast(packs.length + " 束の .md を順に保存します（カテゴリ別）");
      }

      tabs.forEach(function (btn) {
        btn.addEventListener("click", function () {
          kind = btn.getAttribute("data-kind") || "all";
          tabs.forEach(function (b) {
            b.setAttribute("aria-selected", b === btn ? "true" : "false");
          });
          apply();
        });
      });
      q.addEventListener("input", apply);

      document.addEventListener("change", function (ev) {
        var t = ev.target;
        if (t.classList && t.classList.contains("row-check")) {
          updateSel();
          return;
        }
        if (t.classList && t.classList.contains("sec-check-all")) {
          var secId = t.getAttribute("data-sec");
          var sec = document.getElementById(secId);
          if (!sec) return;
          var on = t.checked;
          sec.querySelectorAll("tbody tr[data-url]:not(.hidden-row) .row-check").forEach(function (cb) {
            cb.checked = on;
          });
          updateSel();
        }
      });

      document.querySelectorAll(".sec-select-visible").forEach(function (btn) {
        btn.addEventListener("click", function () {
          var sec = document.getElementById(btn.getAttribute("data-sec"));
          if (!sec || sec.classList.contains("hidden")) return;
          sec.querySelectorAll("tbody tr[data-url]:not(.hidden-row) .row-check").forEach(function (cb) {
            cb.checked = true;
          });
          updateSel();
          showToast("この欄の表示中を選択しました");
        });
      });

      document.getElementById("btn-select-visible").addEventListener("click", function () {
        visibleRows().forEach(function (tr) {
          var cb = tr.querySelector(".row-check");
          if (cb) cb.checked = true;
        });
        updateSel();
        showToast("表示中を全選択しました");
      });
      document.getElementById("btn-clear").addEventListener("click", function () {
        document.querySelectorAll(".row-check, .sec-check-all").forEach(function (cb) {
          cb.checked = false;
        });
        updateSel();
      });
      document.getElementById("btn-copy").addEventListener("click", function () {
        var rows = selectedRows();
        if (!rows.length) {
          showToast("先に行を選択してください（または下のカテゴリ束ボタンを使ってください）");
          return;
        }
        var packs = packsFromRows(rows);
        if (packs.length !== 1) {
          showToast("複数カテゴリまたは分割が必要です。下のカテゴリ束ボタンでコピーしてください");
          refreshPackBar();
          return;
        }
        copyText(urlsText(packs[0].urls), packLabel(packs[0]));
      });
      document.getElementById("btn-copy-tab").addEventListener("click", function () {
        var packs = packsFromRows(visibleRows());
        if (!packs.length) {
          showToast("コピーする URL がありません");
          return;
        }
        copyText(
          urlsText(packs[0].urls),
          packLabel(packs[0]) + (packs.length > 1 ? " · 残りは下の束ボタンへ" : "")
        );
        refreshPackBar();
      });
      document.getElementById("btn-md").addEventListener("click", function () {
        downloadAllPacks();
      });
      document.getElementById("btn-preview").addEventListener("click", function () {
        var packs = packsFromRows(activeRows());
        var first = packs[0];
        if (!first) {
          showToast("プレビューする URL がありません");
          return;
        }
        urlBox.value = urlsText(first.urls);
        preview.classList.add("on");
        urlBox.focus();
        urlBox.select();
        showToast(
          packs.length > 1
            ? "プレビューは " + packLabel(first) + "。全カテゴリは束ボタンで"
            : packLabel(first) + " をプレビューに出しました"
        );
      });

      apply();
    })();
  </script>
</body>
</html>`;
}

export interface LinksHtmlResult {
  path: string;
  mobilePath: string;
  snapshotPath?: string;
  urlsMd?: {
    all: string;
    video: string;
    web: string;
    paper: string;
    byCategory: Record<string, string>;
  };
  packs?: {
    dir: string;
    packCount: number;
    byCategory: CategoryPackSummary[];
  };
  agentRoster?: AgentRoster;
  counts: { video: number; web: number; paper: number; total: number };
}

export async function runLinksHtml(
  config: AppConfig,
  opts: LinksHtmlOptions = {},
): Promise<LinksHtmlResult> {
  await assertDataRootReady(config);
  await ensureLayout(config.dataRoot);

  const packSize = Math.max(
    1,
    Math.min(opts.packSize ?? NOTEBOOK_LM_PACK_SIZE, NOTEBOOK_LM_PACK_SIZE),
  );

  const sources = await loadSources();
  const fleetStatus = await readFleetStatus(config.dataRoot);
  const missionByShip = await loadMissionByShip(config.dataRoot);
  const roster = buildAgentRoster(sources, {
    state: fleetStatus.state,
    missionByShip,
  });

  const hardCap = 100_000;
  const wantAll = opts.limit == null || opts.limit <= 0 || !Number.isFinite(opts.limit);
  const limit = wantAll ? hardCap : Math.min(Math.round(opts.limit!), hardCap);
  const catalog = sortByRecency(await loadCatalog(config.dataRoot)).slice(
    0,
    limit,
  );
  const html = renderHtml(catalog, { ...opts, packSize }, roster);
  console.log(
    `📎 LINKS.html 生成: ${catalog.length}件` +
      (wantAll ? "（カタログ優先・新しい順）" : `（上限 ${limit}）`) +
      ` · エージェント ${roster.totalAgents}体 · 束サイズ ${packSize}`,
  );

  const readyDir = path.join(config.dataRoot, "ready");
  const linksDir = path.join(readyDir, "links");
  await mkdir(linksDir, { recursive: true });

  const outPath = path.join(readyDir, "LINKS.html");
  await writeFile(outPath, html, "utf8");

  // NotebookLM 用: 種別ごとの URL ダンプ + カテゴリ別 300件束
  const byKind: Record<LinkKind, string[]> = { video: [], web: [], paper: [] };
  for (const e of catalog) {
    const k = classifyLink(e);
    if (e.url) byKind[k].push(e.url);
  }
  const allUrls = [...byKind.video, ...byKind.web, ...byKind.paper];
  const { groups: catGroups } = buildCategoryPacks(catalog, packSize);
  const urlsMd = {
    all: path.join(linksDir, "URLS-all.md"),
    video: path.join(linksDir, "URLS-video.md"),
    web: path.join(linksDir, "URLS-web.md"),
    paper: path.join(linksDir, "URLS-paper.md"),
    byCategory: {} as Record<string, string>,
  };
  await writeFile(
    urlsMd.all,
    urlsOnlyMarkdown(allUrls, "URL一覧・すべて（全件ダンプ）", packSize, {
      grouping: "種別「すべて」（カテゴリ混在の全件。NotebookLM投入はカテゴリ別束を使う）",
      groupingId: "all",
    }),
    "utf8",
  );
  await writeFile(
    urlsMd.video,
    urlsOnlyMarkdown(byKind.video, "URL一覧・動画（全件ダンプ）", packSize, {
      grouping: "種別「動画」",
      groupingId: "video",
    }),
    "utf8",
  );
  await writeFile(
    urlsMd.web,
    urlsOnlyMarkdown(byKind.web, "URL一覧・Web（全件ダンプ）", packSize, {
      grouping: "種別「Web」",
      groupingId: "web",
    }),
    "utf8",
  );
  await writeFile(
    urlsMd.paper,
    urlsOnlyMarkdown(byKind.paper, "URL一覧・論文（全件ダンプ）", packSize, {
      grouping: "種別「論文」",
      groupingId: "paper",
    }),
    "utf8",
  );

  for (const g of catGroups) {
    const p = path.join(linksDir, `URLS-${g.category}.md`);
    urlsMd.byCategory[g.category] = p;
    await writeFile(
      p,
      urlsOnlyMarkdown(
        g.urls,
        `URL一覧・カテゴリ「${g.label}」（全件ダンプ）`,
        packSize,
        {
          grouping: `カテゴリ「${g.label}」`,
          groupingId: g.category,
        },
      ),
      "utf8",
    );
  }

  const written = await writeCategoryUrlPacks(linksDir, catGroups, packSize);

  await writeFile(
    path.join(linksDir, "packs", "README.md"),
    [
      "# NotebookLM 用 URL 束（カテゴリ別）",
      "",
      "まとまりは **コンテンツのカテゴリ** です。",
      `1束あたり最大 **${packSize}** URL（NotebookLM ソース上限）。`,
      "300件なければ **実数のまま1束** にします。",
      "各ファイル先頭に「まとまり」を明記しています。",
      "",
      `| まとまり | URL数 | 束数 | フォルダ |`,
      `|---|---:|---:|---|`,
      ...written.byCategory.map(
        (r) =>
          `| カテゴリ「${r.label}」 | ${r.urlCount} | ${r.packCount} | [${r.category}/](./${r.category}/) |`,
      ),
      "",
      `合計: ${written.byCategory.reduce((n, r) => n + r.urlCount, 0)} URL / ${written.packCount} 束`,
      "",
      "## 収集エージェント配置",
      "",
      roster.note,
      "",
      "### カテゴリ別",
      "",
      ...roster.byCategory.map(
        (r) => `- **${r.label}**: ${r.agents} 体（${r.detail}）`,
      ),
      "",
      "### 船種別",
      "",
      ...roster.byShip.map((r) => `- **${r.label}**: ${r.agents} 体`),
      "",
    ].join("\n"),
    "utf8",
  );

  await writeFile(
    path.join(readyDir, "URLS.md"),
    [
      "# NotebookLM 用 URL 束（カテゴリ別）",
      "",
      "まとまり: コンテンツのカテゴリ",
      `1束あたり最大 ${packSize} URL。満たなければ実数のまま1束。`,
      "投入するときは下の各束ファイルを開いてください。",
      "",
      `| まとまり | URL数 | 束数 | ファイル |`,
      `|---|---:|---:|---|`,
      ...written.byCategory.map((r) => {
        const first = `links/packs/${r.category}/pack-001.md`;
        return `| カテゴリ「${r.label}」 | ${r.urlCount} | ${r.packCount} | [${first}](./${first}) |`;
      }),
      "",
      `詳細: [links/packs/README.md](./links/packs/README.md)`,
      "",
    ].join("\n"),
    "utf8",
  );

  let snapshotPath: string | undefined;
  if (opts.snapshot || opts.profile === "burst" || (opts.keywords?.length ?? 0) > 0) {
    const stamp = nowIso().replace(/[:.]/g, "-").slice(0, 19);
    snapshotPath = path.join(linksDir, `burst-${stamp}.html`);
    await writeFile(snapshotPath, html, "utf8");
  }

  const bridgeRoot = resolveBridgeRoot(config);
  const mobilePath = path.join(bridgeRoot, "mobile", "LINKS.html");
  await mkdir(path.dirname(mobilePath), { recursive: true });
  await copyFile(outPath, mobilePath);
  try {
    await copyFile(
      path.join(readyDir, "URLS.md"),
      path.join(bridgeRoot, "mobile", "URLS.md"),
    );
  } catch {
    // ignore
  }

  const counts = {
    video: byKind.video.length,
    web: byKind.web.length,
    paper: byKind.paper.length,
    total: catalog.length,
  };

  console.log(
    `📎 URLS.md → video=${counts.video} web=${counts.web} paper=${counts.paper}`,
  );
  console.log(
    `📎 NotebookLM束(${packSize}) カテゴリ別 → ${written.packCount}束 · ` +
      written.byCategory
        .map((r) => `${r.label}:${r.packCount}`)
        .join(" "),
  );
  console.log(
    `📎 エージェント → 計${roster.totalAgents}体 · ` +
      roster.byCategory
        .slice(0, 5)
        .map((r) => `${r.label}:${r.agents}`)
        .join(" "),
  );

  return {
    path: outPath,
    mobilePath,
    snapshotPath,
    urlsMd,
    packs: {
      dir: written.dir,
      packCount: written.packCount,
      byCategory: written.byCategory,
    },
    agentRoster: roster,
    counts,
  };
}
