import { fetchResponse, fetchText } from "./http.js";
import type { CatalogEntry } from "./types.js";

const BROWSER_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

const BATCH_EXECUTE =
  "https://news.google.com/_/DotsSplashUi/data/batchexecute";

/** Google / gstatic など本文が取れない着地先 */
export function isDeadEnrichHost(url: string): boolean {
  try {
    const h = new URL(url).hostname.toLowerCase();
    return (
      h === "news.google.com" ||
      h.endsWith(".gstatic.com") ||
      h === "gstatic.com" ||
      h === "www.google.com" ||
      h === "google.com"
    );
  } catch {
    return true;
  }
}

export function isGoogleNewsUrl(url: string): boolean {
  return /news\.google\.com\/(rss\/)?articles\//i.test(url);
}

export function googleNewsArticleId(url: string): string | null {
  const m = url.match(/\/articles\/([A-Za-z0-9_-]+)/);
  return m?.[1] ?? null;
}

/** 見出し正規化（クラスタ内 dedupe 用） */
export function normalizeTitleKey(title: string): string {
  return title
    .toLowerCase()
    .replace(/【[^】]*】/g, "")
    .replace(/https?:\/\/\S+/g, "")
    .replace(/[^a-z0-9\u3040-\u30ff\u4e00-\u9fff]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
}

/**
 * Google News 記事URL → 出版社URL（batchexecute）。
 * 失敗時は null。
 */
export async function resolveGoogleNewsUrl(
  url: string,
  userAgent?: string,
): Promise<string | null> {
  const articleId = googleNewsArticleId(url);
  if (!articleId) return null;
  const ua = userAgent || BROWSER_UA;

  const pageUrls = [
    `https://news.google.com/articles/${articleId}`,
    `https://news.google.com/rss/articles/${articleId}`,
  ];

  let signature = "";
  let timestamp = "";
  for (const pageUrl of pageUrls) {
    try {
      const html = await fetchText(pageUrl, ua, {
        headers: {
          Accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.8",
        },
        signal: AbortSignal.timeout(25_000),
      });
      signature = html.match(/data-n-a-sg="([^"]+)"/)?.[1] ?? "";
      timestamp = html.match(/data-n-a-ts="([^"]+)"/)?.[1] ?? "";
      if (signature && timestamp) break;
    } catch {
      // try next
    }
  }
  if (!signature || !timestamp || !/^\d+$/.test(timestamp)) return null;

  const rpcInner = JSON.stringify([
    "garturlreq",
    [
      [
        "X",
        "X",
        ["X", "X"],
        null,
        null,
        1,
        1,
        "US:en",
        null,
        1,
        null,
        null,
        null,
        null,
        null,
        0,
        1,
      ],
      "X",
      "X",
      1,
      [1, 1, 1],
      1,
      1,
      null,
      0,
      0,
      null,
      0,
    ],
    articleId,
    Number(timestamp),
    signature,
  ]);
  const fReq = JSON.stringify([[["Fbv4je", rpcInner, null, "generic"]]]);

  try {
    const post = await fetchResponse(BATCH_EXECUTE, ua, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
        Referer: "https://news.google.com/",
      },
      body: new URLSearchParams({ "f.req": fReq }).toString(),
      signal: AbortSignal.timeout(25_000),
    });
    if (!post.ok) return null;
    let text = await post.text();
    if (text.startsWith(")]}'")) {
      text = text.split("\n").slice(1).join("\n");
    }
    text = text.trimStart();
    const firstLine = text.split("\n", 1)[0] ?? "";
    if (/^\d+$/.test(firstLine.trim())) {
      text = text.slice(firstLine.length).trimStart();
    }
    const jsonLine = text.split("\n").find((l) => l.trim().startsWith("[")) ?? text;
    const envelopes = JSON.parse(jsonLine) as unknown[];
    for (const env of envelopes) {
      if (
        Array.isArray(env) &&
        env[0] === "wrb.fr" &&
        env[1] === "Fbv4je" &&
        typeof env[2] === "string"
      ) {
        const payload = JSON.parse(env[2]) as unknown[];
        if (
          Array.isArray(payload) &&
          payload[0] === "garturlres" &&
          typeof payload[1] === "string" &&
          /^https?:\/\//i.test(payload[1])
        ) {
          return payload[1];
        }
      }
    }
  } catch {
    return null;
  }
  return null;
}

/** 取得用の正規化URL（Google News なら解決、ダメなら元URL） */
export async function canonicalizeUrl(
  url: string,
  userAgent?: string,
): Promise<{ url: string; via: "direct" | "google-news" | "unresolved-news" }> {
  if (!isGoogleNewsUrl(url)) {
    return { url, via: "direct" };
  }
  const resolved = await resolveGoogleNewsUrl(url, userAgent);
  if (resolved && !isDeadEnrichHost(resolved)) {
    return { url: resolved, via: "google-news" };
  }
  return { url, via: "unresolved-news" };
}

function urlScore(url: string): number {
  if (isGoogleNewsUrl(url) || isDeadEnrichHost(url)) return 0;
  if (/apnews\.com|reuters\.com|bbc\.|nytimes\.|theverge\.|techcrunch\./i.test(url))
    return 30;
  if (/doi\.org|arxiv\.org|pubmed|nature\.com|sciencedirect/i.test(url)) return 28;
  return 20;
}

export interface CanonicalMember {
  /** enrich の代表エントリ（本文取得対象） */
  entry: CatalogEntry;
  /** 取得に使う正規化URL */
  fetchUrl: string;
  /** 同一記事とみなした他メンバー */
  aliases: CatalogEntry[];
  titleKey: string;
}

/**
 * クラスタ内を見出しで潰し、直リンク優先の代表だけ残す。
 * Google News 解決はここではせず（代表選定後に1回だけ）。
 */
export function selectUniqueMembers(entries: CatalogEntry[]): CanonicalMember[] {
  const groups = new Map<string, CatalogEntry[]>();
  for (const e of entries) {
    const key = normalizeTitleKey(e.title_ja || e.title) || e.id;
    const list = groups.get(key) ?? [];
    list.push(e);
    groups.set(key, list);
  }

  const out: CanonicalMember[] = [];
  for (const [titleKey, group] of groups) {
    const ranked = [...group].sort((a, b) => {
      const ds = urlScore(b.url) - urlScore(a.url);
      if (ds !== 0) return ds;
      return a.id.localeCompare(b.id);
    });
    const entry = ranked[0];
    out.push({
      entry,
      fetchUrl: entry.url,
      aliases: ranked.slice(1),
      titleKey,
    });
  }
  return out;
}
