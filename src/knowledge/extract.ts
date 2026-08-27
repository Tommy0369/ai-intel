import { createHash } from "node:crypto";
import type { IntelEvent } from "../v2-types.js";
import type {
  KnowledgeClaim,
  KnowledgeConcept,
  KnowledgeEntity,
  KnowledgeRelation,
} from "./types.js";

const CONCEPT_PATTERNS: Array<{ re: RegExp; name: string }> = [
  { re: /\bRAG\b/i, name: "RAG" },
  { re: /\bAI Agent/i, name: "AI Agent" },
  { re: /prompt caching/i, name: "Prompt Caching" },
  { re: /behavioral economics/i, name: "Behavioral Economics" },
  { re: /menu engineering/i, name: "Menu Engineering" },
  { re: /systematic review/i, name: "Systematic Review" },
];

const ENTITY_RULES: Array<{ re: RegExp; name: string; type: string }> = [
  { re: /\bOpenAI\b/i, name: "OpenAI", type: "company" },
  { re: /\bAnthropic\b/i, name: "Anthropic", type: "company" },
  { re: /\bClaude\b/i, name: "Claude", type: "product" },
  { re: /\bGPT-?4[o]?\b/i, name: "GPT-4", type: "model" },
  { re: /\bGemini\b/i, name: "Gemini", type: "model" },
];

function kid(prefix: string, key: string): string {
  const h = createHash("sha1").update(key).digest("hex").slice(0, 10);
  return `${prefix}_${h}`;
}

function normalizeClaim(text: string): string {
  return text.replace(/\s+/g, " ").trim().slice(0, 280);
}

export function extractFromEvent(ev: IntelEvent): {
  entities: KnowledgeEntity[];
  concepts: KnowledgeConcept[];
  claims: KnowledgeClaim[];
  relations: KnowledgeRelation[];
} {
  const hay = `${ev.title} ${ev.titleJa ?? ""} ${ev.keywords.join(" ")} ${ev.entities.join(" ")}`;
  const entities: KnowledgeEntity[] = [];
  const concepts: KnowledgeConcept[] = [];
  const claims: KnowledgeClaim[] = [];
  const relations: KnowledgeRelation[] = [];

  for (const rule of ENTITY_RULES) {
    if (!rule.re.test(hay)) continue;
    entities.push({
      id: kid("ent", rule.name.toLowerCase()),
      name: rule.name,
      type: rule.type,
      aliases: [rule.name],
      source_event_ids: [ev.id],
    });
  }
  for (const ent of ev.entities.slice(0, 8)) {
    if (ent.length < 2) continue;
    entities.push({
      id: kid("ent", ent.toLowerCase()),
      name: ent,
      type: "entity",
      aliases: [ent],
      source_event_ids: [ev.id],
    });
  }

  for (const pat of CONCEPT_PATTERNS) {
    if (!pat.re.test(hay)) continue;
    concepts.push({
      id: kid("con", pat.name.toLowerCase()),
      name: pat.name,
      source_event_ids: [ev.id],
      related_entity_ids: entities.map((e) => e.id),
    });
  }

  const claimText = normalizeClaim(ev.titleJa || ev.title);
  if (claimText.length >= 12) {
    claims.push({
      id: kid("clm", `${ev.id}|${claimText}`),
      text: claimText,
      normalized_text: claimText.toLowerCase(),
      source_event_ids: [ev.id],
      source_article_ids: ev.articles.slice(0, 5),
      support_count: Math.max(1, ev.sourceCount),
      contradiction_count: 0,
      confidence: Math.min(0.95, 0.45 + ev.sourceCount * 0.05),
    });
  }

  const company = entities.find((e) => e.type === "company");
  const product = entities.find((e) => e.type === "product" || e.type === "model");
  if (company && product) {
    relations.push({
      id: kid("rel", `${company.id}|develops|${product.id}`),
      from_id: company.id,
      to_id: product.id,
      type: "develops",
      source_event_ids: [ev.id],
    });
  }

  return { entities, concepts, claims, relations };
}

export function mergeKnowledge(
  chunks: ReturnType<typeof extractFromEvent>[],
): {
  entities: KnowledgeEntity[];
  concepts: KnowledgeConcept[];
  claims: KnowledgeClaim[];
  relations: KnowledgeRelation[];
} {
  const entities = new Map<string, KnowledgeEntity>();
  const concepts = new Map<string, KnowledgeConcept>();
  const claims = new Map<string, KnowledgeClaim>();
  const relations = new Map<string, KnowledgeRelation>();

  for (const c of chunks) {
    for (const e of c.entities) {
      const prev = entities.get(e.id);
      if (!prev) entities.set(e.id, { ...e });
      else {
        prev.source_event_ids = [...new Set([...prev.source_event_ids, ...e.source_event_ids])];
        prev.aliases = [...new Set([...prev.aliases, ...e.aliases])];
      }
    }
    for (const x of c.concepts) {
      const prev = concepts.get(x.id);
      if (!prev) concepts.set(x.id, { ...x });
      else {
        prev.source_event_ids = [...new Set([...prev.source_event_ids, ...x.source_event_ids])];
      }
    }
    for (const cl of c.claims) {
      const prev = claims.get(cl.id);
      if (!prev) claims.set(cl.id, { ...cl });
      else {
        prev.support_count += cl.support_count;
        prev.source_event_ids = [...new Set([...prev.source_event_ids, ...cl.source_event_ids])];
        prev.source_article_ids = [...new Set([...prev.source_article_ids, ...cl.source_article_ids])];
      }
    }
    for (const r of c.relations) {
      relations.set(r.id, r);
    }
  }

  return {
    entities: [...entities.values()],
    concepts: [...concepts.values()],
    claims: [...claims.values()],
    relations: [...relations.values()],
  };
}
