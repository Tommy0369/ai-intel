import { parseHTML } from "linkedom";
import { Readability } from "@mozilla/readability";
import { fetchResponse, fetchText, sleep, stripHtml } from "./http.js";
import {
  canonicalizeUrl,
  isDeadEnrichHost,
  isGoogleNewsUrl,
} from "./enrich-canonicalize.js";
import { contentHashSha256 } from "./canonical/content-hash.js";
import { extractRelCanonical } from "./canonical/rel-canonical.js";
import { hostnameOf } from "./canonical/catalog-fields.js";
import { normalizeUrl } from "./dedup.js";

export type WebEnrichFailure =
  | "http_error"
  | "empty"
  | "js_shell"
  | "paywall"
  | "parse_error"
  | "redirect_loop"
  | "unresolved_news_url"
  | "feed_noise"
  | "timeout"
  | "dns_error"
  | "blocked"
  | "rate_limited"
  | "upstream_error"
  | "dead_host";

export interface WebEnrichResult {
  ok: boolean;
  discoveryUrl?: string;
  finalUrl: string;
  canonicalUrl?: string;
  canonicalDomain?: string;
  title?: string;
  text: string;
  chars: number;
  contentHash?: string;
  httpStatus?: number;
  strategy?: string;
  error?: WebEnrichFailure | string;
}

const MAX_BODY_CHARS = 24_000;
const MAX_REDIRECTS = 6;
const MIN_OK_CHARS = 400;
const MIN_PARTIAL_CHARS = 120;

const FEED_NOISE_RE =
  /^Article URL:\s*Comments URL:\s*Points:/i;

function classifyNetworkError(err: unknown): WebEnrichFailure {
  const msg = err instanceof Error ? `${err.message} ${(err as { code?: string }).code ?? ""}` : String(err);
  if (/HTTP 403/i.test(msg)) return "blocked";
  if (/HTTP 404/i.test(msg)) return "http_error";
  if (/HTTP 429/i.test(msg)) return "rate_limited";
  if (/HTTP 5\d\d/i.test(msg)) return "upstream_error";
  if (/timeout|TimeoutError|AbortError/i.test(msg)) return "timeout";
  if (/ENOTFOUND|EAI_AGAIN|dns/i.test(msg)) return "dns_error";
  if (/HTTP \d+/i.test(msg)) return "http_error";
  return "http_error";
}

function parseHttpStatus(err: unknown): number | undefined {
  const msg = err instanceof Error ? err.message : String(err);
  const m = msg.match(/HTTP (\d{3})/);
  return m ? Number(m[1]) : undefined;
}

/** Google News などの中間URLを最終記事URLへ辿る（非News用） */
export async function resolveFinalUrl(
  url: string,
  userAgent: string,
): Promise<string> {
  let current = url;
  for (let i = 0; i < MAX_REDIRECTS; i++) {
    const res = await fetchResponse(current, userAgent, {
      method: "GET",
      redirect: "manual",
      headers: {
        Accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.8",
      },
      signal: AbortSignal.timeout(30_000),
    });
    const loc = res.headers.get("location");
    if (
      loc &&
      (res.status === 301 ||
        res.status === 302 ||
        res.status === 303 ||
        res.status === 307 ||
        res.status === 308)
    ) {
      current = new URL(loc, current).href;
      if (isDeadEnrichHost(current) && !isGoogleNewsUrl(current)) {
        throw new Error("unresolved_news_url");
      }
      continue;
    }
    return current;
  }
  throw new Error("redirect_loop");
}

function looksLikePaywall(text: string, html: string): boolean {
  const hay = `${text}\n${html}`.toLowerCase();
  return (
    /subscribe to (continue|read)|会員登録|有料会員|ログインして続き|create an account to continue|remaining\s*\d+\s*article/i.test(
      hay,
    ) && text.length < 800
  );
}

function looksLikeJsShell(text: string, html: string): boolean {
  if (text.length >= 400) return false;
  return (
    /enable javascript|you need to enable javascript|__NEXT_DATA__|cf-browser-verification/i.test(
      html,
    ) && text.length < 200
  );
}

