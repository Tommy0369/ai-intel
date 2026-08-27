import { createHash } from "node:crypto";
import path from "node:path";
import type { ContentIdea, IntelEvent } from "../v2-types.js";
import { writeJson, writeJsonl } from "../store-jsonl.js";
import { anglesForEvent } from "./angle-engine.js";

const AUDIENCES = ["経営者", "個人事業主", "飲食店", "学習者", "SNS発信者"];

export function ideasFromEvent(ev: IntelEvent, now: string): ContentIdea[] {
  const angles = anglesForEvent(ev, 6);
  const id = `idea_${createHash("sha1").update(ev.id).digest("hex").slice(0, 10)}`;
  const viral = clamp(ev.velocityScore * 0.5 + ev.noveltyScore * 0.5);
  const edu = clamp(ev.evidenceScore * 0.6 + ev.actionabilityScore * 0.4);
  const biz = clamp(ev.opportunityScore * 0.7 + ev.tommyRelevanceScore * 0.3);
  const orig = clamp(100 - Math.min(80, ev.sourceCount * 6) + ev.noveltyScore * 0.2);
  const pri = clamp(
    ev.tommyRelevanceScore * 0.3 + viral * 0.2 + biz * 0.2 + edu * 0.15 + ev.freshnessScore * 0.15,
  );
  return [
    {
      id,
      sourceEventIds: [ev.id],
      title: ev.titleJa || ev.title,
      coreFact: ev.title,
      insight: `${ev.sourceCount}ソース / 権威 ${ev.authorityScore} / とみー適合 ${ev.tommyRelevanceScore}`,
      whyItMatters: `カテゴリ ${ev.categories.join("・")} にまたがる動き。`,
      targetAudience: AUDIENCES.slice(0, 3),
      categories: ev.categories,
      angles,
      tommyRelevanceScore: ev.tommyRelevanceScore,
      viralPotentialScore: viral,
      educationalValueScore: edu,
      businessValueScore: biz,
      originalityScore: orig,
      contentPriorityScore: pri,
      createdAt: now,
    },
  ];
}

export async function runIdeaEngine(
  dataRoot: string,
  events: IntelEvent[],
  limit = 40,
): Promise<ContentIdea[]> {
  const now = new Date().toISOString();
  const ranked = [...events]
    .sort(
      (a, b) =>
        b.tommyRelevanceScore * 2 +
        b.priorityScore -
        (a.tommyRelevanceScore * 2 + a.priorityScore),
    )
    .slice(0, limit);
  const ideas = ranked.flatMap((e) => ideasFromEvent(e, now));
  ideas.sort((a, b) => b.contentPriorityScore - a.contentPriorityScore);
  await writeJsonl(path.join(dataRoot, "ideas", "ideas.jsonl"), ideas);
  await writeJson(path.join(dataRoot, "ideas", "latest.json"), {
    updatedAt: now,
    count: ideas.length,
    top: ideas.slice(0, 20),
  });
  return ideas;
}

function clamp(n: number): number {
  return Math.max(0, Math.min(100, Math.round(n)));
}
