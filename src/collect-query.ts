import type { Category, RawItem, SourcesConfig } from "./types.js";

/**
 * キーワード駆動収集のオプション。
 * keywords があるときは、キーワード向けソースを合成して集める。
 * from/to は公開日（なければ収集判定ではスキップせず通す／オプションで厳格化可）。
 */
export interface CollectOptions {
  /** スペース区切り可。複数キーワードは AND 気味にクエリへ渡す */
  keywords?: string[];
  /** YYYY-MM-DD（含む） */
  from?: string;
  /** YYYY-MM-DD（含む） */
  to?: string;
  /**
   * true: キーワード用ソースだけ回す（既定: keywords があるとき true）
   * false: 既存 sources.json にキーワード用を追加してフル収集
   */
  keywordOnly?: boolean;
  /** patrol=常駐船隊 / burst=キーワード集中（既定: キーワードあり→burst） */
  profile?: "patrol" | "burst";
  /** キーワード時のバースト（既定: keywords ありで true） */
  burst?: boolean;
  /** 任務数上限（burst 既定 1000 / patrol 既定 200） */
  maxMissions?: number;
  /** 同時実行船数（burst 既定 24 / patrol 既定 8） */
  concurrency?: number;
}

export function parseDateBound(isoDate?: string, endOfDay = false): number | null {
  if (!isoDate) return null;
  const m = isoDate.trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (!y || mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  if (endOfDay) {
    return Date.UTC(y, mo - 1, d, 23, 59, 59, 999);
  }
  return Date.UTC(y, mo - 1, d, 0, 0, 0, 0);
}

export function parsePublishedMs(raw?: string): number | null {
  if (!raw?.trim()) return null;
  const t = Date.parse(raw);
  return Number.isFinite(t) ? t : null;
}

/** 期間外なら true（ドロップ対象）。publishedAt が無い場合は通す */
export function isOutsideDateRange(
  publishedAt: string | undefined,
  fromMs: number | null,
  toMs: number | null,
): boolean {
  if (fromMs == null && toMs == null) return false;
  const pub = parsePublishedMs(publishedAt);
  if (pub == null) return false;
  if (fromMs != null && pub < fromMs) return true;
  if (toMs != null && pub > toMs) return true;
  return false;
}

function slugKeyword(kw: string): string {
  return kw
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^\w\u3040-\u30ff\u4e00-\u9fff-]+/g, "")
    .slice(0, 40) || "kw";
}

function joinQuery(keywords: string[]): string {
  return keywords.map((k) => k.trim()).filter(Boolean).join(" ");
}

/** Google News の when: ヒント（from/to からざっくり） */
function googleWhenHint(from?: string, to?: string): string {
  const fromMs = parseDateBound(from, false);
  const toMs = parseDateBound(to, true) ?? Date.now();
  if (fromMs == null) return "";
  const days = Math.max(1, Math.ceil((toMs - fromMs) / 86_400_000));
  if (days <= 1) return " when:1d";
  if (days <= 7) return " when:7d";
  if (days <= 30) return " when:1m";
  if (days <= 365) return " when:1y";
  return "";
}

/**
 * キーワード向けに SourcesConfig を合成する。
 * 既存 sources.json は破壊しない（コピーを返す）。
 */