function fallbackExtract(html: string): { title: string; text: string } {
  const { document } = parseHTML(html);
  const title =
    document.querySelector("meta[property='og:title']")?.getAttribute("content") ||
    document.querySelector("title")?.textContent ||
    "";
  const article =
    document.querySelector("article") ||
    document.querySelector("main") ||
    document.querySelector("[role='main']") ||
    document.body;
  const raw = article?.innerHTML || html;
  const text = stripHtml(raw)
    .replace(/\s{2,}/g, " ")
    .trim();
  return { title: title.trim(), text };
}

function clipBody(text: string): string {
  const t = text.replace(/\n{3,}/g, "\n\n").trim();
  if (t.length <= MAX_BODY_CHARS) return t;
  return `${t.slice(0, MAX_BODY_CHARS - 1)}…`;
}

function ampCandidates(url: string): string[] {
  const out: string[] = [];
  try {
    const u = new URL(url);
    if (!u.pathname.includes("/amp")) {
      out.push(`${u.origin}${u.pathname.replace(/\/?$/, "/")}amp`);
      out.push(`${u.origin}/amp${u.pathname}`);
    }
    u.searchParams.set("output", "amp");
    out.push(u.href);
  } catch {
    // ignore
  }
  return out;
}

function withCanonicalMeta(
  result: WebEnrichResult,
  html: string,
  pageUrl: string,
  discoveryUrl: string,
): WebEnrichResult {
  const rel = extractRelCanonical(html, pageUrl);
  const canonicalUrl = normalizeUrl(rel || result.finalUrl || pageUrl);
  const out: WebEnrichResult = {
    ...result,
    discoveryUrl,
    finalUrl: result.finalUrl || pageUrl,
    canonicalUrl,
    canonicalDomain: hostnameOf(canonicalUrl),
  };
  if (out.text && out.chars >= MIN_PARTIAL_CHARS) {
    out.contentHash = contentHashSha256(out.text);
  }
  return out;
}

async function extractFromHtml(
  html: string,
  finalUrl: string,
): Promise<{ title: string; text: string }> {
  const { document } = parseHTML(html);
  Object.defineProperty(document, "documentURI", {
    value: finalUrl,
    configurable: true,
  });
  const reader = new Readability(document as unknown as Document);
  const article = reader.parse();
  let title = article?.title?.trim() || "";
  let text = (article?.textContent || "").replace(/\s+\n/g, "\n").trim();

  if (text.length < 280) {
    const fb = fallbackExtract(html);
    if (fb.text.length > text.length) {
      text = fb.text;
      title = title || fb.title;
    }
  }
  return { title, text: clipBody(text) };
}

async function fetchAndExtract(
  url: string,
  userAgent: string,
  discoveryUrl: string,
): Promise<WebEnrichResult> {
  let html = "";
  let httpStatus: number | undefined;
  try {
    const res = await fetchResponse(url, userAgent, {
      headers: {
        Accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.8",
      },
    });
    httpStatus = res.status;
    if (!res.ok) {
      const code =
        res.status === 403
          ? "blocked"
          : res.status === 429
            ? "rate_limited"
            : res.status >= 500
              ? "upstream_error"
              : "http_error";
      return {
        ok: false,
        discoveryUrl,
        finalUrl: url,
        text: "",
        chars: 0,
        httpStatus,
        error: code,
        strategy: "html",
      };
    }
    html = await res.text();
  } catch (err) {
    return {
      ok: false,
      discoveryUrl,
      finalUrl: url,
      text: "",
      chars: 0,
      httpStatus: parseHttpStatus(err),
      error: classifyNetworkError(err),
      strategy: "html",
    };
  }

  try {
    const { title, text } = await extractFromHtml(html, url);

    if (FEED_NOISE_RE.test(text) || FEED_NOISE_RE.test(title)) {
      return withCanonicalMeta(
        {
          ok: false,
          finalUrl: url,
          title,
          text: "",
          chars: 0,
          httpStatus,
          error: "feed_noise",
          strategy: "readability",
        },
        html,
        url,
        discoveryUrl,
      );
    }

    if (!text || text.length < MIN_PARTIAL_CHARS) {
      return withCanonicalMeta(
        {
          ok: false,
          finalUrl: url,
          title,
          text: "",
          chars: 0,
          httpStatus,
          error: looksLikeJsShell(text, html)
            ? "js_shell"
            : looksLikePaywall(text, html)
              ? "paywall"
              : "empty",
          strategy: "readability",
        },
        html,
        url,
        discoveryUrl,
      );
    }

    if (looksLikePaywall(text, html)) {
      return withCanonicalMeta(
        {
          ok: false,
          finalUrl: url,
          title,
          text,
          chars: text.length,
          httpStatus,
          error: "paywall",
          strategy: "readability",
        },
        html,
        url,
        discoveryUrl,
      );
    }

    if (text.length < MIN_OK_CHARS) {
      return withCanonicalMeta(
        {
          ok: false,
          finalUrl: url,
          title,
          text,
          chars: text.length,
          httpStatus,
          error: "empty",
          strategy: "readability",
        },
        html,
        url,
        discoveryUrl,
      );
    }

    return withCanonicalMeta(
      {
        ok: true,
        finalUrl: url,
        title,
        text,
        chars: text.length,
        httpStatus,
        strategy: "readability",
      },
      html,
      url,
      discoveryUrl,
    );
  } catch {
    return {
      ok: false,
      discoveryUrl,
      finalUrl: url,
      text: "",
      chars: 0,
      httpStatus,
      error: "parse_error",
      strategy: "readability",
    };
  }
}

