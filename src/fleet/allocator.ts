import type { Category, SourcesConfig } from "../types.js";
import {
  BURST_WEIGHTS,
  DEFAULT_BURST_MISSIONS,
  DEFAULT_PATROL_MISSIONS,
  emptySourcesSkeleton,
  missionId,
  PATROL_WEIGHTS,
  scaleMax,
  type FleetProfile,
  type Mission,
  type ShipKind,
} from "./types.js";

function slug(s: string): string {
  return (
    s
      .trim()
      .toLowerCase()
      .replace(/\s+/g, "-")
      .replace(/[^\w\u3040-\u30ff\u4e00-\u9fff-]+/g, "")
      .slice(0, 36) || "kw"
  );
}

/** キーワード変種（人数をかける = 任務を増やす） */
export function expandKeywordVariants(keywords: string[]): string[] {
  const base = keywords.map((k) => k.trim()).filter(Boolean);
  if (!base.length) return [];
  const joined = base.join(" ");
  const first = base[0];
  const variants = new Set<string>([joined, first]);

  // 英語寄りの補助フレーズ
  const extras = [
    `${joined} review`,
    `${joined} analysis`,
    `${joined} tutorial`,
    `${joined} explained`,
    `"${first}"`,
  ];
  for (const e of extras) variants.add(e);

  if (base.length > 1) {
    variants.add(base.slice(0, 2).join(" "));
  }

  // 日本語キーワード向けの軽い展開
  if (/[\u3040-\u30ff\u4e00-\u9fff]/.test(joined)) {
    variants.add(`${joined} 解説`);
    variants.add(`${joined} まとめ`);
  }

  return [...variants].slice(0, 40);
}

function googleWhen(from?: string, to?: string): string {
  if (!from) return " when:7d";
  return " when:1m";
}

function takeBudget(
  weights: Record<ShipKind, number>,
  maxMissions: number,
): Record<ShipKind, number> {
  const out = {} as Record<ShipKind, number>;
  let used = 0;
  const kinds = Object.keys(weights) as ShipKind[];
  for (const k of kinds) {
    const n = Math.max(1, Math.floor(maxMissions * weights[k]));
    out[k] = n;
    used += n;
  }
  // 余りは youtube / rss へ
  let rest = maxMissions - used;
  if (rest > 0) {
    out.youtube += Math.ceil(rest / 2);
    out.rss += Math.floor(rest / 2);
  }
  return out;
}

