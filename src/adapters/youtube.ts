import type { RawItem, SourcesConfig } from "../types.js";
import { fetchFeedItems, toRawItems } from "./feed.js";

/** YouTube: title + URL only (no transcript / no video). */
export async function collectYoutube(
  sources: SourcesConfig,
  userAgent: string,
): Promise<RawItem[]> {
  if (!sources.youtube.enabled) return [];
  const out: RawItem[] = [];
  const max = sources.youtube.maxPerFeed;

  for (const ch of sources.youtube.channels) {
    const url = `https://www.youtube.com/feeds/videos.xml?channel_id=${encodeURIComponent(ch.id)}`;
    try {
      const items = await fetchFeedItems(url, userAgent);
      out.push(
        ...toRawItems(items, "youtube", {
          max,
          forceEmptySummary: true,
        }).map((item) => ({
          ...item,
          summary: undefined,
          tags: [...(item.tags ?? []), "youtube", ch.name],
        })),
      );
      console.log(`  [youtube] ${ch.name}: ${Math.min(items.length, max)} items`);
    } catch (err) {
      console.warn(
        `  [youtube] ${ch.name}:`,
        err instanceof Error ? err.message : err,
      );
    }
  }

  for (const feed of sources.youtube.searchFeeds) {
    const url =
      `https://www.youtube.com/feeds/videos.xml?search_query=${encodeURIComponent(feed.query)}`;
    // Note: search_query feed is unofficial; channel feeds are primary.
    // Keep as best-effort; failures are non-fatal.
    try {
      const items = await fetchFeedItems(url, userAgent);
      out.push(
        ...toRawItems(items, "youtube", {
          categoryHint: feed.categoryHint,
          max,
          forceEmptySummary: true,
        }).map((item) => ({
          ...item,
          summary: undefined,
          tags: [...(item.tags ?? []), "youtube", feed.id],
        })),
      );
      console.log(`  [youtube] search:${feed.query}: ${Math.min(items.length, max)}`);
    } catch (err) {
      console.warn(
        `  [youtube] search:${feed.query}:`,
        err instanceof Error ? err.message : err,
      );
    }
  }

  return out;
}