/**
 * URLの向こう側の記事本文を取得（動画ファイルは取らない）。
 * 戦略: Google News解決 → redirect → HTML/readability → AMP
 */
export async function enrichWebArticle(
  url: string,
  userAgent: string,
  opts?: { fetchUrl?: string },
): Promise<WebEnrichResult> {
  const discoveryUrl = url;
  let working = opts?.fetchUrl || url;
  let strategyBits: string[] = [];

  // 1) Google News 専用解決
  if (isGoogleNewsUrl(working)) {
    const canon = await canonicalizeUrl(working, userAgent);
    if (canon.via === "unresolved-news") {
      return {
        ok: false,
        discoveryUrl,
        finalUrl: working,
        text: "",
        chars: 0,
        error: "unresolved_news_url",
        strategy: "google-news",
      };
    }
    working = canon.url;
    strategyBits.push("google-news");
  }

  // 2) 通常リダイレクト
  if (!isGoogleNewsUrl(working)) {
    try {
      const redirected = await resolveFinalUrl(working, userAgent);
      if (redirected !== working) strategyBits.push("redirect");
      working = redirected;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        ok: false,
        discoveryUrl,
        finalUrl: working,
        text: "",
        chars: 0,
        error:
          msg === "redirect_loop"
            ? "redirect_loop"
            : msg === "unresolved_news_url"
              ? "unresolved_news_url"
              : classifyNetworkError(err),
        strategy: strategyBits.join("+") || "redirect",
      };
    }
  }

  if (isDeadEnrichHost(working) || isGoogleNewsUrl(working)) {
    return {
      ok: false,
      discoveryUrl,
      finalUrl: working,
      text: "",
      chars: 0,
      error: isGoogleNewsUrl(working) ? "unresolved_news_url" : "dead_host",
      strategy: strategyBits.join("+") || "dead-host",
    };
  }

  await sleep(200);

  // 3) 本HTML
  const primary = await fetchAndExtract(working, userAgent, discoveryUrl);
  const baseStrategy = [...strategyBits, primary.strategy || "html"].join("+");
  if (primary.ok) {
    return { ...primary, strategy: baseStrategy };
  }

  if (primary.text && primary.error === "paywall") {
    return { ...primary, strategy: `${baseStrategy}+paywall` };
  }

  // 4) AMP ladder
  for (const amp of ampCandidates(working)) {
    await sleep(150);
    const ampRes = await fetchAndExtract(amp, userAgent, discoveryUrl);
    if (ampRes.ok) {
      return {
        ...ampRes,
        strategy: [...strategyBits, "amp"].join("+"),
      };
    }
    if (ampRes.text && ampRes.chars > (primary.text?.length ?? 0)) {
      return {
        ...ampRes,
        strategy: [...strategyBits, "amp-partial"].join("+"),
      };
    }
  }

  return { ...primary, strategy: primary.strategy || baseStrategy || "html" };
}
