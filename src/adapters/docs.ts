import type { RawItem, SourcesConfig } from "../types.js";
import { fetchFeedItems, toRawItems } from "./feed.js";

export async function collectDocs(
  sources: SourcesConfig,
  userAgent: string,
): Promise<RawItem[]> {
  if (!sources.docs.enabled) return [];
  const out: RawItem[] = [];

  for (const feed of sources.docs.feeds) {
    try {
      const items = await fetchFeedItems(feed.url, userAgent);
      out.push(
        ...toRawItems(items, "docs", {
          categoryHint: feed.categoryHint ?? "industry",
          max: 25,
        }).map((item) => ({
          ...item,
          tags: [...(item.tags ?? []), feed.id, "docs"],
        })),
      );
      console.log(`  [docs] ${feed.name}: ${items.length}`);
    } catch (err) {
      console.warn(
        `  [docs] ${feed.name}:`,
        err instanceof Error ? err.message : err,
      );
    }
  }

  return out;
}
