import type { RawItem, SourcesConfig } from "../types.js";
import { fetchFeedItems, toRawItems } from "./feed.js";

/**
 * X/Twitter via public Nitter RSS (best-effort).
 * Instances go down often — failures are non-fatal.
 */
export async function collectX(
  sources: SourcesConfig,
  userAgent: string,
): Promise<RawItem[]> {
  if (!sources.x.enabled) return [];
  const out: RawItem[] = [];
  const instances = sources.x.nitterInstances;

  for (const account of sources.x.accounts) {
    let collected = false;
    for (const base of instances) {
      const url = `${base.replace(/\/$/, "")}/${account.handle}/rss`;
      try {
        const items = await fetchFeedItems(url, userAgent);
        out.push(
          ...toRawItems(items, "x", {
            categoryHint: account.categoryHint,
            max: sources.x.maxPerAccount,
          }).map((item) => ({
            ...item,
            // Prefer title + URL; keep short summary if present
            summary: item.summary?.slice(0, 280),
            tags: [...(item.tags ?? []), "x", account.handle],
          })),
        );
        console.log(
          `  [x] @${account.handle} via ${base}: ${Math.min(items.length, sources.x.maxPerAccount)}`,
        );
        collected = true;
        break;
      } catch {
        // try next instance
      }
    }
    if (!collected) {
      console.warn(`  [x] @${account.handle}: all nitter instances failed`);
    }
  }

  return out;
}
