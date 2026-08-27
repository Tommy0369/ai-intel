import { appendFile, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type { CatalogEntry, IntelItem } from "./types.js";
import { CATEGORIES } from "./types.js";
import { toGlanceTitle } from "./title-ja.js";
import { initialCatalogFetchFields } from "./canonical/catalog-fields.js";

function yamlEscape(value: string): string {
  if (/[:#\[\]{}",'\n]/.test(value) || value.trim() !== value) {
    return JSON.stringify(value);
  }
  return value;
}

export function toMarkdown(item: IntelItem, titleJa?: string): string {
  const tags = item.tags.map((t) => JSON.stringify(t)).join(", ");
  const ja = titleJa?.trim();
  const lines = [
    "---",
    `id: ${item.id}`,
    `title: ${yamlEscape(item.title)}`,
  ];
  if (ja) lines.push(`title_ja: ${yamlEscape(ja)}`);
  lines.push(
    `url: ${yamlEscape(item.url)}`,
    `source: ${item.source}`,
    `category: ${item.category}`,
    `collected_at: ${item.collectedAt}`,
  );
  if (item.publishedAt) lines.push(`published_at: ${item.publishedAt}`);
  lines.push(`tags: [${tags}]`);
  lines.push(`lang: ${item.lang}`);
  if (item.authors.length) {
    lines.push(
      `authors: [${item.authors.map((a) => JSON.stringify(a)).join(", ")}]`,
    );
  }
  lines.push("---", "");
  if (ja) {
    lines.push(`# ${ja}`, "", `原文タイトル: ${item.title}`, "");
  } else {
    lines.push(`# ${item.title}`, "");
  }
  lines.push(`- URL: ${item.url}`);
  lines.push(`- 出典: ${item.source}`);
  lines.push(`- カテゴリ: ${item.category}`);
  if (item.publishedAt) lines.push(`- 公開日: ${item.publishedAt}`);
  if (item.authors.length) {
    lines.push(`- 著者: ${item.authors.join(", ")}`);
  }
  if (item.summary) {
    lines.push("", "## 要約", "", item.summary.trim());
  } else {
    lines.push("", "## 要約", "", "（なし — タイトルと URL のみ）");
  }
  lines.push("");
  return lines.join("\n");
}

export function toCatalogEntry(item: IntelItem): CatalogEntry {
  return {
    id: item.id,
    title: item.title,
    title_ja: toGlanceTitle(item),
    url: item.url,
    source: item.source,
    category: item.category,
    collected_at: item.collectedAt,
    published_at: item.publishedAt,
    tags: item.tags,
    lang: item.lang,
    path: item.relativePath,
    ...initialCatalogFetchFields(item.url),
  };
}

function safeFilename(title: string, id: string): string {
  const base = title
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\w\s\-]+/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 80)
    .replace(/^-+|-+$/g, "");
  return `${base || "item"}-${id}.md`;
}

export async function writeItem(
  dataRoot: string,
  item: IntelItem,
): Promise<void> {
  const filename = safeFilename(item.title, item.id);
  const categoryRel = path.join("by-category", item.category, filename);
  const sourceRel = path.join("by-source", item.source, filename);
  item.relativePath = categoryRel;

  const md = toMarkdown(item, toGlanceTitle(item));
  const categoryAbs = path.join(dataRoot, categoryRel);
  const sourceAbs = path.join(dataRoot, sourceRel);
  await mkdir(path.dirname(categoryAbs), { recursive: true });
  await mkdir(path.dirname(sourceAbs), { recursive: true });
  await writeFile(categoryAbs, md, "utf8");
  await writeFile(sourceAbs, md, "utf8");

  const entry = JSON.stringify(toCatalogEntry(item));
  await appendFile(path.join(dataRoot, "catalog.jsonl"), entry + "\n", "utf8");
}

export async function writeRunMeta(
  dataRoot: string,
  meta: Record<string, unknown>,
): Promise<void> {
  const file = path.join(dataRoot, "state", "last-run.json");
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(meta, null, 2) + "\n", "utf8");
}

export async function rebuildCatalogFromDisk(dataRoot: string): Promise<number> {
  const { readdir } = await import("node:fs/promises");
  const entries: CatalogEntry[] = [];

  for (const category of CATEGORIES) {
    const dir = path.join(dataRoot, "by-category", category);
    let files: string[] = [];
    try {
      files = (await readdir(dir)).filter((f) => f.endsWith(".md"));
    } catch {
      continue;
    }
    for (const file of files) {
      const abs = path.join(dir, file);
      const text = await readFile(abs, "utf8");
      const parsed = parseFrontmatter(text);
      if (!parsed) continue;
      entries.push({
        id: String(parsed.id ?? file),
        title: String(parsed.title ?? file),
        url: String(parsed.url ?? ""),
        source: parsed.source as CatalogEntry["source"],
        category,
        collected_at: String(parsed.collected_at ?? ""),
        published_at: parsed.published_at
          ? String(parsed.published_at)
          : undefined,
        tags: Array.isArray(parsed.tags)
          ? parsed.tags.map(String)
          : [],
        lang: String(parsed.lang ?? "en"),
        path: path.join("by-category", category, file),
      });
    }
  }

  entries.sort((a, b) =>
    (b.collected_at || "").localeCompare(a.collected_at || ""),
  );

  const tmp = path.join(dataRoot, "catalog.jsonl.tmp");
  const out = path.join(dataRoot, "catalog.jsonl");
  await writeFile(
    tmp,
    entries.map((e) => JSON.stringify(e)).join("\n") +
      (entries.length ? "\n" : ""),
    "utf8",
  );
  await rename(tmp, out);
  return entries.length;
}

function parseFrontmatter(
  text: string,
): Record<string, unknown> | null {
  if (!text.startsWith("---\n")) return null;
  const end = text.indexOf("\n---\n", 4);
  if (end < 0) return null;
  const block = text.slice(4, end);
  const result: Record<string, unknown> = {};
  for (const line of block.split("\n")) {
    const idx = line.indexOf(":");
    if (idx < 0) continue;
    const key = line.slice(0, idx).trim();
    let value = line.slice(idx + 1).trim();
    if (value.startsWith("[") && value.endsWith("]")) {
      try {
        result[key] = JSON.parse(value.replace(/(['"])?([a-zA-Z0-9_-]+)\1/g, '"$2"').replace(/'/g, '"'));
      } catch {
        try {
          result[key] = JSON.parse(value);
        } catch {
          result[key] = value;
        }
      }
      continue;
    }
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      try {
        result[key] = JSON.parse(value.startsWith("'") ? `"${value.slice(1, -1)}"` : value);
      } catch {
        result[key] = value.slice(1, -1);
      }
      continue;
    }
    result[key] = value;
  }
  return result;
}

export async function countCatalog(dataRoot: string): Promise<number> {
  try {
    const raw = await readFile(path.join(dataRoot, "catalog.jsonl"), "utf8");
    return raw.split("\n").filter((l) => l.trim()).length;
  } catch {
    return 0;
  }
}
