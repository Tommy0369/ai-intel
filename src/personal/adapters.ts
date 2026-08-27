import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { contentHashSha256 } from "../canonical/content-hash.js";
import type {
  DocumentSection,
  NormalizedDocument,
  PersonalSourceAdapter,
  PersonalSourceType,
} from "./types.js";

function docId(sourcePath: string, hash: string): string {
  return `doc_${createHash("sha1").update(`${sourcePath}|${hash}`).digest("hex").slice(0, 12)}`;
}

function sectionsFromText(text: string, prefix: string): DocumentSection[] {
  const chunks = text
    .split(/\n{2,}/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  if (!chunks.length && text.trim()) chunks.push(text.trim());
  return chunks.map((body, i) => {
    const headingMatch = body.match(/^#{1,6}\s+(.+)$/m);
    return {
      id: `${prefix}_s${i}`,
      heading: headingMatch?.[1]?.trim(),
      text: body,
      order: i,
      location: `section:${i + 1}`,
    };
  });
}

export const markdownAdapter: PersonalSourceAdapter = {
  canHandle(input: string) {
    return /\.(md|markdown)$/i.test(input);
  },
  async ingest(input: string) {
    const raw = await readFile(input, "utf8");
    const hash = contentHashSha256(raw);
    const title =
      raw.match(/^#\s+(.+)$/m)?.[1]?.trim() || path.basename(input, path.extname(input));
    return {
      id: docId(input, hash),
      source_type: "markdown" as PersonalSourceType,
      title,
      source_path: input,
      imported_at: new Date().toISOString(),
      content_hash: hash,
      sections: sectionsFromText(raw, "md"),
      metadata: { bytes: Buffer.byteLength(raw, "utf8") },
    };
  },
};

export const textAdapter: PersonalSourceAdapter = {
  canHandle(input: string) {
    return /\.(txt|text)$/i.test(input);
  },
  async ingest(input: string) {
    const raw = await readFile(input, "utf8");
    const hash = contentHashSha256(raw);
    return {
      id: docId(input, hash),
      source_type: "text",
      title: path.basename(input, path.extname(input)),
      source_path: input,
      imported_at: new Date().toISOString(),
      content_hash: hash,
      sections: sectionsFromText(raw, "txt"),
      metadata: {},
    };
  },
};

/** Kindle My Clippings.txt / highlights export（正規エクスポートのみ） */
export const kindleHighlightsAdapter: PersonalSourceAdapter = {
  canHandle(input: string) {
    const base = path.basename(input).toLowerCase();
    return (
      base === "my clippings.txt" ||
      base.includes("clippings") ||
      (base.includes("kindle") && base.endsWith(".txt"))
    );
  },
  async ingest(input: string) {
    const raw = await readFile(input, "utf8");
    const hash = contentHashSha256(raw);
    const blocks = raw
      .split(/==========\s*/)
      .map((b) => b.trim())
      .filter(Boolean);
    const sections: DocumentSection[] = [];
    let i = 0;
    for (const block of blocks) {
      const lines = block.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
      if (lines.length < 2) continue;
      const title = lines[0];
      const meta = lines[1];
      const text = lines.slice(2).join("\n");
      if (!text) continue;
      sections.push({
        id: `kindle_s${i}`,
        heading: title,
        text,
        order: i,
        location: meta,
      });
      i++;
    }
    return {
      id: docId(input, hash),
      source_type: "kindle_highlights",
      title: "Kindle Highlights",
      source_path: input,
      imported_at: new Date().toISOString(),
      content_hash: hash,
      sections,
      metadata: { clippingCount: sections.length },
    };
  },
};

/** PDF: バイナリ検査のみ。暗号化は失敗、本文抽出は簡易（依存追加なし） */
export const pdfAdapter: PersonalSourceAdapter = {
  canHandle(input: string) {
    return /\.pdf$/i.test(input);
  },
  async ingest(input: string) {
    const buf = await readFile(input);
    const head = buf.subarray(0, Math.min(buf.length, 4096)).toString("latin1");
    if (!head.startsWith("%PDF")) {
      throw Object.assign(new Error("not a pdf"), { code: "parse_failed" });
    }
    if (/\/Encrypt\b/.test(head) || /\/Encrypt\b/.test(buf.toString("latin1", 0, Math.min(buf.length, 200_000)))) {
      throw Object.assign(new Error("encrypted pdf"), { code: "encrypted" });
    }
    // 依存なしの簡易抽出: 可視ASCII文字列を拾う（失敗しても空にしないようメタ保持）
    const ascii = buf
      .toString("latin1")
      .replace(/[^\x20-\x7E\n\r\t\u3040-\u30ff\u4e00-\u9fff]/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 20_000);
    if (ascii.length < 40) {
      throw Object.assign(new Error("empty or unreadable pdf text"), {
        code: "parse_failed",
      });
    }
    const hash = contentHashSha256(ascii);
    return {
      id: docId(input, hash),
      source_type: "pdf",
      title: path.basename(input, ".pdf"),
      source_path: input,
      imported_at: new Date().toISOString(),
      content_hash: hash,
      sections: sectionsFromText(ascii, "pdf"),
      metadata: { note: "lightweight extract; not full PDF parser" },
    } satisfies NormalizedDocument;
  },
};

export const ADAPTERS: PersonalSourceAdapter[] = [
  kindleHighlightsAdapter,
  markdownAdapter,
  textAdapter,
  pdfAdapter,
];

export function pickAdapter(filePath: string): PersonalSourceAdapter | null {
  return ADAPTERS.find((a) => a.canHandle(filePath)) ?? null;
}

export async function assertReadableFile(filePath: string): Promise<void> {
  const st = await stat(filePath);
  if (!st.isFile()) throw new Error("not a file");
}
