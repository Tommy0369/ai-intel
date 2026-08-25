import type { Category, RawItem, SourcesConfig } from "../types.js";
import { fetchJson } from "../http.js";

type EuropePmcConfig = NonNullable<SourcesConfig["europePmc"]>;

interface EuropePmcResult {
  id?: string;
  source?: string;
  pmid?: string;
  pmcid?: string;
  doi?: string;
  title?: string;
  authorString?: string;
  abstractText?: string;
  journalTitle?: string;
  pubYear?: string;
  firstPublicationDate?: string;
  pubType?: string | string[];
}

interface EuropePmcResponse {
  hitCount?: number;
  resultList?: { result?: EuropePmcResult[] };
}

function pubTypes(r: EuropePmcResult): string {
  const t = r.pubType;
  if (Array.isArray(t)) return t.join(" ");
  return t ?? "";
}

function classifyReviewTags(title: string, abstract: string, pubType: string): string[] {
  const hay = `${title}\n${abstract}\n${pubType}`.toLowerCase();
  const tags: string[] = ["review-lit"];
  if (
    /systematic review/.test(hay) ||
    /systematic reviews/.test(pubType.toLowerCase())
  ) {
    tags.push("systematic-review");
  }
  if (/meta[- ]?analysis/.test(hay) || /meta-analysis/.test(pubType.toLowerCase())) {
    tags.push("meta-analysis");
  }
  if (
    /scoping review|narrative review|literature review|umbrella review|integrative review/.test(
      hay,
    )
  ) {
    tags.push("review-paper");
  }
  // どれにも当たらなければ広いレビュー扱い
  if (
    !tags.includes("systematic-review") &&
    !tags.includes("meta-analysis") &&
    !tags.includes("review-paper")
  ) {
    if (/\breview\b/.test(hay)) tags.push("review-paper");
  }
  return tags;
}

function itemUrl(r: EuropePmcResult): string {
  if (r.doi) return `https://doi.org/${r.doi}`;
  if (r.pmid) return `https://pubmed.ncbi.nlm.nih.gov/${r.pmid}/`;
  if (r.pmcid) return `https://www.ncbi.nlm.nih.gov/pmc/articles/${r.pmcid}/`;
  return `https://europepmc.org/article/${r.source || "MED"}/${r.id || ""}`;
}

function publishedAt(r: EuropePmcResult): string | undefined {
  if (r.firstPublicationDate) {
    // YYYY-MM-DD
    const t = Date.parse(r.firstPublicationDate);
    if (Number.isFinite(t)) return new Date(t).toISOString();
  }
  if (r.pubYear && /^\d{4}$/.test(r.pubYear)) {
    return new Date(`${r.pubYear}-01-01T00:00:00.000Z`).toISOString();
  }
  return undefined;
}

/** Europe PMC: システマティックレビュー / メタアナリシス / レビュー論文 */
export async function collectEuropePmc(
  sources: SourcesConfig,
  userAgent: string,
): Promise<RawItem[]> {
  const cfg = sources.europePmc as EuropePmcConfig | undefined;
  if (!cfg?.enabled) return [];

  const out: RawItem[] = [];
  const max = cfg.maxPerQuery ?? 15;

  for (const q of cfg.queries) {
    const query = q.query.trim();
    if (!query) continue;
    const url =
      `https://www.ebi.ac.uk/europepmc/webservices/rest/search` +
      `?query=${encodeURIComponent(query)}` +
      `&resultType=core&pageSize=${max}&format=json`;
    try {
      const data = await fetchJson<EuropePmcResponse>(url, userAgent, {
        headers: { Accept: "application/json" },
      });
      const results = data.resultList?.result ?? [];
      let n = 0;
      for (const r of results) {
        const title = (r.title || "").replace(/<[^>]+>/g, "").trim();
        if (!title) continue;
        const abstract = (r.abstractText || "").replace(/<[^>]+>/g, " ").trim();
        const types = pubTypes(r);
        const reviewTags = classifyReviewTags(title, abstract, types);
        const authors = (r.authorString || "")
          .split(",")
          .map((a) => a.trim())
          .filter(Boolean)
          .slice(0, 8);
        out.push({
          title,
          url: itemUrl(r),
          source: "europepmc",
          summary: abstract.slice(0, 1200),
          publishedAt: publishedAt(r),
          authors,
          lang: "en",
          categoryHint: (q.categoryHint as Category) || "reviews",
          tags: [
            "europepmc",
            q.id,
            ...(q.tags ?? []),
            ...reviewTags,
            r.journalTitle ? `journal:${r.journalTitle.slice(0, 40)}` : "",
          ].filter(Boolean),
          extra: {
            pmid: r.pmid,
            doi: r.doi,
            pubType: types,
          },
        });
        n++;
      }
      console.log(
        `  [europepmc] ${q.id}: ${n} (hits≈${data.hitCount ?? "?"})`,
      );
    } catch (err) {
      console.warn(
        `  [europepmc] ${q.id}:`,
        err instanceof Error ? err.message : err,
      );
    }
  }

  return out;
}
