import type { RawItem, SourcesConfig } from "../types.js";
import { fetchFeedItems, toRawItems } from "./feed.js";

export async function collectRss(
  sources: SourcesConfig,
  userAgent: string,
): Promise<RawItem[]> {
  if (!sources.rss.enabled) return [];
  const out: RawItem[] = [];

  for (const feed of sources.rss.feeds) {
    try {
      const items = await fetchFeedItems(feed.url, userAgent);
      out.push(
        ...toRawItems(items, "rss", {
          categoryHint: feed.categoryHint,
          max: 30,
        }).map((item) => ({
          ...item,
          tags: [...(item.tags ?? []), feed.id],
        })),
      );
      console.log(`  [rss] ${feed.name}: ${items.length} items`);
    } catch (err) {
      console.warn(
        `  [rss] ${feed.name}:`,
        err instanceof Error ? err.message : err,
      );
    }
  }

  return out;
}
