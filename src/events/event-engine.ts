import { createHash } from "node:crypto";
import { sortByRecency } from "../corpus.js";
import type { AppConfig, CatalogEntry, Category } from "../types.js";
import { CATEGORIES } from "../types.js";
import { nowIso } from "../http.js";
import { glanceOf } from "../title-ja.js";
import { createEmbeddingProvider } from "../intelligence/embedding.js";
import {
  articleIntelligence,
  mergeWeights,
  priorityScore,
} from "../intelligence/scoring.js";
import type { EventStatus, IntelEvent } from "../v2-types.js";
import { extractEntities } from "./entities.js";
import {
  EVENT_JOIN_THRESHOLD,
  attachVectors,
  eventPairScore,
  semanticScore,
  toSimInput,
  type EventSimInput,
} from "./event-similarity.js";
import { annotateCatalogUrls, hostnameOf, preferPublisherUrl } from "./url.js";
import { saveEvents } from "./event-store.js";
import { pickRepresentativeArticle } from "./event-representative.js";
import { patchCatalogEntries } from "../catalog-patch.js";
import { normalizeUrl } from "../dedup.js";
import { scoreTommyRelevance } from "../relevance/relevance-engine.js";

class UnionFind {
  parent: number[];
  constructor(n: number) {
    this.parent = Array.from({ length: n }, (_, i) => i);
  }
  find(i: number): number {
    while (this.parent[i] !== i) {
      this.parent[i] = this.parent[this.parent[i]];
      i = this.parent[i];
    }
    return i;
  }
  union(a: number, b: number): void {
    const pa = this.find(a);
    const pb = this.find(b);
    if (pa !== pb) this.parent[pa] = pb;
  }
}

function eventId(memberIds: string[]): string {
  const h = createHash("sha1").update(memberIds.slice().sort().join("|")).digest("hex");
  return `evt_${h.slice(0, 12)}`;
}

function statusFromCounts(c24: number, c7: number): EventStatus {
  if (c24 >= 8) return "active";
  if (c24 >= 3) return "emerging";
  if (c7 >= 12) return "mature";
  if (c24 === 0 && c7 <= 1) return "declining";
  return "active";
}

function keywordsFrom(title: string, tags: string[]): string[] {
  const toks = title
    .toLowerCase()
    .split(/[^a-z0-9\u3040-\u30ff\u4e00-\u9fff]+/i)
    .filter((t) => t.length >= 4);
  return [...new Set([...toks.slice(0, 8), ...tags.slice(0, 6)])];
}

export interface EventEngineOpts {
  limit?: number;
  withEmbeddings?: boolean;
  rebuild?: boolean;
  linkCatalog?: boolean;
}