/** 常駐パトロール: 船種ごとに1任務（設定を枠でスケール） */
export function allocatePatrol(
  base: SourcesConfig,
  maxMissions = DEFAULT_PATROL_MISSIONS,
): Mission[] {
  const budget = takeBudget(PATROL_WEIGHTS, Math.min(maxMissions, 200));
  const missions: Mission[] = [];

  // arxiv
  {
    const s = emptySourcesSkeleton(base);
    s.arxiv = {
      enabled: base.arxiv.enabled,
      categories: [...base.arxiv.categories],
      maxPerCategory: scaleMax(base.arxiv.maxPerCategory, PATROL_WEIGHTS.arxiv),
      keywordQueries: base.arxiv.keywordQueries,
    };
    missions.push({
      id: missionId("arxiv", "patrol-arxiv"),
      ship: "arxiv",
      label: "patrol:arxiv",
      sources: s,
      priority: 40,
      profile: "patrol",
    });
  }

  // rss — feeds をチャンク分割して複数任務に（枠に応じて）
  if (base.rss.enabled && base.rss.feeds.length) {
    const chunks = Math.min(budget.rss, Math.max(1, Math.ceil(base.rss.feeds.length / 8)));
    const size = Math.ceil(base.rss.feeds.length / chunks);
    for (let i = 0; i < chunks; i++) {
      const feeds = base.rss.feeds.slice(i * size, (i + 1) * size);
      if (!feeds.length) continue;
      const s = emptySourcesSkeleton(base);
      s.rss = { enabled: true, feeds };
      missions.push({
        id: missionId("rss", `patrol-rss-${i}`, String(feeds.length)),
        ship: "rss",
        label: `patrol:rss#${i + 1}(${feeds.length})`,
        sources: s,
        priority: 50,
        profile: "patrol",
      });
    }
  }

  // youtube
  if (base.youtube.enabled) {
    const s = emptySourcesSkeleton(base);
    s.youtube = {
      enabled: true,
      channels: [...base.youtube.channels],
      searchFeeds: [...(base.youtube.searchFeeds ?? [])],
      maxPerFeed: scaleMax(base.youtube.maxPerFeed, PATROL_WEIGHTS.youtube),
    };
    missions.push({
      id: missionId("youtube", "patrol-youtube"),
      ship: "youtube",
      label: "patrol:youtube",
      sources: s,
      priority: 55,
      profile: "patrol",
    });
  }

  // github
  if (base.github.enabled) {
    const s = emptySourcesSkeleton(base);
    s.github = {
      enabled: true,
      queries: [...base.github.queries],
      maxPerQuery: scaleMax(base.github.maxPerQuery, PATROL_WEIGHTS.github),
    };
    missions.push({
      id: missionId("github", "patrol-github"),
      ship: "github",
      label: "patrol:github",
      sources: s,
      priority: 30,
      profile: "patrol",
    });
  }

  // reddit
  if (base.reddit.enabled) {
    const s = emptySourcesSkeleton(base);
    s.reddit = {
      enabled: true,
      subreddits: [...base.reddit.subreddits],
      maxPerSub: scaleMax(base.reddit.maxPerSub, PATROL_WEIGHTS.reddit),
    };
    missions.push({
      id: missionId("reddit", "patrol-reddit"),
      ship: "reddit",
      label: "patrol:reddit",
      sources: s,
      priority: 20,
      profile: "patrol",
    });
  }

  // docs
  if (base.docs.enabled) {
    const s = emptySourcesSkeleton(base);
    s.docs = { enabled: true, feeds: [...base.docs.feeds] };
    missions.push({
      id: missionId("docs", "patrol-docs"),
      ship: "docs",
      label: "patrol:docs",
      sources: s,
      priority: 15,
      profile: "patrol",
    });
  }

  // x
  if (base.x.enabled) {
    const s = emptySourcesSkeleton(base);
    s.x = {
      enabled: true,
      nitterInstances: [...base.x.nitterInstances],
      accounts: [...base.x.accounts],
      maxPerAccount: scaleMax(base.x.maxPerAccount, PATROL_WEIGHTS.x, 2),
    };
    missions.push({
      id: missionId("x", "patrol-x"),
      ship: "x",
      label: "patrol:x",
      sources: s,
      priority: 10,
      profile: "patrol",
    });
  }

  // europepmc
  if (base.europePmc?.enabled && base.europePmc.queries.length) {
    const q = base.europePmc.queries;
    const chunks = Math.min(
      budget.europepmc,
      Math.max(1, Math.ceil(q.length / 2)),
    );
    const size = Math.ceil(q.length / chunks);
    for (let i = 0; i < chunks; i++) {
      const queries = q.slice(i * size, (i + 1) * size);
      if (!queries.length) continue;
      const s = emptySourcesSkeleton(base);
      s.europePmc = {
        enabled: true,
        maxPerQuery: scaleMax(
          base.europePmc.maxPerQuery,
          PATROL_WEIGHTS.europepmc,
          5,
        ),
        queries,
      };
      missions.push({
        id: missionId("europepmc", `patrol-epmc-${i}`),
        ship: "europepmc",
        label: `patrol:europepmc#${i + 1}`,
        sources: s,
        priority: 45,
        profile: "patrol",
      });
    }
  }

  return missions
    .sort((a, b) => b.priority - a.priority)
    .slice(0, Math.max(1, maxMissions));
}

