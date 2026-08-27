import type { AppConfig, CatalogEntry, ScoringWeights } from "../types.js";
import { DEFAULT_SCORING_WEIGHTS } from "../v2-types.js";
import { authorityScore, evidenceScore } from "./authority.js";

export function mergeWeights(config: AppConfig): ScoringWeights {
  return { ...DEFAULT_SCORING_WEIGHTS, ...config.scoringWeights };
}

export function freshnessFromMs(ts: number, now: number): number {
  if (!ts) return 40;
  const h = (now - ts) / 3_600_000;
  if (h <= 6) return 98;
  if (h <= 24) return 90;
  if (h <= 72) return 78;
  if (h <= 168) return 62;
  if (h <= 720) return 42;
  return 18;
}

export function noveltyScore(entry: CatalogEntry, clusterSize: number): number {
  let n = 55;
  if (/first|launch|release|announce|新|発表|初/i.test(entry.title)) n += 18;
  if (clusterSize <= 2) n += 12;
  if (clusterSize >= 12) n -= 10;
  return clamp(n);
}

export function actionabilityScore(entry: CatalogEntry): number {
  const hay = `${entry.title} ${entry.category}`;
  let n = 40;
  if (/how to|guide|checklist|playbook|使い方|導入|自動化/i.test(hay)) n += 25;
  if (["biz", "dining", "tools", "agents"].includes(entry.category)) n += 15;
  if (entry.source === "docs" || entry.source === "github") n += 10;
  return clamp(n);
}

export function opportunityScore(entry: CatalogEntry): number {
  const hay = entry.title;
  let n = 35;
  if (/pricing|revenue|startup|market|顧客|集客|飲食|restaurant/i.test(hay)) n += 20;
  if (["biz", "dining", "trends"].includes(entry.category)) n += 18;
  return clamp(n);
}

export function articleIntelligence(
  entry: CatalogEntry,
  now: number,
  clusterSize = 1,
): {
  authorityScore: number;
  evidenceScore: number;
  freshnessScore: number;
  noveltyScore: number;
  actionabilityScore: number;
  opportunityScore: number;
} {
  const ts = Date.parse(entry.published_at || entry.collected_at || "") || 0;
  return {
    authorityScore: authorityScore(entry),
    evidenceScore: evidenceScore(entry),
    freshnessScore: freshnessFromMs(ts, now),
    noveltyScore: noveltyScore(entry, clusterSize),
    actionabilityScore: actionabilityScore(entry),
    opportunityScore: opportunityScore(entry),
  };
}

export function priorityScore(
  parts: {
    authority: number;
    evidence: number;
    freshness: number;
    novelty: number;
    velocity: number;
    diversity: number;
    relevance: number;
    actionability: number;
    opportunity: number;
  },
  weights: ScoringWeights,
): number {
  const s =
    parts.authority * weights.authority +
    parts.evidence * weights.evidence +
    parts.freshness * weights.freshness +
    parts.novelty * weights.novelty +
    parts.velocity * weights.velocity +
    parts.diversity * weights.diversity +
    parts.relevance * weights.relevance +
    parts.actionability * weights.actionability +
    parts.opportunity * weights.opportunity;
  return clamp(s);
}

function clamp(n: number): number {
  return Math.max(0, Math.min(100, Math.round(n)));
}
