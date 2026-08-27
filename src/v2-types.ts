import type { Category, ScoringWeights } from "./types.js";

export type EventStatus = "emerging" | "active" | "mature" | "declining";
export type TrendStatus = "emerging" | "rising" | "hot" | "stable" | "declining";

export type AuthorityTier =
  | "official"
  | "docs"
  | "company-blog"
  | "primary-source"
  | "major-press"
  | "specialty"
  | "general-news"
  | "sns"
  | "forum";

export type EvidenceTier =
  | "meta-analysis"
  | "systematic-review"
  | "rct"
  | "peer-reviewed"
  | "observational"
  | "preprint"
  | "technical-report"
  | "official-announcement"
  | "news"
  | "expert-opinion"
  | "sns-opinion";

export interface IntelEvent {
  id: string;
  title: string;
  titleJa?: string;
  category: Category;
  categories: Category[];
  firstSeenAt: string;
  lastSeenAt: string;
  entities: string[];
  products: string[];
  models: string[];
  companies: string[];
  keywords: string[];
  articles: string[];
  /** Step 02: 代表記事 */
  representativeArticleId?: string;
  canonicalUrls?: string[];
  confidence?: number;
  sourceCount: number;
  sourceTypes: string[];
  sourceDomains: string[];
  authorityScore: number;
  evidenceScore: number;
  freshnessScore: number;
  noveltyScore: number;
  velocityScore: number;
  relevanceScore: number;
  impactScore: number;
  opportunityScore: number;
  sourceDiversityScore: number;
  strategicRelevanceScore: number;
  actionabilityScore: number;
  tommyRelevanceScore: number;
  priorityScore: number;
  status: EventStatus;
  trendStatus?: TrendStatus;
  mentions_1h: number;
  mentions_6h: number;
  mentions_24h: number;
  mentions_3d: number;
  mentions_7d: number;
  velocity: number;
  acceleration: number;
  createdAt: string;
  updatedAt: string;
}

export interface CrossInsight {
  id: string;
  eventIds: string[];
  /** Knowledge Core への provenance（任意・後方互換） */
  conceptIds?: string[];
  claimIds?: string[];
  categories: Category[];
  title: string;
  relationship:
    | "application"
    | "analogy"
    | "opportunity"
    | "contradiction"
    | "trend"
    | "combination";
  description: string;
  opportunityScore: number;
  relevanceScore?: number;
  originalityScore?: number;
  confidence?: number;
  createdAt?: string;
}

export interface ContentAngle {
  id: string;
  label: string;
  perspective: string;
  hook: string;
}

export interface ContentIdea {
  id: string;
  sourceEventIds: string[];
  sourceClaimIds?: string[];
  sourceConceptIds?: string[];
  sourceCrossInsightIds?: string[];
  title: string;
  coreFact: string;
  insight: string;
  whyItMatters: string;
  targetAudience: string[];
  categories: string[];
  angles: ContentAngle[];
  tommyRelevanceScore: number;
  viralPotentialScore: number;
  educationalValueScore: number;
  businessValueScore: number;
  originalityScore: number;
  contentPriorityScore: number;
  createdAt: string;
}

export interface ContentCard {
  id: string;
  ideaId: string;
  hook: string;
  problem?: string;
  fact: string;
  insight: string;
  example?: string;
  action?: string;
  conclusion?: string;
  cta?: string;
  sources: string[];
  /** Event / idea provenance */
  sourceIds?: string[];
  factKind?: "fact" | "interpretation" | "prediction" | "opinion";
  confidence: number;
  tags: string[];
}

export interface PlatformPack {
  ideaId: string;
  cardId: string;
  xShort: string;
  xLong: string;
  threads: string;
  facebook: string;
  instagramCaption: string;
  instagramCarousel: string[];
  tiktokScript: string;
  shortsScript: string;
  youtubeOutline: string;
  noteArticle: string;
  blogOutline: string;
  newsletter: string;
  seminarOutline: string;
}

export interface FeedbackRecord {
  at: string;
  targetType: "event" | "idea" | "card";
  targetId: string;
  labels: string[];
  state?: "used" | "saved" | "ignored" | "posted";
  metrics?: Record<string, number>;
}

export interface SourceHealthRow {
  sourceId: string;
  kind: string;
  lastSuccessAt?: string;
  lastFailureAt?: string;
  lastItemAt?: string;
  successRate: number;
  consecutiveFailures: number;
  avgItems: number;
  httpStatus?: number;
  status: "healthy" | "warning" | "dead";
}

export const DEFAULT_SCORING_WEIGHTS: ScoringWeights = {
  authority: 0.15,
  evidence: 0.1,
  freshness: 0.1,
  novelty: 0.15,
  velocity: 0.1,
  diversity: 0.1,
  relevance: 0.15,
  actionability: 0.1,
  opportunity: 0.05,
};

export interface TodayBrief {
  generatedAt: string;
  important: IntelEvent[];
  rising: IntelEvent[];
  tommy: IntelEvent[];
  business: IntelEvent[];
  snsIdeas: ContentIdea[];
}
