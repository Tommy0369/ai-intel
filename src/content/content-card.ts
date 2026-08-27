import { createHash } from "node:crypto";
import path from "node:path";
import type { ContentCard, ContentIdea, IntelEvent } from "../v2-types.js";
import { writeJson, writeJsonl } from "../store-jsonl.js";

export function cardFromIdea(
  idea: ContentIdea,
  events: Map<string, IntelEvent>,
): ContentCard {
  const ev = events.get(idea.sourceEventIds[0]);
  const angle = idea.angles[0];
  const id = `card_${createHash("sha1").update(idea.id).digest("hex").slice(0, 10)}`;
  return {
    id,
    ideaId: idea.id,
    hook: angle?.hook ?? idea.title,
    problem: "情報は増えるが、何を発信するかが決まらない",
    fact: idea.coreFact,
    insight: idea.insight,
    example: ev?.entities.slice(0, 3).join(" / "),
    action: "今日は1角度だけ切り取って投稿する",
    conclusion: idea.whyItMatters,
    cta: "保存して、夜に1本書く",
    sources: ev?.sourceDomains ?? [],
    sourceIds: idea.sourceEventIds,
    factKind: "fact",
    confidence: Math.round((idea.contentPriorityScore + (ev?.authorityScore ?? 50)) / 2) / 100,
    tags: idea.categories,
  };
}

export async function runContentCards(
  dataRoot: string,
  ideas: ContentIdea[],
  events: IntelEvent[],
): Promise<ContentCard[]> {
  const map = new Map(events.map((e) => [e.id, e]));
  const cards = ideas.slice(0, 40).map((i) => cardFromIdea(i, map));
  await writeJsonl(path.join(dataRoot, "content-cards", "cards.jsonl"), cards);
  await writeJson(path.join(dataRoot, "content-cards", "latest.json"), {
    updatedAt: new Date().toISOString(),
    count: cards.length,
    cards: cards.slice(0, 20),
  });
  return cards;
}
