import { rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type { CatalogEntry } from "./types.js";
import { loadCatalog } from "./corpus.js";

export type CatalogPatch = Partial<CatalogEntry> & { id: string };

/** catalog.jsonl の該当 id をマージ更新（後方互換・追記ではなく全書換） */
export async function patchCatalogEntries(
  dataRoot: string,
  patches: CatalogPatch[],
): Promise<number> {
  if (!patches.length) return 0;
  const byId = new Map(patches.map((p) => [p.id, p]));
  const catalog = await loadCatalog(dataRoot);
  let touched = 0;
  const next = catalog.map((e) => {
    const p = byId.get(e.id);
    if (!p) return e;
    touched++;
    const { id: _id, ...rest } = p;
    return { ...e, ...rest };
  });
  if (!touched) return 0;
  const tmp = path.join(dataRoot, "catalog.jsonl.tmp");
  const out = path.join(dataRoot, "catalog.jsonl");
  await writeFile(
    tmp,
    next.map((e) => JSON.stringify(e)).join("\n") + (next.length ? "\n" : ""),
    "utf8",
  );
  await rename(tmp, out);
  return touched;
}
