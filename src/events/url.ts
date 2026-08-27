import { isGoogleNewsUrl } from "../enrich-canonicalize.js";
import { normalizeUrl } from "../dedup.js";
import type { CatalogEntry, FetchStatus } from "../types.js";
import { contentHash as legacyHash } from "./content-hash-shim.js";
import {
  hostnameOf,
  initialCatalogFetchFields,
  preferCanonicalUrl,
} from "../canonical/catalog-fields.js";

export { hostnameOf, preferCanonicalUrl };

/** @deprecated preferCanonicalUrl を使う */
export const preferPublisherUrl = preferCanonicalUrl;

export function workingUrl(entry: CatalogEntry): string {
  return normalizeUrl(preferCanonicalUrl(entry));
}

/** ネットワークなしで Catalog の正規化フィールドを埋める（後方互換） */
export function annotateCatalogUrls(entry: CatalogEntry): CatalogEntry {
  const discovery = entry.discovery_url || entry.url;
  const google = isGoogleNewsUrl(discovery) || isGoogleNewsUrl(entry.url);
  if (google) {
    const canonical =
      entry.canonical_url && !isGoogleNewsUrl(entry.canonical_url)
        ? entry.canonical_url
        : undefined;
    const fetch_status: FetchStatus =
      entry.fetch_status ?? (canonical ? "not_attempted" : "unresolved");
    return {
      ...entry,
      discovery_url: discovery,
      canonical_url: canonical,
      canonical_domain: canonical ? hostnameOf(canonical) : undefined,
      content_hash:
        entry.content_hash ??
        legacyHash(`${entry.title}|${discovery}|${entry.source}`),
      fetch_status,
      fetch_strategy: entry.fetch_strategy ?? "google-news",
    };
  }
  const seeded = initialCatalogFetchFields(discovery);
  const canonical = normalizeUrl(entry.canonical_url || entry.url);
  return {
    ...entry,
    ...seeded,
    discovery_url: discovery,
    canonical_url: canonical,
    canonical_domain: hostnameOf(canonical),
    content_hash:
      entry.content_hash ??
      legacyHash(`${entry.title}|${canonical}|${entry.source}`),
    fetch_status: entry.fetch_status ?? "not_attempted",
    fetch_strategy: entry.fetch_strategy ?? "direct",
  };
}
