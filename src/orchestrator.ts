import { categorize, inferTags, linkKindTag } from "./categorize.js";
import { DedupStore, makeId, normalizeUrl } from "./dedup.js";
import { assertDataRootReady, ensureLayout } from "./disk.js";
import { nowIso } from "./http.js";
import { writeIndexMd } from "./catalog.js";
import {
  countCatalog,
  rebuildCatalogFromDisk,
  writeItem,
  writeRunMeta,
} from "./writer.js";
import type { AppConfig, IntelItem, RawItem, SourcesConfig } from "./types.js";
import {
  buildKeywordSources,
  isOutsideDateRange,
  matchesKeywords,
  parseDateBound,
  type CollectOptions,
} from "./collect-query.js";
import {
  resolveFleetProfile,
  runFleetCollect,
  type FleetRunSummary,
} from "./fleet/index.js";
import { runLinksHtml } from "./links-html.js";

export type { CollectOptions } from "./collect-query.js";

export interface CollectResult {
  fetched: number;
  written: number;
  skipped: number;
  bySource: Record<string, number>;
  errors: string[];
  /** キーワード収集時の条件（あれば） */
  query?: {
    keywords: string[];
    from?: string;
    to?: string;
    keywordOnly: boolean;
  };
  fleet?: {
    profile: FleetRunSummary["profile"];
    missionsTotal: number;
    missionsDone: number;
    missionsFailed: number;
    concurrency: number;
  };
  linksHtml?: string;
}

function toIntelItem(
  raw: RawItem,
  fleetMeta?: { ship?: string; profile?: string },
): IntelItem {
  const url = normalizeUrl(raw.url);
  const category = categorize({ ...raw, url });
  const id = makeId(raw.source, url);
  const tags = new Set(inferTags({ ...raw, url }, category));
  tags.add(linkKindTag({ ...raw, url }));
  if (fleetMeta?.ship) tags.add(`fleet:${fleetMeta.ship}`);
  if (fleetMeta?.profile) tags.add(`fleet-profile:${fleetMeta.profile}`);
  return {
    id,
    title: raw.title.trim() || url,
    url,
    source: raw.source,
    category,
    collectedAt: nowIso(),
    publishedAt: raw.publishedAt,
    tags: [...tags].sort(),
    lang: raw.lang ?? "en",
    summary: raw.source === "youtube" ? "" : (raw.summary ?? "").trim(),
    authors: raw.authors ?? [],
    relativePath: "",
  };
}

function fleetMetaFromTags(tags?: string[]): {
  ship?: string;
  profile?: string;
} {
  const ship = tags?.find((t) => t.startsWith("fleet:") && !t.startsWith("fleet-profile:"));
  const profile = tags?.find((t) => t.startsWith("fleet-profile:"));
  return {
    ship: ship?.slice("fleet:".length),
    profile: profile?.slice("fleet-profile:".length),
  };
}

export async function runCollect(
  config: AppConfig,
  sources: SourcesConfig,
  opts?: CollectOptions,
): Promise<CollectResult> {
  await assertDataRootReady(config);
  await ensureLayout(config.dataRoot);

  const keywords = (opts?.keywords ?? []).map((k) => k.trim()).filter(Boolean);
  const from = opts?.from?.trim() || undefined;
  const to = opts?.to?.trim() || undefined;
  const keywordOnly = opts?.keywordOnly ?? keywords.length > 0;
  const profile = resolveFleetProfile({
    profile: opts?.profile,
    burst: opts?.burst,
    keywords,
  });

  // バースト時は船隊 allocator がソースを合成。パトロール時は sources そのまま。
  // keywordOnly=false のバーストでは buildKeywordSources は使わず patrol 任務を足す。
  const baseSources =
    keywords.length > 0 && profile === "patrol"
      ? buildKeywordSources(sources, {
          keywords,
          from,
          to,
          keywordOnly,
          burst: false,
        })
      : sources;

  if (keywords.length) {
    console.log(
      `\n🔍 キーワード収集: ${keywords.join(" / ")}` +
        (from || to ? `  期間: ${from ?? "…"}〜${to ?? "…"}` : "") +
        (keywordOnly ? "  (キーワード専用ソース)" : "  (既存＋キーワード)") +
        `  fleet=${profile}`,
    );
  } else {
    console.log(`\n🧭 常駐パトロール fleet=${profile}`);
  }

  const fromMs = parseDateBound(from, false);
  const toMs = parseDateBound(to, true);

  const dedup = new DedupStore(config.dataRoot);
  await dedup.load();

  const { items, errors, fleet } = await runFleetCollect(config, baseSources, {
    profile,
    keywords,
    from,
    to,
    keywordOnly,
    burst: opts?.burst,
    maxMissions: opts?.maxMissions,
    concurrency: opts?.concurrency,
  });

  const bySource: Record<string, number> = {};
  let written = 0;
  let skipped = 0;

  const seenThisRun = new Set<string>();

  for (const raw of items) {
    if (!raw.url || !raw.title) {
      skipped++;
      continue;
    }

    if (isOutsideDateRange(raw.publishedAt, fromMs, toMs)) {
      skipped++;
      continue;
    }

    if (keywords.length && !matchesKeywords(raw, keywords)) {
      skipped++;
      continue;
    }

    const url = normalizeUrl(raw.url);
    bySource[raw.source] = (bySource[raw.source] ?? 0) + 1;

    if (seenThisRun.has(url) || dedup.has(url)) {
      skipped++;
      continue;
    }
    seenThisRun.add(url);

    const item = toIntelItem(raw, fleetMetaFromTags(raw.tags));
    if (keywords.length) {
      const kwTags = keywords.map((k) => `kw:${k.slice(0, 24)}`);
      item.tags = [...new Set([...item.tags, "keyword-hunt", ...kwTags])].sort();
    }
    await writeItem(config.dataRoot, item);
    dedup.add(url);
    written++;
  }

  await dedup.save();

  const total = await countCatalog(config.dataRoot);
  const finishedAt = nowIso();
  const queryMeta = keywords.length
    ? { keywords, from, to, keywordOnly }
    : undefined;

  await writeRunMeta(config.dataRoot, {
    finishedAt,
    fetched: items.length,
    written,
    skipped,
    bySource,
    errors,
    seenUrls: dedup.size(),
    catalogTotal: total,
    ...(queryMeta ? { query: queryMeta } : {}),
    fleet: {
      profile: fleet.profile,
      missionsTotal: fleet.missionsTotal,
      missionsDone: fleet.missionsDone,
      missionsFailed: fleet.missionsFailed,
      concurrency: fleet.concurrency,
    },
  });
  await writeIndexMd(config.dataRoot, { total, lastRun: finishedAt });

  let linksHtml: string | undefined;
  try {
    const links = await runLinksHtml(config, {
      keywords: keywords.length ? keywords : undefined,
      profile: fleet.profile,
      snapshot: fleet.profile === "burst" || keywords.length > 0,
    });
    linksHtml = links.path;
    console.log(`\n📎 LINKS.html → ${links.path}`);
  } catch (err) {
    const msg = `links-html: ${err instanceof Error ? err.message : String(err)}`;
    errors.push(msg);
    console.warn(`  ! ${msg}`);
  }

  return {
    fetched: items.length,
    written,
    skipped,
    bySource,
    errors,
    query: queryMeta,
    fleet: {
      profile: fleet.profile,
      missionsTotal: fleet.missionsTotal,
      missionsDone: fleet.missionsDone,
      missionsFailed: fleet.missionsFailed,
      concurrency: fleet.concurrency,
    },
    linksHtml,
  };
}

