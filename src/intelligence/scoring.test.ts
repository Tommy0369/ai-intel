import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_SCORING_WEIGHTS } from "../v2-types.js";
import { priorityScore } from "./scoring.js";
import { authorityScore, evidenceScore } from "./authority.js";
import type { CatalogEntry } from "../types.js";

const official: CatalogEntry = {
  id: "d1",
  title: "Claude release notes",
  url: "https://docs.anthropic.com/en/release-notes",
  source: "docs",
  category: "agents",
  collected_at: "2026-08-01T00:00:00.000Z",
  tags: [],
  lang: "en",
  path: "p.md",
};

const sns: CatalogEntry = {
  id: "x1",
  title: "hot take",
  url: "https://nitter.net/foo/status/1",
  source: "x",
  category: "trends",
  collected_at: "2026-08-01T00:00:00.000Z",
  tags: [],
  lang: "en",
  path: "p.md",
};

const preprint: CatalogEntry = {
  id: "a1",
  title: "A transformer paper",
  url: "https://arxiv.org/abs/2401.00001",
  source: "arxiv",
  category: "research",
  collected_at: "2026-08-01T00:00:00.000Z",
  tags: [],
  lang: "en",
  path: "p.md",
};

test("authority and evidence are separated", () => {
  assert.ok(authorityScore(official) > authorityScore(sns));
  assert.ok(evidenceScore(preprint) < 80, "arxiv is preprint not top evidence");
  assert.ok(evidenceScore(official) > evidenceScore(sns));
});

test("priority weights sum-ish produce 0-100", () => {
  const n = priorityScore(
    {
      authority: 80,
      evidence: 50,
      freshness: 90,
      novelty: 70,
      velocity: 40,
      diversity: 30,
      relevance: 80,
      actionability: 60,
      opportunity: 50,
    },
    DEFAULT_SCORING_WEIGHTS,
  );
  assert.ok(n >= 0 && n <= 100);
});
