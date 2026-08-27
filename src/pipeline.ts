import path from "node:path";
import { assertDataRootReady, ensureLayout } from "./disk.js";
import { loadCatalog } from "./corpus.js";
import type { AppConfig } from "./types.js";
import { writeJson } from "./store-jsonl.js";
import { runEventEngine } from "./events/event-engine.js";
import { saveEvents } from "./events/event-store.js";
import { runTrendEngine } from "./trends/trend-engine.js";
import { runCrossIntelligence } from "./cross/cross-intelligence.js";
import { runIdeaEngine } from "./content/idea-engine.js";
import { runContentCards } from "./content/content-card.js";
import { runPlatformTransform } from "./content/platform-transformer.js";
import { runSourceHealth } from "./source-health/source-health.js";
import { runPersistentNotebook } from "./notebook-persistent.js";
import { runKnowledgeEngine } from "./knowledge/knowledge-engine.js";
import { saveEventScores } from "./intelligence/score-store.js";
import { explainPriority } from "./intelligence/score-reasons.js";
import { newRunId, withDataLock } from "./ops/lock.js";
import type { TodayBrief } from "./v2-types.js";

export async function runIntelligence(
  config: AppConfig,
  opts?: { limit?: number },
): Promise<{
  events: number;
  ideas: number;
  cards: number;
  insights: number;
  todayPath: string;
}> {
  await assertDataRootReady(config);
  await ensureLayout(config.dataRoot);
  const runId = newRunId("intel");

  return withDataLock(config.dataRoot, "intelligence", async () => {
    const catalog = await loadCatalog(config.dataRoot);
    console.log(`▶ events（カタログ ${catalog.length} 件 / run=${runId}）…`);
    let events = await runEventEngine(config, catalog, { limit: opts?.limit });
    const reasonsById = new Map(
      events.map((e) => [
        e.id,
        explainPriority({
          authority: e.authorityScore,
          evidence: e.evidenceScore,
          freshness: e.freshnessScore,
          novelty: e.noveltyScore,
          relevance: e.relevanceScore,
          actionability: e.actionabilityScore,
          opportunity: e.opportunityScore,
        }),
      ]),
    );
    await saveEventScores(config.dataRoot, events, reasonsById);
    events = await runTrendEngine(config.dataRoot, events);
    await saveEvents(config.dataRoot, events);
    const knowledge = await runKnowledgeEngine(config.dataRoot, events);
    const insights = await runCrossIntelligence(config.dataRoot, events);
    const ideas = await runIdeaEngine(config.dataRoot, events, 40);
    const cards = await runContentCards(config.dataRoot, ideas, events);
    await runPlatformTransform(config.dataRoot, ideas, cards);
    await runSourceHealth(config);
    await runPersistentNotebook(config, catalog);

    const today: TodayBrief = {
      generatedAt: new Date().toISOString(),
      important: events.slice(0, 10),
      rising: events
        .filter(
          (e) =>
            e.trendStatus === "rising" ||
            e.trendStatus === "hot" ||
            e.trendStatus === "emerging",
        )
        .slice(0, 10),
      tommy: [...events]
        .sort((a, b) => b.tommyRelevanceScore - a.tommyRelevanceScore)
        .slice(0, 10),
      business: events
        .filter((e) => e.categories.some((c) => c === "biz" || c === "dining"))
        .slice(0, 10),
      snsIdeas: ideas.slice(0, 20),
    };
    const todayPath = path.join(
      config.dataRoot,
      "ready",
      "intelligence",
      "today.json",
    );
    await writeJson(todayPath, today);
    await writeJson(path.join(config.dataRoot, "intelligence", "latest.json"), {
      generatedAt: today.generatedAt,
      eventCount: events.length,
      ideaCount: ideas.length,
      insightCount: insights.length,
      runId,
    });
    console.log(
      `▶ intelligence 完了: events=${events.length} knowledge=${knowledge.entities}e/${knowledge.claims}c ideas=${ideas.length} cards=${cards.length} cross=${insights.length}`,
    );
    return {
      events: events.length,
      ideas: ideas.length,
      cards: cards.length,
      insights: insights.length,
      todayPath,
    };
  });
}
