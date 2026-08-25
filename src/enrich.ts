import { mkdir, readFile, writeFile, access } from "node:fs/promises";
import path from "node:path";
import { assertDataRootReady, ensureLayout } from "./disk.js";
import { nowIso, sleep } from "./http.js";
import { loadCatalog } from "./corpus.js";
import { clusterCorpus, type ClusterOptions } from "./cluster.js";
import { enrichWebArticle } from "./enrich-web.js";
import { enrichYoutubeTranscript, extractYoutubeId } from "./enrich-youtube.js";
import {
  canonicalizeUrl,
  isGoogleNewsUrl,
  selectUniqueMembers,
  type CanonicalMember,
} from "./enrich-canonicalize.js";
import type { AppConfig, CatalogEntry, SourceKind } from "./types.js";

export type EnrichStatus = "ok" | "failed" | "partial" | "skipped";
export type EnrichKind = "article" | "transcript" | "none";

export interface EnrichRecord {
  id: string;
  url: string;
  source: SourceKind;
  status: EnrichStatus;
  kind: EnrichKind;
  finalUrl?: string;
  title?: string;
  text: string;
  chars: number;
  lang?: string;
  error?: string;
  strategy?: string;
  /** 同一記事とみなした他 id */
  aliasIds?: string[];
  enrichedAt: string;
}

export interface EnrichResult {
  total: number;
  /** ユニーク記事数（dedupe後） */
  uniqueTotal: number;
  okCount: number;
  failedCount: number;
  skippedCount: number;
  records: EnrichRecord[];
}

function enrichDir(dataRoot: string): string {
  return path.join(dataRoot, "enrich");
}

function recordPath(dataRoot: string, id: string): string {
  return path.join(enrichDir(dataRoot), `${safeId(id)}.json`);
}

