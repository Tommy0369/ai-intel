import type { CatalogEntry, SourceKind } from "../types.js";
import type { AuthorityTier, EvidenceTier } from "../v2-types.js";
import { isGoogleNewsUrl } from "../enrich-canonicalize.js";
import { hostnameOf, preferPublisherUrl } from "../events/url.js";

const OFFICIAL_HOST =
  /openai\.com|anthropic\.com|deepmind\.google|ai\.google|blog\.google|meta\.ai|ai\.meta\.com|x\.ai|mistral\.ai|huggingface\.co|pytorch\.org|langchain\.com|llamaindex\.ai|vercel\.com/i;

export function authorityTier(entry: CatalogEntry): AuthorityTier {
  const url = preferPublisherUrl(entry);
  const host = hostnameOf(url);
  if (entry.source === "docs" || OFFICIAL_HOST.test(host)) {
    if (/docs\.|documentation|platform\./i.test(url)) return "docs";
    return "official";
  }
  if (entry.source === "arxiv" || /arxiv\.org|doi\.org|pubmed|europepmc/i.test(url)) {
    return "primary-source";
  }
  if (/techcrunch|theverge|reuters|apnews|bbc\.|nytimes|bloomberg/i.test(host)) {
    return "major-press";
  }
  if (entry.source === "rss" && /blog/i.test(host)) return "company-blog";
  if (entry.source === "youtube" || entry.source === "x") return "sns";
  if (entry.source === "reddit") return "forum";
  if (entry.source === "github") return "primary-source";
  return "general-news";
}

export function authorityScore(entry: CatalogEntry): number {
  const tier = authorityTier(entry);
  const table: Record<AuthorityTier, number> = {
    official: 96,
    docs: 94,
    "company-blog": 82,
    "primary-source": 88,
    "major-press": 74,
    specialty: 70,
    "general-news": 58,
    sns: 32,
    forum: 28,
  };
  let n = table[tier];
  if (isGoogleNewsUrl(entry.url)) n -= 8;
  return clamp(n);
}

export function evidenceTier(entry: CatalogEntry): EvidenceTier {
  const hay = `${entry.title} ${(entry.tags ?? []).join(" ")} ${entry.category}`;
  if (/meta[- ]?analy/i.test(hay)) return "meta-analysis";
  if (/systematic review/i.test(hay) || entry.category === "reviews") {
    return "systematic-review";
  }
  if (/\brct\b|randomized/i.test(hay)) return "rct";
  if (/peer[- ]?review/i.test(hay) || entry.source === "europepmc") {
    return "peer-reviewed";
  }
  if (entry.source === "arxiv") return "preprint";
  if (entry.source === "docs" || /release notes|changelog/i.test(hay)) {
    return "official-announcement";
  }
  if (entry.source === "github") return "technical-report";
  if (entry.source === "x" || entry.source === "reddit" || entry.source === "youtube") {
    return "sns-opinion";
  }
  return "news";
}

export function evidenceScore(entry: CatalogEntry): number {
  const tier = evidenceTier(entry);
  const table: Record<EvidenceTier, number> = {
    "meta-analysis": 96,
    "systematic-review": 92,
    rct: 88,
    "peer-reviewed": 84,
    observational: 70,
    preprint: 62,
    "technical-report": 68,
    "official-announcement": 80,
    news: 48,
    "expert-opinion": 44,
    "sns-opinion": 22,
  };
  return table[tier];
}

function clamp(n: number): number {
  return Math.max(0, Math.min(100, Math.round(n)));
}

export function sourceKindBoost(source: SourceKind): number {
  if (source === "docs") return 8;
  if (source === "arxiv") return 4;
  return 0;
}
