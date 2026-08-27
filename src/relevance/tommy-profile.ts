import type { CatalogEntry } from "../types.js";
import type { IntelEvent } from "../v2-types.js";

export const TOMMY_FOCUS = [
  "AI",
  "AI Agent",
  "automation",
  "business",
  "marketing",
  "sales",
  "NLP",
  "psychology",
  "coaching",
  "dining",
  "restaurant",
  "health",
  "SNS",
  "content",
  "経営",
  "集客",
  "飲食",
  "心理",
  "運動",
];

const WEIGHT: Record<string, number> = {
  agents: 18,
  llms: 14,
  biz: 18,
  dining: 16,
  mind: 14,
  body: 10,
  trends: 12,
  tools: 10,
  industry: 8,
  research: 6,
};

const HAY =
  /agent|automat|claude|chatgpt|llm|nlp|psych|habit|restaur|dining|market|sales|coach|sns|content|集客|飲食|経営|心理|自動化/i;

export function scoreTommyRelevance(entry: CatalogEntry): number {
  let n = WEIGHT[entry.category] ?? 4;
  if (HAY.test(entry.title)) n += 22;
  if ((entry.tags ?? []).some((t) => /kw:|keyword-hunt|agent/i.test(t))) n += 8;
  return Math.max(0, Math.min(100, n));
}

export function scoreEventTommy(ev: IntelEvent): number {
  let n = WEIGHT[ev.category] ?? 4;
  if (ev.categories.some((c) => ["biz", "dining", "agents", "mind"].includes(c))) {
    n += 10;
  }
  const hay = `${ev.title} ${ev.keywords.join(" ")} ${ev.entities.join(" ")}`;
  if (HAY.test(hay)) n += 20;
  return Math.max(0, Math.min(100, Math.round(n)));
}
