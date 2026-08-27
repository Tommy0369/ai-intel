import assert from "node:assert/strict";
import test from "node:test";
import { buildCrossInsights } from "./cross-intelligence.js";
import type { IntelEvent } from "../v2-types.js";

function ev(
  id: string,
  category: IntelEvent["category"],
  title: string,
  over: Partial<IntelEvent> = {},
): IntelEvent {
  return {
    id,
    title,
    titleJa: title,
    category,
    categories: [category],
    firstSeenAt: "2026-08-01T00:00:00.000Z",
    lastSeenAt: "2026-08-01T12:00:00.000Z",
    entities: over.entities ?? ["Agent"],
    products: [],
    models: [],
    companies: [],
    keywords: over.keywords ?? ["agent", "automation"],
    articles: [`art_${id}`],
    sourceCount: 2,
    sourceTypes: ["rss"],
    sourceDomains: ["example.com"],
    authorityScore: 70,
    evidenceScore: 50,
    freshnessScore: 80,
    noveltyScore: 60,
    velocityScore: 40,
    relevanceScore: 70,
    impactScore: 60,
    opportunityScore: 65,
    sourceDiversityScore: 50,
    strategicRelevanceScore: 60,
    actionabilityScore: 70,
    tommyRelevanceScore: 75,
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

test("cross insights require different category bridges", async () => {
  const same = await buildCrossInsights(
    [
      ev("1", "llms", "Claude agent update"),
      ev("2", "llms", "GPT agent tools"),
    ],
    { bridges: [] },
  );
  assert.equal(same.length, 0);

  const cross = await buildCrossInsights(
    [
      ev("a", "agents", "AI reservation agent launches"),
      ev("b", "dining", "Restaurant phone ops automation"),
    ],
    {
      bridges: [
        {
          left: ["agents"],
          right: ["dining"],
          relationship: "application",
          label: "AI × Dining",
        },
      ],
    },
  );
  assert.ok(cross.length >= 1);
  assert.equal(cross[0].relationship, "application");
  assert.ok(cross[0].eventIds.includes("a"));
  assert.ok(cross[0].eventIds.includes("b"));
  assert.ok((cross[0].confidence ?? 0) >= 0);
  assert.ok((cross[0].confidence ?? 0) <= 100);
});

test("duplicate pairs are suppressed", async () => {
  const cross = await buildCrossInsights(
    [
      ev("a", "agents", "Agent A"),
      ev("b", "dining", "Dining B"),
      ev("c", "dining", "Dining C"),
    ],
    {
      bridges: [
        {
          left: ["agents"],
          right: ["dining"],
          relationship: "application",
          label: "AI × Dining",
        },
      ],
    },
  );
  const keys = new Set(
    cross.map((x) => [...x.eventIds].sort().join("|") + x.relationship),
  );
  assert.equal(keys.size, cross.length);
});

test("contradiction stays low-confidence candidate wording", async () => {
  const cross = await buildCrossInsights(
    [
      ev("p", "llms", "Model launch success story", {
        keywords: ["model", "launch"],
      }),
      ev("n", "biz", "Model launch does not succeed", {
        keywords: ["model", "launch"],
      }),
    ],
    {
      claims: [
        {
          id: "cl1",
          text: "Model launch success",
          normalized_text: "model launch success",
          source_event_ids: ["p"],
          source_article_ids: ["a1"],
          support_count: 1,
          contradiction_count: 0,
          confidence: 0.5,
        },
        {
          id: "cl2",
          text: "Model launch does not succeed",
          normalized_text: "model launch does not",
          source_event_ids: ["n"],
          source_article_ids: ["a2"],
          support_count: 1,
          contradiction_count: 0,
          confidence: 0.5,
        },
      ],
      bridges: [],
    },
  );
  const contra = cross.filter((c) => c.relationship === "contradiction");
  if (contra.length) {
    assert.ok((contra[0].confidence ?? 100) < 50);
    assert.ok(contra[0].description.includes("possible_contradiction"));
    assert.ok(contra[0].claimIds?.length);
  }
});