export function buildKeywordSources(
  base: SourcesConfig,
  opts: CollectOptions,
): SourcesConfig {
  const keywords = (opts.keywords ?? []).map((k) => k.trim()).filter(Boolean);
  if (!keywords.length) return base;

  const q = joinQuery(keywords);
  const idBase = slugKeyword(keywords[0] ?? "kw");
  const only = opts.keywordOnly ?? true;
  const when = googleWhenHint(opts.from, opts.to);
  const pushed =
    opts.from && /^\d{4}-\d{2}-\d{2}$/.test(opts.from)
      ? ` pushed:>${opts.from}`
      : "";

  const emptyFeeds = {
    enabled: true as const,
    feeds: [] as SourcesConfig["rss"]["feeds"],
  };

  const burst = opts.burst !== false;
  const scale = burst ? 2.5 : 1;

  const next: SourcesConfig = only
    ? {
        arxiv: {
          enabled: true,
          categories: [],
          maxPerCategory: Math.max(
            base.arxiv.maxPerCategory,
            Math.round(20 * scale),
          ),
        },
        europePmc: {
          enabled: true,
          maxPerQuery: Math.max(base.europePmc?.maxPerQuery ?? 8, Math.round(12 * scale)),
          queries: [],
        },
        rss: { ...emptyFeeds },
        github: {
          enabled: true,
          queries: [],
          maxPerQuery: Math.max(
            base.github.maxPerQuery,
            Math.round(15 * scale),
          ),
        },
        youtube: {
          enabled: true,
          channels: [],
          searchFeeds: [],
          maxPerFeed: Math.max(
            base.youtube.maxPerFeed,
            Math.round(20 * scale),
          ),
        },
        reddit: {
          enabled: false,
          subreddits: [],
          maxPerSub: Math.max(base.reddit.maxPerSub, Math.round(15 * scale)),
        },
        docs: { enabled: false, feeds: [] },
        x: {
          enabled: false,
          nitterInstances: base.x.nitterInstances,
          accounts: [],
          maxPerAccount: base.x.maxPerAccount,
        },
      }
    : structuredClone(base);

  // 変種クエリ（原文 / 補助フレーズ）
  const variants = new Set<string>([q]);
  if (burst) {
    variants.add(`${q} review`);
    variants.add(`${q} analysis`);
    if (/[\u3040-\u30ff\u4e00-\u9fff]/.test(q)) {
      variants.add(`${q} 解説`);
      variants.add(`${q} まとめ`);
    }
  }
  const queries = [...variants].slice(0, burst ? 8 : 1);

  // YouTube 検索
  next.youtube.enabled = true;
  next.youtube.maxPerFeed = Math.max(
    next.youtube.maxPerFeed,
    Math.round(20 * scale),
  );
  next.youtube.searchFeeds = [
    ...(only ? [] : next.youtube.searchFeeds),
    ...queries.map((query, i) => ({
      id: `kw-${idBase}${i ? `-${i}` : ""}`,
      query,
      categoryHint: "trends" as Category,
    })),
  ];

  // GitHub
  next.github.enabled = true;
  next.github.maxPerQuery = Math.max(
    next.github.maxPerQuery,
    Math.round(15 * scale),
  );
  next.github.queries = [
    ...(only ? [] : next.github.queries),
    ...queries.map((query) => `${query}${pushed}`),
  ];

  // Google News EN / JA（変種ごと）
  next.rss.enabled = true;
  const newsFeeds: SourcesConfig["rss"]["feeds"] = [];
  for (const [i, query] of queries.entries()) {
    const sid = i ? `-${i}` : "";
    newsFeeds.push(
      {
        id: `gnews-en-${idBase}${sid}`,
        name: `Google News EN: ${query}`,
        url:
          `https://news.google.com/rss/search?q=${encodeURIComponent(query + when)}` +
          `&hl=en-US&gl=US&ceid=US:en`,
        categoryHint: "trends",
      },
      {
        id: `gnews-ja-${idBase}${sid}`,
        name: `Google News JA: ${query}`,
        url:
          `https://news.google.com/rss/search?q=${encodeURIComponent(query + when)}` +
          `&hl=ja&gl=JP&ceid=JP:ja`,
        categoryHint: "trends",
      },
    );
  }
  next.rss.feeds = [...(only ? [] : next.rss.feeds), ...newsFeeds];

  // arXiv 自由語
  next.arxiv.enabled = true;
  next.arxiv.maxPerCategory = Math.max(
    next.arxiv.maxPerCategory,
    Math.round(25 * scale),
  );
  next.arxiv.keywordQueries = queries.map((query) =>
    query.includes(" ") ? `"${query}"` : query,
  );

  // Europe PMC（研究・レビュー系もキーワードで取る）
  next.europePmc = {
    enabled: true,
    maxPerQuery: Math.max(
      next.europePmc?.maxPerQuery ?? 8,
      Math.round(12 * scale),
    ),
    queries: [
      ...(only ? [] : next.europePmc?.queries ?? []),
      ...queries.map((query, i) => ({
        id: `kw-epmc-${idBase}${i ? `-${i}` : ""}`,
        query: `(TITLE:"${query.replace(/"/g, "")}" OR ABSTRACT:"${query.replace(/"/g, "")}") AND FIRST_PDATE:[2023-01-01 TO 3000-12-31]`,
        categoryHint: "reviews" as Category,
        tags: ["keyword-hunt", "genre:mixed"],
      })),
    ],
  };

  // Reddit 検索用（アダプタ拡張）
  next.reddit.enabled = true;
  next.reddit.maxPerSub = Math.max(
    next.reddit.maxPerSub,
    Math.round(15 * scale),
  );
  (next.reddit as SourcesConfig["reddit"] & { searchQueries?: string[] }).searchQueries =
    queries;

  return next;
}

/** タイトル／要約にキーワードが1つも含まれないものを落とす（補助フィルタ） */
export function matchesKeywords(item: RawItem, keywords: string[]): boolean {
  if (!keywords.length) return true;
  const hay = `${item.title} ${item.summary ?? ""} ${item.tags?.join(" ") ?? ""}`.toLowerCase();
  // すべて含む必要はなく、いずれかヒットでOK（日本語・英語混在向け）
  return keywords.some((k) => {
    const t = k.trim().toLowerCase();
    return t.length > 0 && hay.includes(t);
  });
}
