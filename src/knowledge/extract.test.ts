import assert from "node:assert/strict";
import test from "node:test";
import { extractFromEvent, mergeKnowledge } from "./extract.js";
import type { IntelEvent } from "../v2-types.js";

function sampleEvent(over: Partial<IntelEvent> = {}): IntelEvent {
  return {
    id: "evt_test1",
    title: "Anthropic launches Claude Code agent features",
    titleJa: "AnthropicがClaude Codeのエージェント機能を公開",
    category: "agents",
    categories: ["agents", "llms"],
    firstSeenAt: "2026-08-01T00:00:00.000Z",
    lastSeenAt: "2026-08-01T12:00:00.000Z",
    entities: ["Anthropic"],
    products: ["Claude Code"],
    models: [],
    companies: ["Anthropic"],
    keywords: ["agent", "claude"],
    articles: ["a1", "a2"],
    sourceCount: 2,
    sourceTypes: ["rss"],
    sourceDomains: ["anthropic.com", "techcrunch.com"],
    authorityScore: 80,
    evidenceScore: 60,
    freshnessScore: 90,
    noveltyScore: 70,
    velocityScore: 40,
    relevanceScore: 75,
    impactScore: 70,
    opportunityScore: 55,
    sourceDiversityScore: 60,
    strategicRelevanceScore: 70,
    actionabilityScore: 65,
    tommyRelevanceScore: 72,
    priorityScore: 68,
    status: "active",
    mentions_1h: 0,
    mentions_6h: 1,
    mentions_24h: 2,
    mentions_3d: 2,
    mentions_7d: 2,
    velocity: 30,
    acceleration: 1,
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T12:00:00.000Z",
    ...over,
  };
}

test("extract entities and claims from event", () => {
  const out = extractFromEvent(sampleEvent());
  assert.ok(out.entities.some((e) => e.name === "Anthropic"));
  assert.ok(out.claims.length >= 1);
  assert.equal(out.claims[0].source_article_ids.length >= 1, true);
  assert.ok(out.claims[0].source_event_ids.includes("evt_test1"));
});

test("merge knowledge deduplicates entities", () => {
  const a = extractFromEvent(sampleEvent());
  const b = extractFromEvent(sampleEvent({ id: "evt_test2", articles: ["a3"] }));
  const merged = mergeKnowledge([a, b]);
  const anthropic = merged.entities.filter((e) => e.name === "Anthropic");
  assert.equal(anthropic.length, 1);
  assert.ok(anthropic[0].source_event_ids.length >= 2);
});

test("RAG concept detected", () => {
  const out = extractFromEvent(
    sampleEvent({ title: "New RAG patterns for production agents" }),
  );
  assert.ok(out.concepts.some((c) => c.name === "RAG"));
});
