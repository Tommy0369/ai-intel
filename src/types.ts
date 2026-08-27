export type Category =
  | "llms"
  | "agents"
  | "tools"
  | "research"
  | "industry"
  | "opensource"
  | "multimodal"
  | "safety"
  /** 先読みトレンド・新商品・市場信号（SNS発信向き） */
  | "trends"
  /** 心理・行動経済・NLP・人間の心 */
  | "mind"
  /** 運動・健康・トレーニング・食事・睡眠 */
  | "body"
  /** 飲食ビジネス・外食・店舗運営 */
  | "dining"
  /** 経営・マーケ・集客・起業・個人事業（飲食以外の事業全般） */
  | "biz"
  /** システマティックレビュー / メタアナリシス / レビュー論文 */
  | "reviews"
  | "other";

export type SourceKind =
  | "arxiv"
  | "rss"
  | "github"
  | "youtube"
  | "reddit"
  | "docs"
  | "x"
  | "europepmc";

export interface RawItem {
  title: string;
  url: string;
  source: SourceKind;
  summary?: string;
  publishedAt?: string;
  authors?: string[];
  tags?: string[];
  lang?: string;
  categoryHint?: Category;
  extra?: Record<string, unknown>;
}

export interface IntelItem {
  id: string;
  title: string;
  url: string;
  source: SourceKind;
  category: Category;
  collectedAt: string;
  publishedAt?: string;
  tags: string[];
  lang: string;
  summary: string;
  authors: string[];
  relativePath: string;
}

export type FetchStatus =
  | "not_attempted"
  | "success"
  | "partial"
  | "failed"
  | "paywall"
  | "js_shell"
  | "unresolved"
  | "dead_source";

export type FetchErrorCode =
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
  | "source_skipped"
  | "dead_host";

export interface CatalogEntry {
  id: string;
  title: string;
  /** 一眼でわかる日本語タイトル（表示用） */
  title_ja?: string;
  /** 既存互換フィールド（置換しない） */
  url: string;
  source: SourceKind;
  category: Category;
  collected_at: string;
  published_at?: string;
  tags: string[];
  lang: string;
  path: string;
  /** 最初に発見したURL（例: Google News） */
  discovery_url?: string;
  /** 本文取得・Notebookに使う最終URL */
  canonical_url?: string;
  canonical_domain?: string;
  /** 本文正規化後の SHA-256（本文取得成功時） */
  content_hash?: string;
  fetch_status?: FetchStatus;
  http_status?: number;
  resolved_at?: string;
  fetch_strategy?: string;
  fetch_error?: string;
  event_id?: string;
}

export interface AppConfig {
  dataRoot: string;
  intervalMinutes: number;
  minFreeGb: number;
  userAgent: string;
  /** iCloud上の受け渡しルート（AI共有OS intel-bridge） */
  icloudBridgeRoot?: string;
  /**
   * NotebookLM 用 Google Drive ローカル同期ルート
   * 例: ~/Library/CloudStorage/GoogleDrive-…/My Drive/NotebookLM
   */
  googleDriveNotebookRoot?: string;
  /**
   * rclone リモート（設定時は staging → rclone sync）
   * 例: gdrive:NotebookLM
   */
  googleDriveRcloneRemote?: string;
  dailyHour?: number;
  /** 収集後、出荷前に置く精査期間（時間） */
  vetReviewHours?: number;
  /** 重複ウォッチ期間（時間）。期間中は隔離せず HOLDING */
  dupWatchHours?: number;
  /** notebook: 同じ話題とみなすコサイン類似のしきい値（0〜1、既定0.42） */
  clusterSimilarity?: number;
  /** notebook: 採用する最小メンバー数（既定2） */
  clusterMinSize?: number;
  /** notebook: 出力する話題グループ数の上限（既定60） */
  clusterMaxGroups?: number;
  /** notebook: 1クラスタの上限件数。超えたら再分割（既定10） */
  clusterMaxSize?: number;
  /** intelligence priorityScore の重み（未指定なら既定） */
  scoringWeights?: Partial<ScoringWeights>;
}

export interface ScoringWeights {
  authority: number;
  evidence: number;
  freshness: number;
  novelty: number;
  velocity: number;
  diversity: number;
  relevance: number;
  actionability: number;
  opportunity: number;
}

export interface SourcesConfig {
  arxiv: {
    enabled: boolean;
    categories: string[];
    maxPerCategory: number;
    /** キーワード検索（レビュー系など） */
    keywordQueries?: string[];
  };
  europePmc?: {
    enabled: boolean;
    maxPerQuery: number;
    queries: Array<{
      id: string;
      query: string;
      categoryHint?: Category;
      tags?: string[];
    }>;
  };
  rss: {
    enabled: boolean;
    feeds: Array<{
      id: string;
      name: string;
      url: string;
      categoryHint?: Category;
    }>;
  };
  github: {
    enabled: boolean;
    queries: string[];
    maxPerQuery: number;
  };
  youtube: {
    enabled: boolean;
    channels: Array<{ id: string; name: string }>;
    searchFeeds: Array<{
      id: string;
      query: string;
      categoryHint?: Category;
    }>;
    maxPerFeed: number;
  };
  reddit: {
    enabled: boolean;
    subreddits: string[];
    maxPerSub: number;
  };
  docs: {
    enabled: boolean;
    feeds: Array<{
      id: string;
      name: string;
      url: string;
      categoryHint?: Category;
    }>;
  };
  x: {
    enabled: boolean;
    nitterInstances: string[];
    accounts: Array<{ handle: string; categoryHint?: Category }>;
    maxPerAccount: number;
  };
}

export const CATEGORIES: Category[] = [
  "llms",
  "agents",
  "tools",
  "research",
  "industry",
  "opensource",
  "multimodal",
  "safety",
  "trends",
  "mind",
  "body",
  "dining",
  "biz",
  "reviews",
  "other",
];

export const SOURCES: SourceKind[] = [
  "arxiv",
  "rss",
  "github",
  "youtube",
  "reddit",
  "docs",
  "x",
  "europepmc",
];
