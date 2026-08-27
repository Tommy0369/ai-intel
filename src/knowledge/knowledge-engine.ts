import type { IntelEvent } from "../v2-types.js";
import { extractFromEvent, mergeKnowledge } from "./extract.js";
import { saveKnowledge } from "./knowledge-store.js";

export async function runKnowledgeEngine(
  dataRoot: string,
  events: IntelEvent[],
  opts?: { limit?: number },
): Promise<{
  entities: number;
  concepts: number;
  claims: number;
  relations: number;
  path: string;
}> {
  const slice = events.slice(0, opts?.limit ?? 120);
  const merged = mergeKnowledge(slice.map(extractFromEvent));
  const path = await saveKnowledge(dataRoot, merged);
  return {
    entities: merged.entities.length,
    concepts: merged.concepts.length,
    claims: merged.claims.length,
    relations: merged.relations.length,
    path,
  };
}
