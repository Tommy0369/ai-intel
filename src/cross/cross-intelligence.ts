import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Category } from "../types.js";
import type { CrossInsight, IntelEvent } from "../v2-types.js";
import { writeJson, writeJsonl } from "../store-jsonl.js";
import { loadKnowledge } from "../knowledge/knowledge-store.js";
import type { KnowledgeClaim, KnowledgeConcept } from "../knowledge/types.js";

export type CrossRelationship = CrossInsight["relationship"];

export interface CrossBridgeRule {
  left: Category[];
  right: Category[];
  relationship: CrossRelationship;
  label: string;
}

const DEFAULT_BRIDGES: CrossBridgeRule[] = [
  {
    left: ["llms", "agents", "tools"],
    right: ["biz"],
    relationship: "application",
    label: "AI × Business",
  },
  {
    left: ["llms", "agents"],
    right: ["dining"],
    relationship: "application",
    label: "AI × Dining",
  },
  {
    left: ["mind"],
    right: ["biz"],
    relationship: "analogy",
    label: "Psychology × Marketing",
  },
  {
    left: ["mind"],
    right: ["dining"],
    relationship: "application",
    label: "Behavioral Economics × Dining",
  },
  {
    left: ["trends"],
    right: ["biz", "dining"],
    relationship: "trend",
    label: "Trend × Business/Dining",
  },
  {
    left: ["body"],
    right: ["dining"],
    relationship: "combination",
    label: "Health × Dining",
  },
  {
    left: ["agents", "tools"],
    right: ["dining"],
    relationship: "opportunity",
    label: "Automation × Dining",
  },
  {
    left: ["llms", "agents"],
    right: ["mind"],
    relationship: "analogy",
    label: "AI × NLP/Psychology",
  },
];

async function loadBridges(): Promise<CrossBridgeRule[]> {
  try {
    const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
    const candidates = [
      path.join(root, "config", "cross-bridges.json"),
      path.join(root, "config", "cross-bridges.example.json"),
    ];
    for (const file of candidates) {
      try {
        const raw = JSON.parse(await readFile(file, "utf8")) as {
          bridges?: CrossBridgeRule[];
        };
        if (raw.bridges?.length) return raw.bridges;
      } catch {
        /* next */
      }
    }
  } catch {
    /* default */
  }
  return DEFAULT_BRIDGES;
}

function overlaps(a: Category[], b: Category[]): boolean {
  return a.some((c) => b.includes(c));
}

function sameCategoryOnly(a: Category[], b: Category[]): boolean {
  const setA = new Set(a);
  const setB = new Set(b);
  if (setA.size !== setB.size) return false;
  for (const c of setA) if (!setB.has(c)) return false;
  return true;
}

function sharedKeywords(a: IntelEvent, b: IntelEvent): string[] {
  const sa = new Set(
    [...a.keywords, ...a.entities].map((x) => x.toLowerCase()),
  );
  return [...b.keywords, ...b.entities]
    .map((x) => x.toLowerCase())
    .filter((x) => sa.has(x) && x.length >= 3)
    .slice(0, 6);
}

function scoreInsight(
  left: IntelEvent,
  right: IntelEvent,
  relationship: CrossRelationship,
  shared: string[],
): {
  relevance: number;
  opportunity: number;
  originality: number;
  confidence: number;
} {
  const tommy =
    (left.tommyRelevanceScore + right.tommyRelevanceScore) / 2;
  const biz =
    (left.opportunityScore + right.opportunityScore) / 2;
  const act =
    (left.actionabilityScore + right.actionabilityScore) / 2;
  const novelty = (left.noveltyScore + right.noveltyScore) / 2;
  const distance = sameCategoryOnly(left.categories, right.categories)
    ? 0
    : 20;
  const opportunity = clamp(
    tommy * 0.25 +
      biz * 0.25 +
      act * 0.2 +
      novelty * 0.15 +
      distance +
      shared.length * 3 +
      (relationship === "opportunity" ? 8 : 0),
  );
  const relevance = clamp(tommy * 0.6 + shared.length * 5 + 20);
  const originality = clamp(40 + distance + novelty * 0.3 - shared.length * 2);
  const confidence = clamp(
    35 +
      Math.min(25, left.sourceCount * 4 + right.sourceCount * 4) +
      shared.length * 5 +
      (relationship === "contradiction" ? -15 : 0),
  );
  return { relevance, opportunity, originality, confidence };
}

function conceptsForEvent(
  eventId: string,
  concepts: KnowledgeConcept[],
): string[] {
  return concepts
    .filter((c) => c.source_event_ids.includes(eventId))
    .map((c) => c.id)
    .slice(0, 8);
}

function claimsForEvent(eventId: string, claims: KnowledgeClaim[]): string[] {
  return claims
    .filter((c) => c.source_event_ids.includes(eventId))
    .map((c) => c.id)
    .slice(0, 8);
}

