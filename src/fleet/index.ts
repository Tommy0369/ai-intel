import type { AppConfig, RawItem, SourcesConfig } from "../types.js";
import { allocateMissions } from "./allocator.js";
import {
  appendMissionResult,
  readFleetStatus,
  startLedger,
} from "./ledger.js";
import { runMissionPool } from "./pool.js";
import {
  DEFAULT_BURST_CONCURRENCY,
  DEFAULT_BURST_MISSIONS,
  DEFAULT_PATROL_CONCURRENCY,
  DEFAULT_PATROL_MISSIONS,
  type FleetProfile,
  type FleetRunOptions,
  type FleetRunSummary,
  type Mission,
  type ShipKind,
} from "./types.js";
import { collectArxiv } from "../adapters/arxiv.js";
import { collectRss } from "../adapters/rss.js";
import { collectGithub } from "../adapters/github.js";
import { collectYoutube } from "../adapters/youtube.js";
import { collectReddit } from "../adapters/reddit.js";
import { collectDocs } from "../adapters/docs.js";
import { collectX } from "../adapters/x.js";
import { collectEuropePmc } from "../adapters/europepmc.js";

export type { FleetProfile, FleetRunOptions, FleetRunSummary, Mission, ShipKind };
export { allocateMissions, expandKeywordVariants } from "./allocator.js";
export { readFleetStatus } from "./ledger.js";
export {
  DEFAULT_BURST_CONCURRENCY,
  DEFAULT_BURST_MISSIONS,
  DEFAULT_PATROL_CONCURRENCY,
  DEFAULT_PATROL_MISSIONS,
  PATROL_WEIGHTS,
  BURST_WEIGHTS,
} from "./types.js";

async function collectShip(
  ship: ShipKind,
  sources: SourcesConfig,
  userAgent: string,
): Promise<RawItem[]> {
  switch (ship) {
    case "arxiv":
      return collectArxiv(sources, userAgent);
    case "rss":
      return collectRss(sources, userAgent);
    case "github":
      return collectGithub(sources, userAgent);
    case "youtube":
      return collectYoutube(sources, userAgent);
    case "reddit":
      return collectReddit(sources, userAgent);
    case "docs":
      return collectDocs(sources, userAgent);
    case "x":
      return collectX(sources, userAgent);
    case "europepmc":
      return collectEuropePmc(sources, userAgent);
    default:
      return [];
  }
}

export function resolveFleetProfile(opts?: FleetRunOptions): FleetProfile {
  if (opts?.profile === "patrol" || opts?.profile === "burst") {
    return opts.profile;
  }
  const hasKw = (opts?.keywords?.length ?? 0) > 0;
  if (opts?.burst === false) return "patrol";
  if (opts?.burst === true || hasKw) return "burst";
  return "patrol";
}

/**
 * 船隊で並列収集。OSプロセスは増やさず、Mission 単位でワーカープール。
 */
export async function runFleetCollect(
  config: AppConfig,
  sources: SourcesConfig,
  opts?: FleetRunOptions,
): Promise<{
  items: RawItem[];
  errors: string[];
  fleet: FleetRunSummary;
}> {
  const profile = resolveFleetProfile(opts);
  const keywords = (opts?.keywords ?? []).map((k) => k.trim()).filter(Boolean);
  const maxMissions =
    opts?.maxMissions ??
    (profile === "burst" ? DEFAULT_BURST_MISSIONS : DEFAULT_PATROL_MISSIONS);
  const concurrency =
    opts?.concurrency ??
    (profile === "burst"
      ? DEFAULT_BURST_CONCURRENCY
      : DEFAULT_PATROL_CONCURRENCY);

  const missions = allocateMissions(sources, profile, {
    keywords,
    from: opts?.from,
    to: opts?.to,
    maxMissions,
    keywordOnly: opts?.keywordOnly,
  });

  console.log(
    `\n⚓ Fleet ${profile}: ${missions.length} missions · concurrency ${concurrency}`,
  );

  const runId = await startLedger(config.dataRoot, profile, missions);
  const errors: string[] = [];
  const items: RawItem[] = [];

  const results = await runMissionPool(
    missions,
    concurrency,
    async (mission) => {
      const batch = await collectShip(
        mission.ship,
        mission.sources,
        config.userAgent,
      );
      // 船タグを RawItem に載せる（後段で link / fleet タグへ）
      for (const raw of batch) {
        const fleetTags = [
          `fleet:${mission.ship}`,
          `fleet-profile:${mission.profile}`,
          ...(raw.tags ?? []),
        ];
        raw.tags = [...new Set(fleetTags)];
        items.push(raw);
      }
      return { fetched: batch.length };
    },
    async (r) => {
      await appendMissionResult(config.dataRoot, runId, r);
      if (r.status === "failed" && r.error) {
        errors.push(`${r.mission.ship}/${r.mission.label}: ${r.error}`);
      }
    },
  );

  const fleet: FleetRunSummary = {
    profile,
    missionsTotal: missions.length,
    missionsDone: results.filter((r) => r.status === "done").length,
    missionsFailed: results.filter((r) => r.status === "failed").length,
    missionsSkipped: results.filter((r) => r.status === "skipped").length,
    concurrency,
    results,
  };

  console.log(
    `\n⚓ Fleet done: ${fleet.missionsDone} ok / ${fleet.missionsFailed} fail · items ${items.length}`,
  );

  return { items, errors, fleet };
}

export async function printFleetStatus(dataRoot: string): Promise<void> {
  const { state, recent } = await readFleetStatus(dataRoot);
  if (!state) {
    console.log("fleet: (no runs yet)");
    return;
  }
  console.log(`fleet run : ${state.runId}`);
  console.log(`profile   : ${state.profile}`);
  console.log(`started   : ${state.startedAt}`);
  console.log(`updated   : ${state.updatedAt}`);
  console.log(
    `progress  : done=${state.done} failed=${state.failed} skipped=${state.skipped} queued=${state.queued}`,
  );
  if (recent.length) {
    console.log("recent:");
    for (const row of recent.slice(-12)) {
      console.log(
        `  ${row.status} ${row.ship} ${String(row.label ?? "").slice(0, 50)}` +
          (row.fetched != null ? ` (+${row.fetched})` : "") +
          (row.error ? ` !${row.error}` : ""),
      );
    }
  }
}
