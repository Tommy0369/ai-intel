import type { RawItem, SourcesConfig } from "../types.js";
import { fetchFeedItems, toRawItems } from "./feed.js";

type ArxivConfig = SourcesConfig["arxiv"] & { keywordQueries?: string[] };

export async function collectArxiv(
  sources: SourcesConfig,
  userAgent: string,
): Promise<RawItem[]> {
  if (!sources.arxiv.enabled) return [];
  const out: RawItem[] = [];
  const cfg = sources.arxiv as ArxivConfig;
  const max = sources.arxiv.maxPerCategory;

  for (const cat of sources.arxiv.categories) {
    const url =
      `https://export.arxiv.org/api/query?search_query=cat:${encodeURIComponent(cat)}` +
      `&start=0&max_results=${max}&sortBy=submittedDate&sortOrder=descending`;
    try {
      const items = await fetchFeedItems(url, userAgent);
      out.push(
        ...toRawItems(items, "arxiv", {
          categoryHint: "research",
          max,
        }).map((item) => ({
          ...item,
          tags: [...(item.tags ?? []), cat],
        })),
      );
    } catch (err) {
      console.warn(`  [arxiv] ${cat}:`, err instanceof Error ? err.message : err);
    }
  }

  for (const q of cfg.keywordQueries ?? []) {
    const query = q.trim();
    if (!query) continue;
    const isReview =
      /systematic review|meta[- ]?analysis|literature review|scoping review/i.test(
        query,
      );
    const url =
      `https://export.arxiv.org/api/query?search_query=all:${encodeURIComponent(query)}` +
      `&start=0&max_results=${max}&sortBy=submittedDate&sortOrder=descending`;
    try {
      const items = await fetchFeedItems(url, userAgent);
      out.push(
        ...toRawItems(items, "arxiv", {
          categoryHint: isReview ? "reviews" : "research",
          max,
        }).map((item) => ({
          ...item,
          tags: [
            ...(item.tags ?? []),
            "keyword",
            query.slice(0, 40),
            ...(isReview ? ["review-lit"] : []),
          ],
        })),
      );
      console.log(`  [arxiv] kw:${query.slice(0, 40)}: ${Math.min(items.length, max)}`);
    } catch (err) {
      console.warn(
        `  [arxiv] kw:${query}:`,
        err instanceof Error ? err.message : err,
      );
    }
  }

  return out;
}
