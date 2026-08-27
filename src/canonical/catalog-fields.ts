import type { CatalogEntry, FetchStatus } from "../types.js";
import { isGoogleNewsUrl } from "../enrich-canonicalize.js";
import { normalizeUrl } from "../dedup.js";

export function hostnameOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return "";
  }
}

/** Notebook / 表示用: canonical を優先 */
export function preferCanonicalUrl(
  entry: Pick<CatalogEntry, "url" | "canonical_url" | "discovery_url">,
): string {
  if (entry.canonical_url && !isGoogleNewsUrl(entry.canonical_url)) {
    return entry.canonical_url;
  }
  if (entry.url && !isGoogleNewsUrl(entry.url)) return entry.url;
  return entry.discovery_url || entry.url;
}

export function mapFetchStatusFromEnrich(input: {
  ok: boolean;
  chars: number;
  error?: string;
  unresolved?: boolean;
  httpStatus?: number;
}): FetchStatus {
  if (input.unresolved) return "unresolved";
  const err = input.error || "";
  if (err === "paywall") return "paywall";
  if (err === "js_shell") return "js_shell";
  if (err === "unresolved_news_url" || err === "dead_host") return "unresolved";
  if (input.httpStatus === 404) return "dead_source";
  if (input.ok) return "success";
  if (input.chars > 0) return "partial";
  if (err) return "failed";
  return "not_attempted";
}

export function initialCatalogFetchFields(
  url: string,
): Pick<
  CatalogEntry,
  | "discovery_url"
  | "canonical_url"
  | "canonical_domain"
  | "fetch_status"
  | "fetch_strategy"
> {
  const discovery_url = url;
  if (isGoogleNewsUrl(url)) {
    return {
      discovery_url,
      fetch_status: "not_attempted",
      fetch_strategy: "google-news",
    };
  }
  const canonical_url = normalizeUrl(url);
  return {
    discovery_url,
    canonical_url,
    canonical_domain: hostnameOf(canonical_url),
    fetch_status: "not_attempted",
    fetch_strategy: "direct",
  };
}