/** キーワードバースト: 変種×ソースで任務を増やす（最大1000） */
export function allocateBurst(
  base: SourcesConfig,
  keywords: string[],
  opts: { from?: string; to?: string; maxMissions?: number },
): Mission[] {
  const maxMissions = opts.maxMissions ?? DEFAULT_BURST_MISSIONS;
  const variants = expandKeywordVariants(keywords);
  const when = googleWhen(opts.from, opts.to);
  const missions: Mission[] = [];
  const budget = takeBudget(BURST_WEIGHTS, maxMissions);

  let ytLeft = budget.youtube;
  let rssLeft = budget.rss;
  let axLeft = budget.arxiv;
  let epLeft = budget.europepmc;
  let ghLeft = budget.github;
  let rdLeft = budget.reddit;

  for (const q of variants) {
    const idb = slug(q);

    if (ytLeft > 0) {
      const s = emptySourcesSkeleton(base);
      s.youtube = {
        enabled: true,
        channels: [],
        searchFeeds: [
          { id: `kw-yt-${idb}`, query: q, categoryHint: "trends" as Category },
        ],
        maxPerFeed: 20,
      };
      missions.push({
        id: missionId("youtube", q, "burst"),
        ship: "youtube",
        label: `burst:yt:${q.slice(0, 40)}`,
        sources: s,
        priority: 90,
        profile: "burst",
      });
      ytLeft--;
    }

    if (rssLeft > 0) {
      const s = emptySourcesSkeleton(base);
      s.rss = {
        enabled: true,
        feeds: [
          {
            id: `gnews-en-${idb}`,
            name: `GNews EN ${q}`,
            url:
              `https://news.google.com/rss/search?q=${encodeURIComponent(q + when)}` +
              `&hl=en-US&gl=US&ceid=US:en`,
            categoryHint: "trends",
          },
        ],
      };
      missions.push({
        id: missionId("rss", `en:${q}`, "burst"),
        ship: "rss",
        label: `burst:news-en:${q.slice(0, 36)}`,
        sources: s,
        priority: 85,
        profile: "burst",
      });
      rssLeft--;
    }

    if (rssLeft > 0) {
      const s = emptySourcesSkeleton(base);
      s.rss = {
        enabled: true,
        feeds: [
          {
            id: `gnews-ja-${idb}`,
            name: `GNews JA ${q}`,
            url:
              `https://news.google.com/rss/search?q=${encodeURIComponent(q + when)}` +
              `&hl=ja&gl=JP&ceid=JP:ja`,
            categoryHint: "trends",
          },
        ],
      };
      missions.push({
        id: missionId("rss", `ja:${q}`, "burst"),
        ship: "rss",
        label: `burst:news-ja:${q.slice(0, 36)}`,
        sources: s,
        priority: 84,
        profile: "burst",
      });
      rssLeft--;
    }

    if (axLeft > 0) {
      const s = emptySourcesSkeleton(base);
      s.arxiv = {
        enabled: true,
        categories: [],
        maxPerCategory: 25,
        keywordQueries: [q.includes(" ") ? `"${q}"` : q],
      };
      missions.push({
        id: missionId("arxiv", q, "burst"),
        ship: "arxiv",
        label: `burst:arxiv:${q.slice(0, 40)}`,
        sources: s,
        priority: 70,
        profile: "burst",
      });
      axLeft--;
    }

    if (epLeft > 0) {
      const s = emptySourcesSkeleton(base);
      s.europePmc = {
        enabled: true,
        maxPerQuery: 12,
        queries: [
          {
            id: `kw-epmc-${idb}`,
            query: `(TITLE:"${q.replace(/"/g, "")}" OR ABSTRACT:"${q.replace(/"/g, "")}") AND FIRST_PDATE:[2023-01-01 TO 3000-12-31]`,
            categoryHint: "reviews",
            tags: ["keyword-hunt", "genre:mixed"],
          },
        ],
      };
      missions.push({
        id: missionId("europepmc", q, "burst"),
        ship: "europepmc",
        label: `burst:epmc:${q.slice(0, 40)}`,
        sources: s,
        priority: 75,
        profile: "burst",
      });
      epLeft--;
    }

    if (ghLeft > 0) {
      const pushed =
        opts.from && /^\d{4}-\d{2}-\d{2}$/.test(opts.from)
          ? ` pushed:>${opts.from}`
          : "";
      const s = emptySourcesSkeleton(base);
      s.github = {
        enabled: true,
        queries: [`${q}${pushed}`],
        maxPerQuery: 20,
      };
      missions.push({
        id: missionId("github", q, "burst"),
        ship: "github",
        label: `burst:gh:${q.slice(0, 40)}`,
        sources: s,
        priority: 60,
        profile: "burst",
      });
      ghLeft--;
    }

    if (rdLeft > 0) {
      const s = emptySourcesSkeleton(base);
      s.reddit = {
        enabled: true,
        subreddits: [],
        maxPerSub: 15,
        searchQueries: [q],
      } as SourcesConfig["reddit"] & { searchQueries?: string[] };
      missions.push({
        id: missionId("reddit", q, "burst"),
        ship: "reddit",
        label: `burst:reddit:${q.slice(0, 40)}`,
        sources: s,
        priority: 50,
        profile: "burst",
      });
      rdLeft--;
    }

    if (missions.length >= maxMissions) break;
  }

  return missions
    .sort((a, b) => b.priority - a.priority)
    .slice(0, maxMissions);
}

export function allocateMissions(
  base: SourcesConfig,
  profile: FleetProfile,
  opts: {
    keywords?: string[];
    from?: string;
    to?: string;
    maxMissions?: number;
    /** false のときバーストにパトロール任務も足す */
    keywordOnly?: boolean;
  },
): Mission[] {
  const max = opts.maxMissions ??
    (profile === "burst" ? DEFAULT_BURST_MISSIONS : DEFAULT_PATROL_MISSIONS);

  if (profile === "burst" && (opts.keywords?.length ?? 0) > 0) {
    const burst = allocateBurst(base, opts.keywords!, {
      from: opts.from,
      to: opts.to,
      maxMissions: max,
    });
    if (opts.keywordOnly === false) {
      const patrol = allocatePatrol(base, Math.min(80, Math.floor(max / 4)));
      const seen = new Set(burst.map((m) => m.id));
      const merged = [...burst];
      for (const m of patrol) {
        if (seen.has(m.id)) continue;
        merged.push(m);
        if (merged.length >= max) break;
      }
      return merged.slice(0, max);
    }
    return burst;
  }
  return allocatePatrol(base, max);
}
