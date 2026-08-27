import { createHash } from "node:crypto";
import { mkdir, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { appendJsonl, readJson, writeJson } from "../store-jsonl.js";
import type { KnowledgeQuote } from "./types.js";
import type { IngestResult, NormalizedDocument } from "./types.js";
import { assertReadableFile, pickAdapter } from "./adapters.js";

export interface PersonalIndex {
  updatedAt: string;
  documents: Array<{
    id: string;
    title: string;
    source_type: string;
    source_path?: string;
    content_hash: string;
    imported_at: string;
    sections: number;
  }>;
  hashes: string[];
}

function personalDir(dataRoot: string): string {
  return path.join(dataRoot, "personal");
}

export async function loadPersonalIndex(dataRoot: string): Promise<PersonalIndex> {
  return readJson<PersonalIndex>(path.join(personalDir(dataRoot), "index.json"), {
    updatedAt: new Date().toISOString(),
    documents: [],
    hashes: [],
  });
}

async function saveDocument(
  dataRoot: string,
  doc: NormalizedDocument,
): Promise<string> {
  const dir = path.join(personalDir(dataRoot), "documents");
  await mkdir(dir, { recursive: true });
  const file = path.join(dir, `${doc.id}.json`);
  await writeFile(file, JSON.stringify(doc, null, 2) + "\n", "utf8");
  return file;
}

function quotesFromDoc(doc: NormalizedDocument): KnowledgeQuote[] {
  return doc.sections
    .filter((s) => s.text.length >= 40 && s.text.length <= 800)
    .slice(0, 40)
    .map((s) => ({
      id: `quote_${createHash("sha1").update(`${doc.id}|${s.id}`).digest("hex").slice(0, 10)}`,
      text: s.text.slice(0, 500),
      document_id: doc.id,
      section_id: s.id,
      location: s.location,
    }));
}

export async function ingestFile(
  dataRoot: string,
  filePath: string,
): Promise<IngestResult> {
  const abs = path.resolve(filePath);
  try {
    await assertReadableFile(abs);
  } catch (e) {
    return {
      status: "parse_failed",
      path: abs,
      error: e instanceof Error ? e.message : String(e),
    };
  }

  const adapter = pickAdapter(abs);
  if (!adapter) {
    return { status: "unsupported", path: abs, error: "no adapter" };
  }

  try {
    const doc = await adapter.ingest(abs);
    if (!doc.sections.length || doc.sections.every((s) => !s.text.trim())) {
      return { status: "empty", path: abs, error: "no text sections" };
    }
    const index = await loadPersonalIndex(dataRoot);
    if (index.hashes.includes(doc.content_hash)) {
      await appendJsonl(path.join(personalDir(dataRoot), "import-log.jsonl"), {
        at: new Date().toISOString(),
        path: abs,
        status: "duplicate",
        content_hash: doc.content_hash,
      });
      return { status: "duplicate", path: abs, document: doc };
    }
    await saveDocument(dataRoot, doc);
    const quotes = quotesFromDoc(doc);
    if (quotes.length) {
      await writeJson(
        path.join(personalDir(dataRoot), "quotes", `${doc.id}.json`),
        { document_id: doc.id, quotes },
      );
    }
    index.documents.push({
      id: doc.id,
      title: doc.title,
      source_type: doc.source_type,
      source_path: doc.source_path,
      content_hash: doc.content_hash,
      imported_at: doc.imported_at,
      sections: doc.sections.length,
    });
    index.hashes.push(doc.content_hash);
    index.updatedAt = new Date().toISOString();
    await writeJson(path.join(personalDir(dataRoot), "index.json"), index);
    await appendJsonl(path.join(personalDir(dataRoot), "import-log.jsonl"), {
      at: index.updatedAt,
      path: abs,
      status: "success",
      document_id: doc.id,
      content_hash: doc.content_hash,
    });
    return { status: "success", path: abs, document: doc };
  } catch (e) {
    const code =
      e && typeof e === "object" && "code" in e
        ? String((e as { code: string }).code)
        : "parse_failed";
    const status =
      code === "encrypted"
        ? "encrypted"
        : code === "unsupported"
          ? "unsupported"
          : "parse_failed";
    await appendJsonl(path.join(personalDir(dataRoot), "import-log.jsonl"), {
      at: new Date().toISOString(),
      path: abs,
      status,
      error: e instanceof Error ? e.message : String(e),
    });
    return {
      status,
      path: abs,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

export async function ingestFolder(
  dataRoot: string,
  folder: string,
): Promise<IngestResult[]> {
  const abs = path.resolve(folder);
  const entries = await readdir(abs, { withFileTypes: true });
  const results: IngestResult[] = [];
  for (const ent of entries) {
    if (!ent.isFile()) continue;
    results.push(await ingestFile(dataRoot, path.join(abs, ent.name)));
  }
  return results;
}

export async function personalStatus(dataRoot: string): Promise<{
  documents: number;
  byType: Record<string, number>;
  updatedAt?: string;
}> {
  const index = await loadPersonalIndex(dataRoot);
  const byType: Record<string, number> = {};
  for (const d of index.documents) {
    byType[d.source_type] = (byType[d.source_type] ?? 0) + 1;
  }
  return {
    documents: index.documents.length,
    byType,
    updatedAt: index.updatedAt,
  };
}
