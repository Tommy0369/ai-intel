import assert from "node:assert/strict";
import test from "node:test";
import { ideasFromEvent } from "./idea-engine.js";
import { cardFromIdea } from "./content-card.js";
import { transformPlatform } from "./platform-transformer.js";
import type { IntelEvent } from "../v2-types.js";

const ev: IntelEvent = {
  id: "evt_test",
  title: "Claude adds a new tool",
  titleJa: "Claudeに新機能",
  category: "agents",
  categories: ["agents", "biz"],
  firstSeenAt: "2026-08-01T00:00:00.000Z",
  lastSeenAt: "2026-08-01T03:00:00.000Z",
  entities: ["Anthropic", "Claude"],
  products: ["Claude"],
  models: ["Claude"],
  companies: ["Anthropic"],
  keywords: ["claude", "tool"],
  articles: ["a", "b"],
  sourceCount: 2,
  sourceTypes: ["rss", "x"],
  sourceDomains: ["anthropic.com", "theverge.com"],
  authorityScore: 80,
  evidenceScore: 50,
  freshnessScore: 90,
  noveltyScore: 70,
  velocityScore: 40,
  relevanceScore: 70,
  impactScore: 60,
  opportunityScore: 55,
  sourceDiversityScore: 50,
  strategicRelevanceScore: 70,
  actionabilityScore: 65,
  tommyRelevanceScore: 80,
  priorityScore: 72,
  status: "emerging",
  mentions_1h: 1,
  mentions_6h: 2,
  mentions_24h: 4,
  mentions_3d: 4,
  mentions_7d: 4,
  velocity: 40,
  acceleration: 2,
  createdAt: "2026-08-01T00:00:00.000Z",
  updatedAt: "2026-08-01T00:00:00.000Z",
};

test("one event yields idea, card, and platform pack", () => {
  const ideas = ideasFromEvent(ev, "2026-08-01T00:00:00.000Z");
  assert.equal(ideas.length, 1);
  assert.ok(ideas[0].angles.length >= 4);
  const card = cardFromIdea(ideas[0], new Map([[ev.id, ev]]));
  assert.ok(card.hook.length > 0);
  const pack = transformPlatform(ideas[0], card);
  assert.ok(pack.xShort.includes("Claude"));
  assert.ok(pack.noteArticle.startsWith("#"));
});
