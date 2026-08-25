import { parseHTML } from "linkedom";
import { Readability } from "@mozilla/readability";
import { fetchResponse, fetchText, sleep, stripHtml } from "./http.js";
import {
  canonicalizeUrl,
  isDeadEnrichHost,
  isGoogleNewsUrl,
} from "./enrich-canonicalize.js";

export type WebEnrichFailure =
  | "http_error"
  | "empty"
  | "js_shell"
  | "paywall"
  | "parse_error"
  | "redirect_loop"
  | "unresolved_news_url"
  | "feed_noise";

export interface WebEnrichResult {
  ok: boolean;
  finalUrl: string;
  title?: string;
  text: string;
  chars: number;
  error?: WebEnrichFailure | string;
  strategy?: string;
}

const MAX_BODY_CHARS = 24_000;
const MAX_REDIRECTS = 6;
const MIN_OK_CHARS = 400;
const MIN_PARTIAL_CHARS = 120;

const FEED_NOISE_RE =
  /^Article URL:\s*Comments URL:\s*Points:/i;

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
): Promise<WebEnrichResult> {
  let html = "";
  try {
    html = await fetchText(url, userAgent, {
      headers: {
        Accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.8",
      },
    });
  } catch (err) {
    return {
      ok: false,
      finalUrl: url,
      text: "",
      chars: 0,
      error:
        err instanceof Error && /HTTP \d+/.test(err.message)
          ? "http_error"
          : String(err instanceof Error ? err.message : err),
    };
  }

  try {
    const { title, text } = await extractFromHtml(html, url);

    if (FEED_NOISE_RE.test(text) || FEED_NOISE_RE.test(title)) {
      return {
        ok: false,
        finalUrl: url,
        title,
        text: "",
        chars: 0,
        error: "feed_noise",
      };
    }

    if (!text || text.length < MIN_PARTIAL_CHARS) {
      return {
        ok: false,
        finalUrl: url,
        title,
        text: "",
        chars: 0,
        error: looksLikeJsShell(text, html)
          ? "js_shell"
          : looksLikePaywall(text, html)
            ? "paywall"
            : "empty",
      };
    }

    if (looksLikePaywall(text, html)) {
      return {
        ok: false,
        finalUrl: url,
        title,
        text,
        chars: text.length,
        error: "paywall",
      };
    }

    if (text.length < MIN_OK_CHARS) {
      return {
        ok: false,
        finalUrl: url,
        title,
        text,
        chars: text.length,
        error: "empty",
      };
    }

    return {
      ok: true,
      finalUrl: url,
      title,
      text,
      chars: text.length,
    };
  } catch {
    return {
      ok: false,
      finalUrl: url,
      text: "",
      chars: 0,
      error: "parse_error",
    };
  }
}

/**
 * URLの向こう側の記事本文を取得（動画ファイルは取らない）。
 * 戦略: Google News解決 → HTML → AMP 候補
 */
export async function enrichWebArticle(
  url: string,
  userAgent: string,
  opts?: { fetchUrl?: string },
): Promise<WebEnrichResult> {
  let working = opts?.fetchUrl || url;

  // 1) Google News 専用解決
  if (isGoogleNewsUrl(working)) {
    const canon = await canonicalizeUrl(working, userAgent);
    if (canon.via === "unresolved-news") {
      return {
        ok: false,
        finalUrl: working,
        text: "",
        chars: 0,
        error: "unresolved_news_url",
        strategy: "google-news",
      };
    }
    working = canon.url;
  }

  // 2) 通常リダイレクト
  if (!isGoogleNewsUrl(working)) {
    try {
      working = await resolveFinalUrl(working, userAgent);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        ok: false,
        finalUrl: working,
        text: "",
        chars: 0,
        error:
          msg === "redirect_loop"
            ? "redirect_loop"
            : msg === "unresolved_news_url"
              ? "unresolved_news_url"
              : "http_error",
      };
    }
  }

  if (isDeadEnrichHost(working) || isGoogleNewsUrl(working)) {
    return {
      ok: false,
      finalUrl: working,
      text: "",
      chars: 0,
      error: "unresolved_news_url",
      strategy: "dead-host",
    };
  }

  await sleep(200);

  // 3) 本HTML
  const primary = await fetchAndExtract(working, userAgent);
  if (primary.ok) {
    return { ...primary, strategy: "html" };
  }

  // 短い partial（paywallで本文あり）はそのまま返す
  if (primary.text && primary.error === "paywall") {
    return { ...primary, strategy: "html-paywall" };
  }

  // 4) AMP ladder
  for (const amp of ampCandidates(working)) {
    await sleep(150);
    const ampRes = await fetchAndExtract(amp, userAgent);
    if (ampRes.ok) {
      return { ...ampRes, strategy: "amp" };
    }
    if (ampRes.text && ampRes.chars > (primary.text?.length ?? 0)) {
      return { ...ampRes, strategy: "amp-partial" };
    }
  }

  return { ...primary, strategy: primary.strategy || "html" };
}