export async function runRebuildIndex(config: AppConfig): Promise<number> {
  await assertDataRootReady(config);
  await ensureLayout(config.dataRoot);
  const total = await rebuildCatalogFromDisk(config.dataRoot);
  await writeIndexMd(config.dataRoot, {
    total,
    lastRun: nowIso(),
  });
  return total;
}

export async function runStatus(config: AppConfig): Promise<void> {
  const { getFreeBytes, volumePath } = await import("./disk.js");
  const { readFile } = await import("node:fs/promises");
  const path = await import("node:path");
  const { readJson } = await import("./store-jsonl.js");

  await assertDataRootReady(config);
  const volume = volumePath(config.dataRoot);
  const freeGb = (await getFreeBytes(volume)) / 1024 ** 3;
  const total = await countCatalog(config.dataRoot);

  let lastRun: Record<string, unknown> | null = null;
  try {
    lastRun = JSON.parse(
      await readFile(path.join(config.dataRoot, "state", "last-run.json"), "utf8"),
    ) as Record<string, unknown>;
  } catch {
    lastRun = null;
  }

  const eventState = await readJson<{ eventCount?: number; articleCount?: number } | null>(
    path.join(config.dataRoot, "events", "state.json"),
    null,
  );
  const knowledgeIndex = await readJson<{
    entities?: number;
    claims?: number;
    concepts?: number;
  } | null>(path.join(config.dataRoot, "knowledge", "index.json"), null);
  const ideas = await readJson<{ count?: number } | null>(
    path.join(config.dataRoot, "ideas", "latest.json"),
    null,
  );
  const health = await readJson<{ rows?: Array<{ status: string }> } | null>(
    path.join(config.dataRoot, "source-health", "latest.json"),
    null,
  );
  const personal = await readJson<{ documents?: unknown[] } | null>(
    path.join(config.dataRoot, "personal", "index.json"),
    null,
  );

  const healthRows = health?.rows ?? [];
  const dead = healthRows.filter((r) => r.status === "dead").length;
  const warning = healthRows.filter((r) => r.status === "warning").length;

  console.log(`dataRoot : ${config.dataRoot}`);
  console.log(`volume   : ${volume}`);
  console.log(`free     : ${freeGb.toFixed(2)} GB`);
  console.log(`catalog  : ${total} entries`);
  console.log(
    `events   : ${eventState?.eventCount ?? "—"} (articles ${eventState?.articleCount ?? "—"})`,
  );
  console.log(
    `knowledge: entities ${knowledgeIndex?.entities ?? "—"} / claims ${knowledgeIndex?.claims ?? "—"}`,
  );
  console.log(`ideas    : ${ideas?.count ?? "—"}`);
  console.log(
    `sources  : ${healthRows.length || "—"} (warning ${warning} / dead ${dead})`,
  );
  console.log(`personal : ${personal?.documents?.length ?? 0} documents`);
  if (lastRun) {
    console.log(`lastRun  : ${lastRun.finishedAt ?? "(unknown)"}`);
    console.log(`  written: ${lastRun.written ?? "?"}`);
    console.log(`  skipped: ${lastRun.skipped ?? "?"}`);
    console.log(`  fetched: ${lastRun.fetched ?? "?"}`);
  } else {
    console.log("lastRun  : (none yet)");
  }
}