function safeId(id: string): string {
  return id.replace(/[\/\\:*?"<>|]/g, "_");
}

export async function loadEnrichRecord(
  dataRoot: string,
  id: string,
): Promise<EnrichRecord | null> {
  try {
    const raw = await readFile(recordPath(dataRoot, id), "utf8");
    return JSON.parse(raw) as EnrichRecord;
  } catch {
    return null;
  }
}

export async function loadEnrichMap(
  dataRoot: string,
  ids: string[],
): Promise<Map<string, EnrichRecord>> {
  const map = new Map<string, EnrichRecord>();
  await Promise.all(
    ids.map(async (id) => {
      const r = await loadEnrichRecord(dataRoot, id);
      if (r) map.set(id, r);
    }),
  );
  return map;
}

/**
 * 代表 + alias をまとめて解決。alias は代表の本文を共有参照する薄いレコードにする。
 */
export async function loadEnrichMapResolved(
  dataRoot: string,
  ids: string[],
): Promise<Map<string, EnrichRecord>> {
  const map = await loadEnrichMap(dataRoot, ids);
  // aliasIds を持つ代表から逆引き
  for (const r of map.values()) {
    for (const aid of r.aliasIds ?? []) {
      if (!map.has(aid) && r.text) {
        map.set(aid, {
          ...r,
          id: aid,
          status: r.status,
        });
      }
    }
  }
  return map;
}

async function saveRecord(
  dataRoot: string,
  record: EnrichRecord,
): Promise<void> {
  const dir = enrichDir(dataRoot);
  await mkdir(dir, { recursive: true });
  await writeFile(
    recordPath(dataRoot, record.id),
    JSON.stringify(record, null, 2) + "\n",
    "utf8",
  );
  if (record.text) {
    const mdPath = path.join(dir, `${safeId(record.id)}.md`);
    const body = [
      `# ${record.title || record.id}`,
      "",
      `- id: ${record.id}`,
      `- kind: ${record.kind}`,
      `- url: ${record.url}`,
      record.finalUrl && record.finalUrl !== record.url
        ? `- finalUrl: ${record.finalUrl}`
        : "",
      record.strategy ? `- strategy: ${record.strategy}` : "",
      record.lang ? `- lang: ${record.lang}` : "",
      `- chars: ${record.chars}`,
      `- enrichedAt: ${record.enrichedAt}`,
      "",
      record.kind === "transcript" ? "## 字幕" : "## 本文",
      "",
      record.text,
      "",
    ]
      .filter((l) => l !== "")
      .join("\n");
    await writeFile(mdPath, body, "utf8");
  }
}

function isYoutube(entry: CatalogEntry): boolean {
  return entry.source === "youtube" || Boolean(extractYoutubeId(entry.url));
}

export async function enrichOne(
  config: AppConfig,
  entry: CatalogEntry,
  opts?: {
    force?: boolean;
    fetchUrl?: string;
    aliasIds?: string[];
  },
): Promise<EnrichRecord> {
  const existing = opts?.force
    ? null
    : await loadEnrichRecord(config.dataRoot, entry.id);
  if (existing && (existing.status === "ok" || existing.status === "partial")) {
    return { ...existing, status: existing.status };
  }

  if (isYoutube(entry)) {
    const tr = await enrichYoutubeTranscript(entry.url, config.userAgent);
    const record: EnrichRecord = {
      id: entry.id,
      url: entry.url,
      source: entry.source,
      status: tr.ok ? "ok" : "failed",
      kind: "transcript",
      title: entry.title_ja || entry.title,
      text: tr.text,
      chars: tr.chars,
      lang: tr.lang,
      error: tr.error,
      strategy: "youtube",
      aliasIds: opts?.aliasIds,
      enrichedAt: nowIso(),
    };
    await saveRecord(config.dataRoot, record);
    return record;
  }

  if (entry.source === "x" || entry.source === "github") {
    const record: EnrichRecord = {
      id: entry.id,
      url: entry.url,
      source: entry.source,
      status: "skipped",
      kind: "none",
      title: entry.title_ja || entry.title,
      text: "",
      chars: 0,
      error: "source_skipped",
      aliasIds: opts?.aliasIds,
      enrichedAt: nowIso(),
    };
    await saveRecord(config.dataRoot, record);
    return record;
  }

  let fetchUrl = opts?.fetchUrl || entry.url;
  if (isGoogleNewsUrl(fetchUrl)) {
    const canon = await canonicalizeUrl(fetchUrl, config.userAgent);
    if (canon.via === "google-news") {
      fetchUrl = canon.url;
    }
  }

  const web = await enrichWebArticle(entry.url, config.userAgent, {
    fetchUrl,
  });
  const hasText = Boolean(web.text);
  const status: EnrichStatus = web.ok
    ? "ok"
    : hasText
      ? "partial"
      : "failed";
  const record: EnrichRecord = {
    id: entry.id,
    url: entry.url,
    source: entry.source,
    status,
    kind: "article",
    finalUrl: web.finalUrl,
    title: web.title || entry.title_ja || entry.title,
    text: web.text,
    chars: web.chars,
    error: web.error,
    strategy: web.strategy,
    aliasIds: opts?.aliasIds,
    enrichedAt: nowIso(),
  };
  await saveRecord(config.dataRoot, record);
  return record;
}

export async function enrichEntries(
  config: AppConfig,
  entries: CatalogEntry[],
  opts?: { force?: boolean; delayMs?: number; unique?: boolean },
): Promise<EnrichResult> {
  await assertDataRootReady(config);
  await ensureLayout(config.dataRoot);
  await mkdir(enrichDir(config.dataRoot), { recursive: true });

  const delay = opts?.delayMs ?? 400;
  const unique = opts?.unique !== false;
  const targets: CanonicalMember[] = unique
    ? selectUniqueMembers(entries)
    : entries.map((entry) => ({
        entry,
        fetchUrl: entry.url,
        aliases: [],
        titleKey: entry.id,
      }));

  console.log(
    `  [enrich] targets ${targets.length} unique / ${entries.length} raw`,
  );

  const records: EnrichRecord[] = [];
  let okCount = 0;
  let failedCount = 0;
  let skippedCount = 0;

  for (let i = 0; i < targets.length; i++) {
    const t = targets[i];
    const e = t.entry;
    console.log(
      `  [enrich] ${i + 1}/${targets.length} ${e.source} ${e.id.slice(0, 24)}…` +
        (t.aliases.length ? ` (+${t.aliases.length} dup)` : ""),
    );
    try {
      // 直リンクがあればそれを代表にして取得（Google News 失敗を避ける）
      const pool = [e, ...t.aliases];
      const direct = pool.find((x) => !isGoogleNewsUrl(x.url));
      const target = direct ?? e;
      const fetchUrl = direct?.url ?? t.fetchUrl;
      const aliasIds = pool
        .filter((x) => x.id !== target.id)
        .map((x) => x.id);

      const r = await enrichOne(config, target, {
        force: opts?.force,
        fetchUrl,
        aliasIds,
      });
      records.push(r);
      if (r.status === "ok" || r.status === "partial") okCount++;
      else if (r.status === "skipped") skippedCount++;
      else failedCount++;
      console.log(
        `    → ${r.status} ${r.kind} ${r.chars}字` +
          `${r.strategy ? ` [${r.strategy}]` : ""}` +
          `${r.error ? ` (${r.error})` : ""}` +
          `${r.finalUrl && r.finalUrl !== r.url ? ` → ${r.finalUrl.slice(0, 60)}` : ""}`,
      );
    } catch (err) {
      failedCount++;
      const r: EnrichRecord = {
        id: e.id,
        url: e.url,
        source: e.source,
        status: "failed",
        kind: "none",
        text: "",
        chars: 0,
        error: err instanceof Error ? err.message : String(err),
        aliasIds: t.aliases.map((a) => a.id),
        enrichedAt: nowIso(),
      };
      records.push(r);
      await saveRecord(config.dataRoot, r);
      console.warn(`    → failed: ${r.error}`);
    }
    if (i < targets.length - 1) await sleep(delay);
  }

  return {
    total: entries.length,
    uniqueTotal: targets.length,
    okCount,
    failedCount,
    skippedCount,
    records,
  };
}

export async function enrichByIds(
  config: AppConfig,
  ids: string[],
  opts?: { force?: boolean },
): Promise<EnrichResult> {
  const catalog = await loadCatalog(config.dataRoot);
  const byId = new Map(catalog.map((e) => [e.id, e]));
  const entries = ids
    .map((id) => byId.get(id))
    .filter((e): e is CatalogEntry => Boolean(e));
  return enrichEntries(config, entries, opts);
}

/** 話題クラスタのメンバーだけ enrich（Notebook用・ユニーク化） */
export async function enrichCluster(
  config: AppConfig,
  clusterIndex: number,
  clusterOpts?: ClusterOptions,
  opts?: { force?: boolean },
): Promise<
  EnrichResult & { clusterIndex: number; titleJa?: string }
> {
  await assertDataRootReady(config);
  const clustered = await clusterCorpus(config.dataRoot, clusterOpts);
  const cluster = clustered.clusters.find((c) => c.index === clusterIndex);
  if (!cluster) {
    throw new Error(
      `話題 #${String(clusterIndex).padStart(2, "0")} が見つかりません`,
    );
  }
  const catalog = await loadCatalog(config.dataRoot);
  const byId = new Map(catalog.map((e) => [e.id, e]));
  const entries = cluster.members
    .map((m) => byId.get(m.id))
    .filter((e): e is CatalogEntry => Boolean(e));

  console.log(
    `enrich cluster #${String(clusterIndex).padStart(2, "0")}: ${cluster.titleJa}（raw ${entries.length}件 → unique）`,
  );
  const result = await enrichEntries(config, entries, {
    ...opts,
    unique: true,
  });
  return {
    ...result,
    clusterIndex,
    titleJa: cluster.titleJa,
  };
}

/** CONTEXT埋め込み用の短い本文（上限付き） */
export function enrichSnippet(
  record: EnrichRecord | null | undefined,
  max = 1800,
): string {
  if (!record?.text) return "";
  const t = record.text.replace(/\s+\n/g, "\n").trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max - 1)}…`;
}

export async function enrichExists(
  dataRoot: string,
  id: string,
): Promise<boolean> {
  try {
    await access(recordPath(dataRoot, id));
    return true;
  } catch {
    return false;
  }
}

/** ユニーク記事ベースのカバレッジ（Notebookゲート用） */
export function uniqueEnrichCoverage(
  members: Array<{ id: string; title: string; titleJa?: string; url: string }>,
  enrich: Map<string, EnrichRecord>,
  catalogById?: Map<string, CatalogEntry>,
): {
  uniqueTotal: number;
  withBody: number;
  failed: number;
  skipped: number;
  coverage: number;
  representativeOk: boolean;
} {
  const entries: CatalogEntry[] = members.map((m) => {
    const c = catalogById?.get(m.id);
    return (
      c ??
      ({
        id: m.id,
        title: m.title,
        title_ja: m.titleJa,
        url: m.url,
        source: "rss",
        category: "other",
        collected_at: "",
        tags: [],
        lang: "en",
        path: "",
      } as CatalogEntry)
    );
  });
  const unique = selectUniqueMembers(entries);
  let withBody = 0;
  let failed = 0;
  let skipped = 0;
  for (const u of unique) {
    const r =
      enrich.get(u.entry.id) ||
      u.aliases.map((a) => enrich.get(a.id)).find(Boolean);
    if (r?.text) withBody++;
    else if (r?.status === "skipped") skipped++;
    else if (r?.status === "failed") failed++;
  }
  const uniqueTotal = unique.length;
  const coverage = uniqueTotal ? withBody / uniqueTotal : 0;
  return {
    uniqueTotal,
    withBody,
    failed,
    skipped,
    coverage,
    representativeOk: withBody >= 1,
  };
}
