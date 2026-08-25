import { fetchJson, sleep } from "../http.js";
import type { RawItem, SourcesConfig } from "../types.js";
import { fetchFeedItems, toRawItems } from "./feed.js";

interface RedditListing {
  data?: {
    children?: Array<{
      data?: {
        title?: string;
        url?: string;
        permalink?: string;
        selftext?: string;
        created_utc?: number;
        link_flair_text?: string;
        author?: string;
      };
    }>;
  };
}

function mapListing(data: RedditListing, sub: string): RawItem[] {
  const out: RawItem[] = [];
  for (const child of data.data?.children ?? []) {
    const d = child.data;
    if (!d?.title) continue;
    const permalink = d.permalink
      ? `https://www.reddit.com${d.permalink}`
      : d.url;
    if (!permalink) continue;
    out.push({
      title: d.title,
      url: permalink,
      source: "reddit",
      summary: d.selftext?.slice(0, 500) || undefined,
      publishedAt: d.created_utc
        ? new Date(d.created_utc * 1000).toISOString()
        : undefined,
      authors: d.author ? [d.author] : undefined,
      tags: [
        "reddit",
        `r/${sub}`,
        ...(d.link_flair_text ? [d.link_flair_text] : []),
      ],
      lang: "en",
    });
  }
  return out;
}

export async function collectReddit(
  sources: SourcesConfig,
  _userAgent: string,
): Promise<RawItem[]> {
  if (!sources.reddit.enabled) return [];
  const out: RawItem[] = [];
  const browserUa =
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";
  const cfg = sources.reddit as SourcesConfig["reddit"] & {
    searchQueries?: string[];
  };

  for (const sub of sources.reddit.subreddits) {
    let got = false;

    const jsonUrls = [
      `https://www.reddit.com/r/${encodeURIComponent(sub)}/new.json?limit=${sources.reddit.maxPerSub}&raw_json=1`,
      `https://old.reddit.com/r/${encodeURIComponent(sub)}/new.json?limit=${sources.reddit.maxPerSub}&raw_json=1`,
    ];

    for (const url of jsonUrls) {
      try {
        const data = await fetchJson<RedditListing>(url, browserUa);
        const items = mapListing(data, sub).slice(0, sources.reddit.maxPerSub);
        if (items.length) {
          out.push(...items);
          console.log(`  [reddit] r/${sub}: ${items.length} (json)`);
          got = true;
          break;
        }
      } catch {
        // try next
      }
    }

    if (!got) {
      const rssUrl = `https://www.reddit.com/r/${encodeURIComponent(sub)}/new/.rss`;
      try {
        const items = await fetchFeedItems(rssUrl, browserUa);
        out.push(
          ...toRawItems(items, "reddit", {
            max: sources.reddit.maxPerSub,
          }).map((item) => ({
            ...item,
            tags: [...(item.tags ?? []), "reddit", `r/${sub}`],
          })),
        );
        console.log(
          `  [reddit] r/${sub}: ${Math.min(items.length, sources.reddit.maxPerSub)} (rss)`,
        );
      } catch (err) {
        console.warn(
          `  [reddit] r/${sub}: blocked or failed (${err instanceof Error ? err.message : err})`,
        );
      }
    }

    await sleep(1500);
  }

  for (const q of cfg.searchQueries ?? []) {
    const query = q.trim();
    if (!query) continue;
    const url =
      `https://www.reddit.com/search.json?q=${encodeURIComponent(query)}` +
      `&sort=new&limit=${sources.reddit.maxPerSub}&raw_json=1`;
    try {
      const data = await fetchJson<RedditListing>(url, browserUa);
      const items = mapListing(data, "search")
        .map((item) => ({
          ...item,
          tags: [...(item.tags ?? []), "keyword", query.slice(0, 40)],
        }))
        .slice(0, sources.reddit.maxPerSub);
      out.push(...items);
      console.log(`  [reddit] search:${query.slice(0, 40)}: ${items.length}`);
    } catch (err) {
      console.warn(
        `  [reddit] search:${query}:`,
        err instanceof Error ? err.message : err,
      );
    }
    await sleep(1500);
  }

  return out;
}
