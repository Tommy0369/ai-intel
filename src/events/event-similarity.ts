import type { CatalogEntry } from "../types.js";
import { normalizeUrl } from "../dedup.js";
import { normalizeTitleKey } from "../enrich-canonicalize.js";
import { tokensOf } from "../analogy.js";
import { cosine, type EmbeddingProvider } from "../intelligence/embedding.js";
import { extractEntities, jaccard } from "./entities.js";
import { hostnameOf, preferPublisherUrl } from "./url.js";

export interface EventSimInput {
  entry: CatalogEntry;
  titleKey: string;
  tokens: Set<string>;
  entities: string[];
  domain: string;
  canonicalUrl: string;
  contentHash: string;
  ts: number;
  vec?: number[];
}

export function toSimInput(entry: CatalogEntry): EventSimInput {
  const title = entry.title_ja || entry.title;
  const canonicalUrl = entry.canonical_url
    ? normalizeUrl(entry.canonical_url)
    : normalizeUrl(preferPublisherUrl(entry));
  return {
    entry,
    titleKey: normalizeTitleKey(title),
    tokens: tokensOf(`${title} ${(entry.tags ?? []).join(" ")}`),
    entities: extractEntities(title, entry.tags).entities,
    domain: hostnameOf(preferPublisherUrl(entry)),
    canonicalUrl,
    contentHash: entry.content_hash || "",
    ts: Date.parse(entry.published_at || entry.collected_at || "") || 0,
  };
}

export function hoursApart(a: number, b: number): number {
  if (!a || !b) return 999;
  return Math.abs(a - b) / 3_600_000;
}

/**
 * 同一Event判定（0〜1）。Union-Findのエッジ重み。
 * 強い一致: content_hash / canonical_url / 同一正規化タイトル+近接日時
 */
export function eventPairScore(
  a: EventSimInput,
  b: EventSimInput,
  semantic = 0,
): number {
  if (a.entry.id === b.entry.id) return 1;

  if (
    a.contentHash &&
    b.contentHash &&
    a.contentHash.length >= 16 &&
    a.contentHash === b.contentHash
  ) {
    return 1;
  }

  if (
    a.canonicalUrl &&
    b.canonicalUrl &&
    !/news\.google\.com/i.test(a.canonicalUrl) &&
    a.canonicalUrl === b.canonicalUrl
  ) {
    return 1;
  }

  const titleSim =
    a.titleKey && a.titleKey === b.titleKey
      ? hoursApart(a.ts, b.ts) <= 720
        ? 1
        : 0.5
      : jaccard(a.titleKey.split(" "), b.titleKey.split(" "));
  const tok = jaccard(a.tokens, b.tokens);
  const ent = jaccard(a.entities, b.entities);
  const overlap = titleSim + tok + ent;
  if (overlap < 0.12) return overlap;

  const t = hoursApart(a.ts, b.ts);
  // 30日超は弱い一致だけでは統合しない
  if (t > 720 && titleSim < 0.85 && ent < 0.35) {
    return Math.min(0.45, overlap * 0.35 + semantic * 0.05);
  }

  const sameDomain = a.domain && a.domain === b.domain ? 0.12 : 0;
  const time =
    t <= 72 ? 0.2 : t <= 168 ? 0.14 : t <= 720 ? 0.06 : 0;
  const strongTitleDate =
    titleSim >= 0.85 && ent >= 0.25 && t <= 168 ? 0.15 : 0;
  return Math.min(
    1,
    titleSim * 0.38 +
      tok * 0.28 +
      ent * 0.18 +
      sameDomain +
      time +
      strongTitleDate +
      semantic * 0.1,
  );
}

export async function attachVectors(
  items: EventSimInput[],
  provider: EmbeddingProvider,
): Promise<void> {
  for (const it of items) {
    it.vec = await provider.embed(
      `${it.entry.title} ${it.entities.join(" ")}`,
    );
  }
}

export function semanticScore(a: EventSimInput, b: EventSimInput): number {
  if (!a.vec || !b.vec) return 0;
  return Math.max(0, cosine(a.vec, b.vec));
}

export const EVENT_JOIN_THRESHOLD = 0.62;
