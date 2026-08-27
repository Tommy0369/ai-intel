import assert from "node:assert/strict";
import test from "node:test";
import { isGoogleNewsUrl } from "../enrich-canonicalize.js";
import {
  annotateCatalogUrls,
  hostnameOf,
  preferPublisherUrl,
} from "./url.js";
import type { CatalogEntry } from "../types.js";

function entry(over: Partial<CatalogEntry>): CatalogEntry {
  return {
    id: "rss_1",
    title: "Hello",
    url: "https://news.google.com/rss/articles/ABC",
    source: "rss",
    category: "industry",
    collected_at: "2026-01-01T00:00:00.000Z",
    tags: [],
    lang: "en",
    path: "x.md",
    ...over,
  };
}

test("google news is not treated as publisher url", () => {
  assert.equal(isGoogleNewsUrl("https://news.google.com/rss/articles/ABC"), true);
  const a = annotateCatalogUrls(entry({}));
  assert.equal(a.fetch_status, "unresolved");
  assert.equal(a.discovery_url?.includes("news.google.com"), true);
  assert.equal(a.canonical_url, undefined);
  assert.equal(a.fetch_strategy, "google-news");
});

test("direct publisher url is canonical", () => {
  const a = annotateCatalogUrls(
    entry({ url: "https://www.theverge.com/ai/123?utm_source=x" }),
  );
  assert.equal(a.fetch_status, "not_attempted");
  assert.equal(a.fetch_strategy, "direct");
  assert.equal(hostnameOf(preferPublisherUrl(a)), "theverge.com");
  assert.ok(a.canonical_url?.includes("theverge.com"));
  assert.ok(!a.canonical_url?.includes("utm_source"));
});
