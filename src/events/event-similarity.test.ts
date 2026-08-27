import assert from "node:assert/strict";
import test from "node:test";
import { eventPairScore, hoursApart, toSimInput } from "./event-similarity.js";
import { pickRepresentativeArticle } from "./event-representative.js";
import type { CatalogEntry } from "../types.js";

function e(
  title: string,
  id: string,
  over: Partial<CatalogEntry> = {},
): CatalogEntry {
  return {
    id,
    title,
    url: "https://example.com/" + id,
    source: "rss",
    category: "llms",
    collected_at: "2026-08-01T10:00:00.000Z",
    published_at: "2026-08-01T09:00:00.000Z",
    tags: ["Claude"],
    lang: "en",
    path: "p.md",
    ...over,
  };
}

test("similar titles join as one event", () => {
  const a = toSimInput(e("Claude gets new coding agent", "1"));
  const b = toSimInput(e("Claude coding agent launched today", "2"));
  assert.ok(eventPairScore(a, b) > 0.4);
});

test("unrelated titles stay apart", () => {
  const a = toSimInput(e("Restaurant labor costs in Tokyo", "1"));
  const b = toSimInput(e("NVIDIA GPU supply chain update", "2"));
  assert.ok(eventPairScore(a, b) < 0.5);
});

test("same canonical URL → same event score 1", () => {
  const url = "https://techcrunch.com/2026/01/01/claude";
  const a = toSimInput(e("Claude agent news", "1", { canonical_url: url }));
  const b = toSimInput(e("Different headline", "2", { canonical_url: url }));
  assert.equal(eventPairScore(a, b), 1);
});

test("same content hash → same event score 1", () => {
  const hash = "a".repeat(64);
  const a = toSimInput(e("Title A", "1", { content_hash: hash }));
  const b = toSimInput(e("Title B", "2", { content_hash: hash }));
  assert.equal(eventPairScore(a, b), 1);
});

test("similar title but months apart stays weak", () => {
  const a = toSimInput(
    e("OpenAI launches GPT-5 preview for developers", "1", {
      published_at: "2026-01-01T00:00:00.000Z",
      tags: ["OpenAI", "GPT-5"],
    }),
  );
  const b = toSimInput(
    e("OpenAI announces enterprise pricing changes", "2", {
      published_at: "2026-08-01T00:00:00.000Z",
      tags: ["OpenAI"],
    }),
  );
  assert.ok(hoursApart(a.ts, b.ts) > 720);
  assert.ok(eventPairScore(a, b) < 0.62);
});

test("duplicate article id scores 1", () => {
  const a = toSimInput(e("Same", "1"));
  const b = toSimInput(e("Same", "1"));
  assert.equal(eventPairScore(a, b), 1);
});

test("representative prefers canonical + success fetch", () => {
  const rep = pickRepresentativeArticle([
    e("Short", "a", { url: "https://news.google.com/x" }),
    e("Long official", "b", {
      url: "https://openai.com/blog/x",
      canonical_url: "https://openai.com/blog/x",
      canonical_domain: "openai.com",
      fetch_status: "success",
    }),
  ]);
  assert.equal(rep, "b");
});
