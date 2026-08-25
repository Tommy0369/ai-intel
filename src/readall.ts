import { readFile } from "node:fs/promises";
import path from "node:path";
import type { CatalogEntry, Category, SourceKind } from "./types.js";
import { loadCatalog } from "./corpus.js";

export interface ReadItem {
  id: string;
  title: string;
  url: string;
  source: SourceKind;
  category: Category;
  collectedAt: string;
  publishedAt?: string;
  tags: string[];
  lang: string;
  path: string;
  summary: string;
  bodyPreview: string;
  charCount: number;
  readOk: boolean;
  error?: string;
}

function extractSummary(markdown: string): string {
  const m = markdown.match(/## 要約\s*\n+([\s\S]*?)(?:\n## |\n---|\s*$)/);
  if (!m) return "";
  const text = m[1]
    .replace(/（なし[^）]*）/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return text;
}

function stripFrontmatter(markdown: string): string {
  if (!markdown.startsWith("---\n")) return markdown;
  const end = markdown.indexOf("\n---\n", 4);
  if (end < 0) return markdown;
  return markdown.slice(end + 5);
}

export async function readAllItems(dataRoot: string): Promise<{
  items: ReadItem[];
  missing: CatalogEntry[];
  catalogTotal: number;
}> {
  const catalog = await loadCatalog(dataRoot);
  const items: ReadItem[] = [];
  const missing: CatalogEntry[] = [];

  for (const entry of catalog) {
    const abs = path.join(dataRoot, entry.path);
    try {
      const raw = await readFile(abs, "utf8");
      const body = stripFrontmatter(raw);
      const summary = extractSummary(raw);
      const preview = body
        .replace(/^#.+\n+/, "")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 400);
      items.push({
        id: entry.id,
        title: entry.title,
        url: entry.url,
        source: entry.source,
        category: entry.category,
        collectedAt: entry.collected_at,
        publishedAt: entry.published_at,
        tags: entry.tags ?? [],
        lang: entry.lang ?? "en",
        path: entry.path,
        summary,
        bodyPreview: preview,
        charCount: raw.length,
        readOk: true,
      });
    } catch (err) {
      missing.push(entry);
      items.push({
        id: entry.id,
        title: entry.title,
        url: entry.url,
        source: entry.source,
        category: entry.category,
        collectedAt: entry.collected_at,
        publishedAt: entry.published_at,
        tags: entry.tags ?? [],
        lang: entry.lang ?? "en",
        path: entry.path,
        summary: "",
        bodyPreview: "",
        charCount: 0,
        readOk: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return { items, missing, catalogTotal: catalog.length };
}
