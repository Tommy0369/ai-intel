import { Agent, fetch as undiciFetch } from "undici";

/** HTTP/2 の中断で process が落ちるのを避けるため H1 固定 */
const agent = new Agent({
  allowH2: false,
  connections: 8,
  keepAliveTimeout: 10_000,
  keepAliveMaxTimeout: 30_000,
});

function isRetryableNetwork(err: unknown): boolean {
  const msg = err instanceof Error ? `${err.message} ${(err as { code?: string }).code ?? ""}` : String(err);
  return /UND_ERR_SOCKET|other side closed|ECONNRESET|EPIPE|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|fetch failed|network|socket/i.test(
    msg,
  );
}

export async function fetchResponse(
  url: string,
  userAgent: string,
  init?: RequestInit,
): Promise<Response> {
  const headers = {
    "User-Agent": userAgent,
    Accept:
      "application/rss+xml, application/atom+xml, application/xml, text/xml, application/json, text/html;q=0.9, */*;q=0.8",
    ...(init?.headers as Record<string, string> | undefined),
  };

  let lastErr: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await undiciFetch(url, {
        method: (init?.method as string) || "GET",
        headers,
        body: init?.body as string | undefined,
        redirect: (init?.redirect as "follow" | "manual" | "error") || "follow",
        signal: init?.signal ?? AbortSignal.timeout(45_000),
        dispatcher: agent,
      });
      return res as unknown as Response;
    } catch (err) {
      lastErr = err;
      if (isRetryableNetwork(err) && attempt < 2) {
        await sleep(700 * (attempt + 1));
        continue;
      }
      throw err instanceof Error ? err : new Error(String(err));
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

export async function fetchText(
  url: string,
  userAgent: string,
  init?: RequestInit,
): Promise<string> {
  const res = await fetchResponse(url, userAgent, init);
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} for ${url}`);
  }
  try {
    return await res.text();
  } catch (err) {
    if (isRetryableNetwork(err)) {
      // 本文読み込み中の切断 → 1回だけ取り直し
      const res2 = await fetchResponse(url, userAgent, init);
      if (!res2.ok) throw new Error(`HTTP ${res2.status} for ${url}`);
      return await res2.text();
    }
    throw err instanceof Error ? err : new Error(String(err));
  }
}

export async function fetchJson<T>(
  url: string,
  userAgent: string,
  init?: RequestInit,
): Promise<T> {
  const text = await fetchText(url, userAgent, {
    ...init,
    headers: {
      Accept: "application/json",
      ...(init?.headers as Record<string, string> | undefined),
    },
  });
  return JSON.parse(text) as T;
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function stripHtml(input: string): string {
  return input
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) =>
      String.fromCodePoint(parseInt(h, 16)),
    )
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/\s+/g, " ")
    .trim();
}

export function nowIso(): string {
  return new Date().toISOString();
}