export async function buildEvents(
  catalog: CatalogEntry[],
  config: AppConfig,
  opts: EventEngineOpts = {},
): Promise<IntelEvent[]> {
  const now = Date.now();
  const limit = Math.min(Math.max(opts.limit ?? 2500, 200), 5000);
  const slice = sortByRecency(catalog)
    .slice(0, limit)
    .map(annotateCatalogUrls);
  if (!slice.length) return [];

  const items: EventSimInput[] = slice.map(toSimInput);
  const provider = createEmbeddingProvider("local");
  if (opts.withEmbeddings !== false) {
    await attachVectors(items, provider);
  }

  const uf = new UnionFind(items.length);
  const buckets = new Map<string, number[]>();
  for (let i = 0; i < items.length; i++) {
    const day = (items[i].ts || now).toString().slice(0, 8);
    const key = `${items[i].titleKey.slice(0, 10)}|${day}`;
    const list = buckets.get(key) ?? [];
    list.push(i);
    buckets.set(key, list);
    const loose = items[i].titleKey.slice(0, 6);
    const l2 = buckets.get(loose) ?? [];
    l2.push(i);
    buckets.set(loose, l2);
  }

  const considered = new Set<string>();
  for (const idxs of buckets.values()) {
    const uniq = [...new Set(idxs)];
    if (uniq.length > 80) uniq.length = 80;
    for (let a = 0; a < uniq.length; a++) {
      for (let b = a + 1; b < uniq.length; b++) {
        const i = uniq[a];
        const j = uniq[b];
        const pairKey = i < j ? `${i}:${j}` : `${j}:${i}`;
        if (considered.has(pairKey)) continue;
        considered.add(pairKey);
        const sem = semanticScore(items[i], items[j]);
        if (eventPairScore(items[i], items[j], sem) >= EVENT_JOIN_THRESHOLD) {
          uf.union(i, j);
        }
      }
    }
  }

  const groups = new Map<number, number[]>();
  for (let i = 0; i < items.length; i++) {
    const r = uf.find(i);
    const g = groups.get(r) ?? [];
    g.push(i);
    groups.set(r, g);
  }

  const weights = mergeWeights(config);
  const events: IntelEvent[] = [];
  const isoNow = nowIso();

  for (const idxs of groups.values()) {
    const members = idxs.map((i) => items[i].entry);
    const ids = members.map((m) => m.id);
    const named = extractEntities(
      members.map((m) => m.title).join(" "),
      members.flatMap((m) => m.tags ?? []),
    );
    const cats = [...new Set(members.map((m) => m.category))];
    const primary =
      cats.sort(
        (a, b) =>
          members.filter((m) => m.category === b).length -
          members.filter((m) => m.category === a).length,
      )[0] ?? "other";
    const times = members
      .map((m) => Date.parse(m.published_at || m.collected_at || "") || 0)
      .filter(Boolean);
    const first = times.length ? new Date(Math.min(...times)).toISOString() : isoNow;
    const last = times.length ? new Date(Math.max(...times)).toISOString() : isoNow;
    const domains = [
      ...new Set(members.map((m) => hostnameOf(preferPublisherUrl(m))).filter(Boolean)),
    ];
    const types = [...new Set(members.map((m) => m.source))];
    const intel = members.map((m) => articleIntelligence(m, now, members.length));
    const avg = (sel: (x: (typeof intel)[0]) => number) =>
      Math.round(intel.reduce((s, x) => s + sel(x), 0) / intel.length);

    const counts = mentionWindows(times, now);
    const diversity = clamp((domains.length / Math.max(1, members.length)) * 100);
    const velocity = clamp(counts.c24 * 8 + counts.c6 * 4);
    const tommy = Math.round(
      members.reduce((s, m) => s + scoreTommyRelevance(m), 0) / members.length,
    );
    const relevance = clamp((tommy + (cats.includes("biz") ? 10 : 0)) * 0.9);
    const pri = priorityScore(
      {
        authority: avg((x) => x.authorityScore),
        evidence: avg((x) => x.evidenceScore),
        freshness: avg((x) => x.freshnessScore),
        novelty: avg((x) => x.noveltyScore),
        velocity,
        diversity,
        relevance,
        actionability: avg((x) => x.actionabilityScore),
        opportunity: avg((x) => x.opportunityScore),
      },
      weights,
    );
    const head = members[0];
    const repId = pickRepresentativeArticle(members);
    const canonicalUrls = [
      ...new Set(
        members
          .map((m) => m.canonical_url || preferPublisherUrl(m))
          .filter((u) => u && !/news\.google\.com/i.test(u))
          .map((u) => normalizeUrl(u)),
      ),
    ];
    const confidence = clamp(
      40 +
        Math.min(30, domains.length * 8) +
        (members.some((m) => m.fetch_status === "success") ? 20 : 0) +
        Math.min(10, members.length * 2),
    );
    events.push({
      id: eventId(ids),
      title: head.title,
      titleJa: glanceOf(head),
      category: (CATEGORIES.includes(primary as Category) ? primary : "other") as Category,
      categories: cats,
      firstSeenAt: first,
      lastSeenAt: last,
      entities: named.entities,
      products: named.products,
      models: named.models,
      companies: named.companies,
      keywords: keywordsFrom(head.title, head.tags ?? []),
      articles: ids,
      representativeArticleId: repId,
      canonicalUrls,
      confidence,
      sourceCount: members.length,
      sourceTypes: types,
      sourceDomains: domains,
      authorityScore: avg((x) => x.authorityScore),
      evidenceScore: avg((x) => x.evidenceScore),
      freshnessScore: avg((x) => x.freshnessScore),
      noveltyScore: avg((x) => x.noveltyScore),
      velocityScore: velocity,
      relevanceScore: relevance,
      impactScore: clamp(pri * 0.8 + diversity * 0.2),
      opportunityScore: avg((x) => x.opportunityScore),
      sourceDiversityScore: diversity,
      strategicRelevanceScore: relevance,
      actionabilityScore: avg((x) => x.actionabilityScore),
      tommyRelevanceScore: tommy,
      priorityScore: pri,
      status: statusFromCounts(counts.c24, counts.c7),
      mentions_1h: counts.c1,
      mentions_6h: counts.c6,
      mentions_24h: counts.c24,
      mentions_3d: counts.c3d,
      mentions_7d: counts.c7,
      velocity,
      acceleration: counts.c24 - counts.c3d / 3,
      createdAt: isoNow,
      updatedAt: isoNow,
    });
  }

  events.sort((a, b) => b.priorityScore - a.priorityScore);
  await saveEvents(config.dataRoot, events, {
    catalogArticleCount: slice.length,
    rebuilt: opts.rebuild === true,
  });
  if (opts.linkCatalog !== false) {
    await linkCatalogEventIds(config.dataRoot, events);
  }
  return events;
}

async function linkCatalogEventIds(
  dataRoot: string,
  events: IntelEvent[],
): Promise<number> {
  const patches: Array<{ id: string; event_id: string }> = [];
  const seen = new Set<string>();
  for (const ev of events) {
    for (const aid of ev.articles) {
      const key = `${aid}:${ev.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      patches.push({ id: aid, event_id: ev.id });
    }
  }
  return patchCatalogEntries(dataRoot, patches);
}

function mentionWindows(times: number[], now: number) {
  const h = (n: number) => times.filter((t) => now - t <= n * 3_600_000).length;
  return {
    c1: h(1),
    c6: h(6),
    c24: h(24),
    c3d: h(72),
    c7: h(168),
  };
}

function clamp(n: number): number {
  return Math.max(0, Math.min(100, Math.round(n)));
}

export async function runEventEngine(
  config: AppConfig,
  catalog: CatalogEntry[],
  opts?: EventEngineOpts,
): Promise<IntelEvent[]> {
  return buildEvents(catalog, config, opts);
}
