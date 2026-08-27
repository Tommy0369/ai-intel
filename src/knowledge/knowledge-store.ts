import path from "node:path";
import type { KnowledgeStore } from "./types.js";
import { readJson, writeJson } from "../store-jsonl.js";

export const KNOWLEDGE_SCHEMA_VERSION = "2026.08-step05";

export async function saveKnowledge(
  dataRoot: string,
  store: Omit<KnowledgeStore, "schema" | "schema_version" | "updated_at">,
): Promise<string> {
  const dir = path.join(dataRoot, "knowledge");
  const file = path.join(dir, "store.json");
  const body: KnowledgeStore = {
    schema: "ai-intel.knowledge.v1",
    schema_version: KNOWLEDGE_SCHEMA_VERSION,
    updated_at: new Date().toISOString(),
    ...store,
  };
  await writeJson(file, body);
  await writeJson(path.join(dir, "index.json"), {
    updatedAt: body.updated_at,
    entities: body.entities.length,
    concepts: body.concepts.length,
    claims: body.claims.length,
    relations: body.relations.length,
  });
  return file;
}

export async function loadKnowledge(dataRoot: string): Promise<KnowledgeStore | null> {
  return readJson<KnowledgeStore | null>(
    path.join(dataRoot, "knowledge", "store.json"),
    null,
  );
}
