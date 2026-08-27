export interface ScoreReason {
  dimension: string;
  delta?: number;
  reason: string;
}

export function explainPriority(parts: Record<string, number>): ScoreReason[] {
  const reasons: ScoreReason[] = [];
  const add = (dimension: string, value: number, reason: string) => {
    if (value >= 70) reasons.push({ dimension, delta: value, reason });
  };
  add("authority", parts.authority ?? 0, "信頼できるソース");
  add("evidence", parts.evidence ?? 0, "根拠の強い情報");
  add("freshness", parts.freshness ?? 0, "鮮度が高い");
  add("novelty", parts.novelty ?? 0, "新規性");
  add("relevance", parts.relevance ?? 0, "とみー向けテーマ");
  add("actionability", parts.actionability ?? 0, "実務に使える");
  add("business", parts.business ?? parts.opportunity ?? 0, "事業機会");
  if (reasons.length === 0) {
    reasons.push({ dimension: "baseline", reason: "標準的な優先度" });
  }
  return reasons.slice(0, 6);
}
