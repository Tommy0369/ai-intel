import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, writeFile, mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { ingestFile, personalStatus } from "./ingest.js";

test("markdown ingest + duplicate detection", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "ai-intel-personal-"));
  const dataRoot = path.join(root, "data");
  await mkdir(dataRoot, { recursive: true });
  const md = path.join(root, "note.md");
  await writeFile(
    md,
    "# Hello\n\nThis is a personal note about AI agents and dining ops.\n\nSecond section here.\n",
    "utf8",
  );
  const a = await ingestFile(dataRoot, md);
  assert.equal(a.status, "success");
  assert.ok(a.document?.sections.length);
  assert.ok(a.document?.source_path);
  const b = await ingestFile(dataRoot, md);
  assert.equal(b.status, "duplicate");
  const st = await personalStatus(dataRoot);
  assert.equal(st.documents, 1);
});

test("unsupported extension fails safely", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "ai-intel-personal-"));
  const dataRoot = path.join(root, "data");
  await mkdir(dataRoot, { recursive: true });
  const bin = path.join(root, "x.bin");
  await writeFile(bin, "nope");
  const r = await ingestFile(dataRoot, bin);
  assert.equal(r.status, "unsupported");
});

test("kindle clippings parse", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "ai-intel-personal-"));
  const dataRoot = path.join(root, "data");
  await mkdir(dataRoot, { recursive: true });
  const clip = path.join(root, "My Clippings.txt");
  await writeFile(
    clip,
    [
      "Book Title",
      "- Your Highlight Location 12",
      "A memorable quote about habits and restaurants.",
      "==========",
      "Another Book",
      "- Note Location 3",
      "Second highlight text that is long enough to keep.",
      "==========",
    ].join("\n"),
    "utf8",
  );
  const r = await ingestFile(dataRoot, clip);
  assert.equal(r.status, "success");
  assert.equal(r.document?.source_type, "kindle_highlights");
  assert.ok((r.document?.sections.length ?? 0) >= 2);
});
