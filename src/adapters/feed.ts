import { XMLParser } from "fast-xml-parser";
import { fetchText, stripHtml } from "../http.js";
import type { Category, RawItem, SourceKind } from "../types.js";

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  textNodeName: "#text",
  isArray: (name) =>
    ["entry", "item", "category", "author", "link"].includes(name),
});

function asArray<T>(value: T | T[] | undefined | null): T[] {
  if (value == null) return [];
  return Array.isArray(value) ? value : [value];
}

function linkHref(link: unknown): string | undefined {
  for (const l of asArray(link)) {
    if (typeof l === "string" && l.startsWith("http")) return l;
    if (l && typeof l === "object") {
      const obj = l as Record<string, unknown>;
      if (typeof obj["@_href"] === "string") {
        const rel = obj["@_rel"];
        if (!rel || rel === "alternate" || rel === "self") {
          return obj["@_href"] as string;
        }
      }
      if (typeof obj["#text"] === "string" && obj["#text"].startsWith("http")) {
        return obj["#text"] as string;
      }
    }
  }
  // second pass: any href
  for (const l of asArray(link)) {
    if (l && typeof l === "object") {
      const href = (l as Record<string, unknown>)["@_href"];
      if (typeof href === "string") return href;
    }
  }
  return undefined;
}

function textOf(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number") return String(value);
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    if (typeof obj["#text"] === "string") return obj["#text"];
    if (typeof obj["@_term"] === "string") return obj["@_term"];
  }
  return "";
}

export interface ParsedFeedItem {
  title: string;
  url: string;
  summary?: string;
  publishedAt?: string;
  authors?: string[];
  tags?: string[];
}

export function parseFeedXml(xml: string): ParsedFeedItem[] {
  const doc = parser.parse(xml);
  const items: ParsedFeedItem[] = [];

  const atomEntries = asArray(doc?.feed?.entry);
  for (const entry of atomEntries) {
    const title = stripHtml(textOf(entry.title));
    const url =
      linkHref(entry.link) ||
      textOf(entry.id) ||
      textOf(entry["id"]);
    if (!title || !url || !url.startsWith("http")) continue;
    const summary = stripHtml(
      textOf(entry.summary) || textOf(entry.content) || "",
    );
    const publishedAt =
      textOf(entry.published) ||
      textOf(entry.updated) ||
      undefined;
    const authors = asArray(entry.author)
      .map((a) => stripHtml(textOf((a as { name?: unknown }).name) || textOf(a)))
      .filter(Boolean);
    const tags = asArray(entry.category)
      .map((c) => textOf(c))
      .filter(Boolean);
    items.push({
      title,
      url,
      summary: summary || undefined,
      publishedAt: publishedAt || undefined,
      authors: authors.length ? authors : undefined,
      tags: tags.length ? tags : undefined,
    });
  }

  const channel = doc?.rss?.channel ?? doc?.channel;
  const rssItems = asArray(channel?.item);
  for (const entry of rssItems) {
    const title = stripHtml(textOf(entry.title));
    const url =
      textOf(entry.link) ||
      linkHref(entry.link) ||
      textOf(entry.guid);
    if (!title || !url || !String(url).startsWith("http")) continue;
    const summary = stripHtml(
      textOf(entry.description) ||
        textOf(entry["content:encoded"]) ||
        "",
    );
    const publishedAt = textOf(entry.pubDate) || textOf(entry.published) || undefined;
    const authors = [textOf(entry.author), textOf(entry["dc:creator"])]
      .map(stripHtml)
      .filter(Boolean);
    const tags = asArray(entry.category)
      .map((c) => stripHtml(textOf(c)))
      .filter(Boolean);
    items.push({
      title,
      url: String(url),
      summary: summary || undefined,
      publishedAt: publishedAt || undefined,
      authors: authors.length ? authors : undefined,
      tags: tags.length ? tags : undefined,
    });
  }

  return items;
}

export async function fetchFeedItems(
  url: string,
  userAgent: string,
): Promise<ParsedFeedItem[]> {
  const xml = await fetchText(url, userAgent);
  return parseFeedXml(xml);
}

export function toRawItems(
  items: ParsedFeedItem[],
  source: SourceKind,
  opts?: { categoryHint?: Category; max?: number; forceEmptySummary?: boolean },
): RawItem[] {
  const sliced = opts?.max != null ? items.slice(0, opts.max) : items;
  return sliced.map((item) => ({
    title: item.title,
    url: item.url,
    source,
    summary: opts?.forceEmptySummary ? undefined : item.summary,
    publishedAt: item.publishedAt,
    authors: item.authors,
    tags: item.tags,
    categoryHint: opts?.categoryHint,
    lang: "en",
  }));
}
