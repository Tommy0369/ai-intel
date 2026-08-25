import { YoutubeTranscript } from "youtube-transcript";
import { fetchText, sleep } from "./http.js";

export interface TranscriptResult {
  ok: boolean;
  videoId?: string;
  lang?: string;
  text: string;
  chars: number;
  error?: string;
}

const MAX_TRANSCRIPT_CHARS = 20_000;
const LANG_PREF = ["ja", "en", "en-US", "en-GB"];

export function extractYoutubeId(url: string): string | null {
  try {
    const u = new URL(url);
    if (u.hostname.includes("youtu.be")) {
      const id = u.pathname.replace(/^\//, "").slice(0, 11);
      return id.length === 11 ? id : null;
    }
    if (u.hostname.includes("youtube.com")) {
      const v = u.searchParams.get("v");
      if (v && v.length >= 11) return v.slice(0, 11);
      const m = u.pathname.match(/\/(?:shorts|embed|live)\/([a-zA-Z0-9_-]{11})/);
      if (m) return m[1];
    }
  } catch {
    // ignore
  }
  return null;
}

function clipTranscript(text: string): string {
  const t = text.replace(/\n{3,}/g, "\n\n").trim();
  if (t.length <= MAX_TRANSCRIPT_CHARS) return t;
  return `${t.slice(0, MAX_TRANSCRIPT_CHARS - 1)}…`;
}

function linesToText(
  lines: Array<{ text: string }>,
): string {
  const out: string[] = [];
  let prev = "";
  for (const line of lines) {
    const t = (line.text || "").replace(/\s+/g, " ").trim();
    if (!t || t === prev) continue;
    out.push(t);
    prev = t;
  }
  return clipTranscript(out.join("\n"));
}

/** youtube-transcript パッケージで取得（優先） */
async function fetchViaPackage(videoId: string): Promise<TranscriptResult> {
  const errors: string[] = [];
  for (const lang of [...LANG_PREF, undefined]) {
    try {
      const rows = lang
        ? await YoutubeTranscript.fetchTranscript(videoId, { lang })
        : await YoutubeTranscript.fetchTranscript(videoId);
      const text = linesToText(rows);
      if (text.length >= 40) {
        return {
          ok: true,
          videoId,
          lang: lang || rows[0]?.lang || "auto",
          text,
          chars: text.length,
        };
      }
      errors.push(`${lang || "auto"}:empty`);
    } catch (err) {
      errors.push(
        `${lang || "auto"}:${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
  return {
    ok: false,
    videoId,
    text: "",
    chars: 0,
    error: errors.slice(0, 4).join(" | ") || "no_captions",
  };
}

function decodeXmlEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) =>
      String.fromCodePoint(parseInt(h, 16)),
    )
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)));
}

export function captionsToText(raw: string): string {
  const lines: string[] = [];
  if (raw.includes("<text")) {
    const re = /<text[^>]*>([\s\S]*?)<\/text>/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(raw))) {
      const t = decodeXmlEntities(m[1].replace(/<[^>]+>/g, "")).trim();
      if (t) lines.push(t);
    }
  } else {
    try {
      const j = JSON.parse(raw) as {
        events?: Array<{ segs?: Array<{ utf8?: string }> }>;
      };
      for (const ev of j.events ?? []) {
        const t = (ev.segs ?? [])
          .map((s) => s.utf8 ?? "")
          .join("")
          .trim();
        if (t && t !== "\n") lines.push(t);
      }
    } catch {
      return clipTranscript(raw);
    }
  }
  return clipTranscript(lines.join("\n"));
}

/** フォールバック: watch HTML の captionTracks（しばしば空応答になる） */
async function fetchViaWatchHtml(
  videoId: string,
  userAgent: string,
): Promise<TranscriptResult> {
  const html = await fetchText(
    `https://www.youtube.com/watch?v=${videoId}`,
    userAgent,
    {
      headers: {
        Accept: "text/html",
        "Accept-Language": "ja,en;q=0.8",
      },
    },
  );
  const idx = html.indexOf('"captionTracks":');
  if (idx < 0) {
    return { ok: false, videoId, text: "", chars: 0, error: "no_captions" };
  }
  const start = html.indexOf("[", idx);
  let depth = 0;
  let end = -1;
  for (let i = start; i < html.length; i++) {
    if (html[i] === "[") depth++;
    else if (html[i] === "]") {
      depth--;
      if (depth === 0) {
        end = i;
        break;
      }
    }
  }
  if (end < 0) {
    return { ok: false, videoId, text: "", chars: 0, error: "no_captions" };
  }
  const tracks = JSON.parse(html.slice(start, end + 1)) as Array<{
    baseUrl: string;
    languageCode: string;
    kind?: string;
  }>;
  if (!tracks.length) {
    return { ok: false, videoId, text: "", chars: 0, error: "no_captions" };
  }
  let track = tracks[0];
  for (const pref of LANG_PREF) {
    const hit = tracks.find((t) =>
      t.languageCode.toLowerCase().startsWith(pref.toLowerCase()),
    );
    if (hit) {
      track = hit;
      break;
    }
  }
  let captionUrl = track.baseUrl;
  if (!/[?&]fmt=/.test(captionUrl)) {
    captionUrl += (captionUrl.includes("?") ? "&" : "?") + "fmt=json3";
  }
  const raw = await fetchText(captionUrl, userAgent, {
    headers: {
      Accept: "*/*",
      Referer: `https://www.youtube.com/watch?v=${videoId}`,
      Origin: "https://www.youtube.com",
    },
  });
  const text = captionsToText(raw);
  if (text.length < 40) {
    return {
      ok: false,
      videoId,
      lang: track.languageCode,
      text: "",
      chars: 0,
      error: "empty_captions",
    };
  }
  return {
    ok: true,
    videoId,
    lang: track.languageCode,
    text,
    chars: text.length,
  };
}

/** YouTube の公式/自動字幕をテキストで取得（動画本体は保存しない） */
export async function enrichYoutubeTranscript(
  url: string,
  userAgent: string,
): Promise<TranscriptResult> {
  const videoId = extractYoutubeId(url);
  if (!videoId) {
    return { ok: false, text: "", chars: 0, error: "not_youtube" };
  }

  await sleep(200);

  const primary = await fetchViaPackage(videoId);
  if (primary.ok) return primary;

  try {
    const fallback = await fetchViaWatchHtml(videoId, userAgent);
    if (fallback.ok) return fallback;
    return {
      ok: false,
      videoId,
      text: "",
      chars: 0,
      error: primary.error || fallback.error || "no_captions",
    };
  } catch {
    return primary;
  }
}
