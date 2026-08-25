import { readFile } from "node:fs/promises";
import path from "node:path";
import type { CatalogEntry, Category } from "./types.js";
import { CATEGORIES } from "./types.js";

export async function loadCatalog(dataRoot: string): Promise<CatalogEntry[]> {
  try {
    const raw = await readFile(path.join(dataRoot, "catalog.jsonl"), "utf8");
    return raw
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean)
      .map((line) => JSON.parse(line) as CatalogEntry);
  } catch {
    return [];
  }
}

export function sortByRecency(entries: CatalogEntry[]): CatalogEntry[] {
  return [...entries].sort((a, b) => {
    const ta = a.published_at || a.collected_at || "";
    const tb = b.published_at || b.collected_at || "";
    return tb.localeCompare(ta);
  });
}

export function countByCategory(
  entries: CatalogEntry[],
): Record<Category, number> {
  const counts = Object.fromEntries(
    CATEGORIES.map((c) => [c, 0]),
  ) as Record<Category, number>;
  for (const e of entries) {
    if (e.category in counts) counts[e.category]++;
    else counts.other++;
  }
  return counts;
}

export function topTags(
  entries: CatalogEntry[],
  limit = 20,
): Array<{ tag: string; count: number }> {
  const map = new Map<string, number>();
  for (const e of entries) {
    for (const tag of e.tags ?? []) {
      const t = tag.toLowerCase();
      if (CATEGORIES.includes(t as Category)) continue;
      if (["arxiv", "rss", "github", "youtube", "reddit", "docs", "x", "europepmc"].includes(t)) {
        continue;
      }
      map.set(t, (map.get(t) ?? 0) + 1);
    }
  }
  return [...map.entries()]
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, limit);
}

const SIGNAL_WORDS =
  /\b(agent|rag|llm|gpt|claude|gemini|llama|multimodal|safety|align|open.?source|benchmark|reasoning|tool.?use|autonomous|fine.?tun|embedding|diffusion|vision)\b/i;

export function scoreLearningValue(entry: CatalogEntry): number {
  let score = 0;
  if (entry.source === "arxiv") score += 3;
  if (entry.source === "github") score += 2;
  if (entry.source === "docs") score += 2;
  if (entry.source === "youtube") score += 1;
  if (SIGNAL_WORDS.test(entry.title)) score += 2;
  if ((entry.tags?.length ?? 0) >= 3) score += 1;
  if (["research", "agents", "llms", "tools", "safety"].includes(entry.category)) {
    score += 1;
  }
  return score;
}

export function pickTop(
  entries: CatalogEntry[],
  limit: number,
): CatalogEntry[] {
  return [...entries]
    .sort((a, b) => scoreLearningValue(b) - scoreLearningValue(a))
    .slice(0, limit);
}