/** 同一キーワードで極性が逆っぽい Claim を contradiction 候補に */
function contradictionCandidates(
  events: IntelEvent[],
  claims: KnowledgeClaim[],
): CrossInsight[] {
  const byNorm = new Map<string, KnowledgeClaim[]>();
  for (const c of claims) {
    const key = (c.normalized_text || c.text)
      .toLowerCase()
      .replace(/[^a-z0-9\u3040-\u30ff\u4e00-\u9fff]+/g, " ")
      .trim()
      .slice(0, 40);
    if (key.length < 8) continue;
    const list = byNorm.get(key.slice(0, 12)) ?? [];
    list.push(c);
    byNorm.set(key.slice(0, 12), list);
  }
  const out: CrossInsight[] = [];
  const neg =
    /not |no |doesn't|isn't|失敗|ない|否定|decline|drop|cut/i;
  const pos = /launch|release|success|成長|発表|上昇|increase|win/i;
  for (const group of byNorm.values()) {
    if (group.length < 2) continue;
    const a = group[0];
    const b = group.find((x) => x.id !== a.id);
    if (!b) continue;
    const aNeg = neg.test(a.text);
    const bNeg = neg.test(b.text);
    const aPos = pos.test(a.text);
    const bPos = pos.test(b.text);
    if (!((aNeg && bPos) || (aPos && bNeg))) continue;
    const left = events.find((e) => a.source_event_ids.includes(e.id));
    const right = events.find((e) => b.source_event_ids.includes(e.id));
    if (!left || !right || left.id === right.id) continue;
    if (sameCategoryOnly(left.categories, right.categories)) continue;
    const id = `cross_${createHash("sha1")
      .update(`${a.id}|${b.id}|contradiction`)
      .digest("hex")
      .slice(0, 10)}`;
    out.push({
      id,
      eventIds: [left.id, right.id],
      conceptIds: [],
      claimIds: [a.id, b.id],
      categories: [...new Set([...left.categories, ...right.categories])],
      title: `矛盾候補: ${(left.titleJa || left.title).slice(0, 40)} × ${(right.titleJa || right.title).slice(0, 40)}`,
      relationship: "contradiction",
      description:
        `possible_contradiction（断定ではない）: 「${a.text.slice(0, 80)}」 vs 「${b.text.slice(0, 80)}」`,
      opportunityScore: 30,
      relevanceScore: 40,
      originalityScore: 55,
      confidence: 28,
      createdAt: new Date().toISOString(),
    });
  }
  return out.slice(0, 8);
}

export async function buildCrossInsights(
  events: IntelEvent[],
  opts?: {
    concepts?: KnowledgeConcept[];
    claims?: KnowledgeClaim[];
    bridges?: CrossBridgeRule[];
  },
): Promise<CrossInsight[]> {
  const bridges = opts?.bridges ?? (await loadBridges());
  const concepts = opts?.concepts ?? [];
  const claims = opts?.claims ?? [];
  const byCat = new Map<Category, IntelEvent[]>();
  for (const e of events.slice(0, 120)) {
    for (const c of e.categories.length ? e.categories : [e.category]) {
      const list = byCat.get(c) ?? [];
      list.push(e);
      byCat.set(c, list);
    }
  }

  const out: CrossInsight[] = [];
  const seen = new Set<string>();
  const now = new Date().toISOString();

  for (const bridge of bridges) {
    const leftPool = bridge.left.flatMap((c) => byCat.get(c) ?? []).slice(0, 6);
    const rightPool = bridge.right
      .flatMap((c) => byCat.get(c) ?? [])
      .slice(0, 6);
    for (const left of leftPool) {
      for (const right of rightPool) {
        if (left.id === right.id) continue;
        if (sameCategoryOnly(left.categories, right.categories)) continue;
        if (
          !overlaps(left.categories, bridge.left) ||
          !overlaps(right.categories, bridge.right)
        ) {
          continue;
        }
        const pairKey = [left.id, right.id].sort().join("|") + bridge.relationship;
        if (seen.has(pairKey)) continue;
        seen.add(pairKey);
        const shared = sharedKeywords(left, right);
        const scores = scoreInsight(left, right, bridge.relationship, shared);
        const conceptIds = [
          ...conceptsForEvent(left.id, concepts),
          ...conceptsForEvent(right.id, concepts),
        ];
        const claimIds = [
          ...claimsForEvent(left.id, claims),
          ...claimsForEvent(right.id, claims),
        ];
        const id = `cross_${createHash("sha1")
          .update(pairKey)
          .digest("hex")
          .slice(0, 10)}`;
        out.push({
          id,
          eventIds: [left.id, right.id],
          conceptIds: [...new Set(conceptIds)],
          claimIds: [...new Set(claimIds)],
          categories: [
            ...new Set([...left.categories, ...right.categories]),
          ],
          title: `${bridge.label}: ${(left.titleJa || left.title).slice(0, 48)} × ${(right.titleJa || right.title).slice(0, 48)}`,
          relationship: bridge.relationship,
          description:
            shared.length > 0
              ? `${bridge.label}。共有語: ${shared.join(", ")}。転用を検討。`
              : `${bridge.label}。異分野接続の候補（共有エンティティは少ない）。`,
          opportunityScore: scores.opportunity,
          relevanceScore: scores.relevance,
          originalityScore: scores.originality,
          confidence: scores.confidence,
          createdAt: now,
        });
      }
    }
  }

  out.push(...contradictionCandidates(events, claims));
  out.sort((a, b) => b.opportunityScore - a.opportunityScore);
  return out.slice(0, 40);
}

export async function runCrossIntelligence(
  dataRoot: string,
  events: IntelEvent[],
): Promise<CrossInsight[]> {
  const knowledge = await loadKnowledge(dataRoot);
  const insights = await buildCrossInsights(events, {
    concepts: knowledge?.concepts ?? [],
    claims: knowledge?.claims ?? [],
  });
  await writeJsonl(
    path.join(dataRoot, "cross-insights", "insights.jsonl"),
    insights,
  );
  await writeJson(path.join(dataRoot, "cross-insights", "latest.json"), {
    updatedAt: new Date().toISOString(),
    count: insights.length,
    insights,
  });
  return insights;
}

function clamp(n: number): number {
  return Math.max(0, Math.min(100, Math.round(n)));
}
