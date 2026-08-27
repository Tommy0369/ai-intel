import path from "node:path";
import type { FeedbackRecord } from "../v2-types.js";
import { appendJsonl, readJson, readJsonl, writeJson } from "../store-jsonl.js";

/** 安定 action id（emoji は表示用のみ） */
export const FEEDBACK_ACTIONS = [
  "important",
  "business",
  "sns",
  "video",
  "learning",
  "try",
  "dining",
  "psychology_nlp",
  "like",
  "dislike",
  "save",
  "ignore",
  "used",
  "posted",
] as const;

export type FeedbackAction = (typeof FEEDBACK_ACTIONS)[number];

export const FEEDBACK_LABELS = [
  "🔥 重要",
  "💰 ビジネス化",
  "📱 SNS化",
  "🎥 動画化",
  "📚 教材化",
  "🧪 試したい",
  "🍖 飲食転用",
  "🧠 心理/NLP",
  "❤️ 好き",
  "❌ 興味なし",
] as const;

const LABEL_TO_ACTION: Record<string, FeedbackAction> = {
  "🔥 重要": "important",
  "💰 ビジネス化": "business",
  "📱 SNS化": "sns",
  "🎥 動画化": "video",
  "📚 教材化": "learning",
  "🧪 試したい": "try",
  "🍖 飲食転用": "dining",
  "🧠 心理/NLP": "psychology_nlp",
  "❤️ 好き": "like",
  "❌ 興味なし": "dislike",
  important: "important",
  business: "business",
  sns: "sns",
  video: "video",
  learning: "learning",
  try: "try",
  dining: "dining",
  psychology_nlp: "psychology_nlp",
  like: "like",
  dislike: "dislike",
  save: "save",
  ignore: "ignore",
  used: "used",
  posted: "posted",
};

export function normalizeFeedbackAction(raw: string): FeedbackAction | null {
  return LABEL_TO_ACTION[raw] ?? (FEEDBACK_ACTIONS.includes(raw as FeedbackAction) ? (raw as FeedbackAction) : null);
}

export interface PreferenceState {
  schema: string;
  schema_version: string;
  updated_at: string;
  action_counts: Record<string, number>;
  recommended_weight_deltas: Record<string, number>;
  reasons: string[];
}

export async function recordFeedback(
  dataRoot: string,
  rec: FeedbackRecord,
): Promise<void> {
  await appendJsonl(path.join(dataRoot, "feedback", "feedback.jsonl"), rec);
}

export async function loadFeedback(dataRoot: string): Promise<FeedbackRecord[]> {
  return readJsonl<FeedbackRecord>(path.join(dataRoot, "feedback", "feedback.jsonl"));
}

/** Feedback から推奨 weight 差分を作る（自動適用しない） */
export async function learnPreferences(dataRoot: string): Promise<PreferenceState> {
  const rows = await loadFeedback(dataRoot);
  const action_counts: Record<string, number> = {};
  for (const r of rows) {
    for (const label of r.labels) {
      const action = normalizeFeedbackAction(label) || label;
      action_counts[action] = (action_counts[action] ?? 0) + 1;
    }
  }
  const recommended_weight_deltas: Record<string, number> = {};
  const reasons: string[] = [];
  const bump = (key: string, delta: number, reason: string) => {
    recommended_weight_deltas[key] = (recommended_weight_deltas[key] ?? 0) + delta;
    reasons.push(reason);
  };
  if ((action_counts.sns ?? 0) + (action_counts.video ?? 0) >= 3) {
    bump("novelty", 0.02, "SNS/動画採用が多い → novelty 上げ候補");
  }
  if ((action_counts.business ?? 0) + (action_counts.dining ?? 0) >= 3) {
    bump("opportunity", 0.03, "ビジネス/飲食採用が多い → opportunity 上げ候補");
  }
  if ((action_counts.important ?? 0) >= 3) {
    bump("relevance", 0.02, "重要マークが多い → relevance 上げ候補");
  }
  if ((action_counts.dislike ?? 0) + (action_counts.ignore ?? 0) >= 5) {
    bump("velocity", -0.01, "却下が多い → velocity 下げ候補");
  }
  const state: PreferenceState = {
    schema: "ai-intel.preferences.v1",
    schema_version: "2026.08-step10",
    updated_at: new Date().toISOString(),
    action_counts,
    recommended_weight_deltas,
    reasons,
  };
  await writeJson(path.join(dataRoot, "preferences", "state.json"), state);
  return state;
}

export async function loadPreferences(
  dataRoot: string,
): Promise<PreferenceState | null> {
  return readJson<PreferenceState | null>(
    path.join(dataRoot, "preferences", "state.json"),
    null,
  );
}

export interface ContentPerformance {
  content_id: string;
  platform: string;
  posted_at?: string;
  views?: number;
  likes?: number;
  comments?: number;
  shares?: number;
  saves?: number;
  clicks?: number;
  followers_gained?: number;
  revenue?: number;
  measured_at: string;
}

export async function recordPerformance(
  dataRoot: string,
  row: ContentPerformance,
): Promise<void> {
  await appendJsonl(path.join(dataRoot, "performance", "performance.jsonl"), row);
}
