/**
 * 船隊（Fleet）— 1000体検算の前提
 * Mission 1つ = 船1体。OSプロセスは増やさない。
 */
import { createHash } from "node:crypto";
import type { SourcesConfig } from "../types.js";

export type ShipKind =
  | "arxiv"
  | "rss"
  | "github"
  | "youtube"
  | "reddit"
  | "docs"
  | "x"
  | "europepmc";

export type FleetProfile = "patrol" | "burst";

export type MissionStatus = "queued" | "running" | "done" | "failed" | "skipped";

export interface Mission {
  id: string;
  ship: ShipKind;
  label: string;
  /** この任務だけを走らせるためのソース設定（全体の部分集合） */
  sources: SourcesConfig;
  priority: number;
  profile: FleetProfile;
}

export interface FleetRunOptions {
  profile?: FleetProfile;
  maxMissions?: number;
  concurrency?: number;
  keywords?: string[];
  from?: string;
  to?: string;
  keywordOnly?: boolean;
  burst?: boolean;
}

export interface MissionResult {
  mission: Mission;
  status: MissionStatus;
  fetched: number;
  error?: string;
  ms: number;
}

export interface FleetRunSummary {
  profile: FleetProfile;
  missionsTotal: number;
  missionsDone: number;
  missionsFailed: number;
  missionsSkipped: number;
  concurrency: number;
  results: MissionResult[];
}

export const PATROL_WEIGHTS: Record<ShipKind, number> = {
  youtube: 0.22,
  rss: 0.2,
  europepmc: 0.14,
  arxiv: 0.12,
  github: 0.08,
  reddit: 0.06,
  docs: 0.03,
  x: 0.03,
};

/** biz/dining は rss 枠に含む（feeds 側で既に混在）→ rss を少し厚くしておく */
export const BURST_WEIGHTS: Record<ShipKind, number> = {
  youtube: 0.3,
  rss: 0.25,
  arxiv: 0.1,
  europepmc: 0.1,
  reddit: 0.1,
  github: 0.1,
  docs: 0.025,
  x: 0.025,
};

export const DEFAULT_PATROL_MISSIONS = 200;
export const DEFAULT_BURST_MISSIONS = 1000;
export const DEFAULT_PATROL_CONCURRENCY = 8;
export const DEFAULT_BURST_CONCURRENCY = 24;

export function missionId(
  ship: ShipKind,
  label: string,
  extra = "",
): string {
  return createHash("sha1")
    .update(`${ship}|${label}|${extra}`)
    .digest("hex")
    .slice(0, 16);
}

export function emptySourcesSkeleton(base: SourcesConfig): SourcesConfig {
  return {
    arxiv: {
      enabled: false,
      categories: [],
      maxPerCategory: base.arxiv.maxPerCategory,
    },
    europePmc: base.europePmc
      ? { ...base.europePmc, enabled: false, queries: [] }
      : undefined,
    rss: { enabled: false, feeds: [] },
    github: {
      enabled: false,
      queries: [],
      maxPerQuery: base.github.maxPerQuery,
    },
    youtube: {
      enabled: false,
      channels: [],
      searchFeeds: [],
      maxPerFeed: base.youtube.maxPerFeed,
    },
    reddit: {
      enabled: false,
      subreddits: [],
      maxPerSub: base.reddit.maxPerSub,
    },
    docs: { enabled: false, feeds: [] },
    x: {
      enabled: false,
      nitterInstances: base.x.nitterInstances,
      accounts: [],
      maxPerAccount: base.x.maxPerAccount,
    },
  };
}

export function scaleMax(base: number, weight: number, floor = 3): number {
  return Math.max(floor, Math.round(base * (0.5 + weight * 2.5)));
}
