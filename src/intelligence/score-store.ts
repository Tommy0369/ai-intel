import path from "node:path";
import type { IntelEvent } from "../v2-types.js";
import { appendJsonl, writeJson } from "../store-jsonl.js";
import type { ScoreReason } from "./score-reasons.js";

export const SCORING_VERSION = "2026.08-step03";

export interface EventScoreRecord {
  event_id: string;
  scored_at: string;
  scoring_version: string;
  authority_score: number;
  evidence_score: number;
  freshness_score: number;
  novelty_score: number;
  priority_score: number;
  tommy_relevance_score: number;
  reasons: ScoreReason[];
}

export async function saveEventScores(
  dataRoot: string,
  events: IntelEvent[],
  reasonsById: Map<string, ScoreReason[]>,
): Promise<string> {
  const dir = path.join(dataRoot, "intelligence");
  const file = path.join(dir, "event-scores.jsonl");
  const at = new Date().toISOString();
  for (const e of events) {
    const row: EventScoreRecord = {
      event_id: e.id,
      scored_at: at,
      scoring_version: SCORING_VERSION,
      authority_score: e.authorityScore,
      evidence_score: e.evidenceScore,
      freshness_score: e.freshnessScore,
      novelty_score: e.noveltyScore,
      priority_score: e.priorityScore,
      tommy_relevance_score: e.tommyRelevanceScore,
      reasons: reasonsById.get(e.id) ?? [],
    };
    await appendJsonl(file, row);
  }
  await writeJson(path.join(dir, "latest-scores.json"), {
    updatedAt: at,
    scoring_version: SCORING_VERSION,
    count: events.length,
  });
  return file;
}
