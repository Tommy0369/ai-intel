import assert from "node:assert/strict";
import test from "node:test";
import { normalizeUrl } from "../dedup.js";
import { isGoogleNewsUrl } from "../enrich-canonicalize.js";
import {
  contentHashSha256,
  normalizeContentForHash,
} from "./content-hash.js";
import {
  extractRelCanonical,
  isPlausibleArticleCanonical,
} from "./rel-canonical.js";
import {
  initialCatalogFetchFields,
  mapFetchStatusFromEnrich,
  preferCanonicalUrl,
} from "./catalog-fields.js";
import { computeSourceStatus } from "../source-health/source-health-store.js";
import type { CatalogEntry } from "../types.js";

test("normalizeUrl strips tracking params", () => {
  const n = normalizeUrl(
    "https://example.com/a/b/?utm_source=x&utm_medium=y&fbclid=1&gclid=2&id=keep#hash",
  );
  assert.ok(!n.includes("utm_"));
  assert.ok(!n.includes("fbclid"));
  assert.ok(!n.includes("gclid"));
  assert.ok(!n.includes("#"));
  assert.ok(n.includes("id=keep"));
  assert.ok(n.startsWith("https://example.com/a/b"));
});

test("normalizeUrl keeps article-identifying query", () => {
  const n = normalizeUrl("https://example.com/story?id=12345&ref=sidebar");
  assert.equal(n, "https://example.com/story?id=12345");
});

test("detect Google News discovery URLs", () => {
  assert.equal(
    isGoogleNewsUrl("https://news.google.com/rss/articles/CBMiABC"),
    true,
  );
  assert.equal(isGoogleNewsUrl("https://www.theverge.com/ai/1"), false);
});

test("rel=canonical extraction rejects homepage", () => {
  const html = `<html><head>
    <link rel="canonical" href="https://example.com/" />
  </head></html>`;
  assert.equal(extractRelCanonical(html, "https://example.com/a/1"), null);
  assert.equal(
    isPlausibleArticleCanonical("https://example.com/", "https://example.com/a/1"),
    false,
  );
});

test("rel=canonical adopts article path", () => {
  const html = `<html><head>
    <link rel="canonical" href="/news/story-42" />
  </head></html>`;
  const got = extractRelCanonical(html, "https://example.com/news/story-42?utm=1");
  assert.equal(got, "https://example.com/news/story-42");
});

test("content_hash is stable after whitespace normalize", () => {
  const a = contentHashSha256("Hello   world\r\n\r\n!");
  const b = contentHashSha256("Hello world\n\n!");
  assert.equal(a, b);
  assert.equal(a.length, 64);
  assert.ok(normalizeContentForHash("  a\t\tb  ").includes("a b"));
});

test("mapFetchStatusFromEnrich covers main codes", () => {
  assert.equal(
    mapFetchStatusFromEnrich({ ok: true, chars: 100 }),
    "success",
  );
  assert.equal(
    mapFetchStatusFromEnrich({ ok: false, chars: 10, error: "paywall" }),
    "paywall",
  );
  assert.equal(
    mapFetchStatusFromEnrich({ ok: false, chars: 0, unresolved: true }),
    "unresolved",
  );
  assert.equal(
    mapFetchStatusFromEnrich({ ok: false, chars: 0, httpStatus: 404 }),
    "dead_source",
  );
  assert.equal(
    mapFetchStatusFromEnrich({ ok: false, chars: 50 }),
    "partial",
  );
});

test("initialCatalogFetchFields: Google News vs direct", () => {
  const g = initialCatalogFetchFields(
    "https://news.google.com/rss/articles/XYZ",
  );
  assert.equal(g.fetch_status, "not_attempted");
  assert.equal(g.fetch_strategy, "google-news");
  assert.equal(g.canonical_url, undefined);

  const d = initialCatalogFetchFields("https://www.openai.com/blog/x?utm_source=a");
  assert.equal(d.fetch_strategy, "direct");
  assert.ok(d.canonical_url?.includes("openai.com"));
  assert.equal(d.canonical_domain, "openai.com");
});

test("preferCanonicalUrl skips google news", () => {
  const e: Pick<CatalogEntry, "url" | "canonical_url" | "discovery_url"> = {
    url: "https://news.google.com/rss/articles/1",
    discovery_url: "https://news.google.com/rss/articles/1",
    canonical_url: "https://techcrunch.com/2026/01/01/foo",
  };
  assert.equal(preferCanonicalUrl(e), "https://techcrunch.com/2026/01/01/foo");
});

test("CatalogEntry remains readable without new fields", () => {
  const legacy: CatalogEntry = {
    id: "rss_abc",
    title: "Old",
    url: "https://example.com/old",
    source: "rss",
    category: "other",
    collected_at: "2020-01-01T00:00:00.000Z",
    tags: [],
    lang: "en",
    path: "x.md",
  };
  assert.equal(legacy.canonical_url, undefined);
  assert.equal(preferCanonicalUrl(legacy), "https://example.com/old");
  const seeded = initialCatalogFetchFields(legacy.url);
  assert.ok(seeded.canonical_url);
});

test("source-health status aggregation rules", () => {
  assert.equal(
    computeSourceStatus({ attempts: 2, successRate: 1, consecutiveFailures: 0 }),
    "healthy",
  );
  assert.equal(
    computeSourceStatus({ attempts: 3, successRate: 0.2, consecutiveFailures: 3 }),
    "warning",
  );
  assert.equal(
    computeSourceStatus({ attempts: 10, successRate: 0.3, consecutiveFailures: 5 }),
    "dead",
  );
  assert.equal(
    computeSourceStatus({ attempts: 10, successRate: 0.9, consecutiveFailures: 0 }),
    "healthy",
  );
  assert.equal(
    computeSourceStatus({ attempts: 10, successRate: 0.6, consecutiveFailures: 1 }),
    "warning",
  );
});
