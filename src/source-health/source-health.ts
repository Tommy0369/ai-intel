import path from "node:path";
import { loadCatalog } from "../corpus.js";
import type { AppConfig } from "../types.js";
import { hostnameOf } from "../canonical/catalog-fields.js";
import { writeJson } from "../store-jsonl.js";
import {
  formatSourceHealthTable,
  listSourceHealth,
  seedFromCatalogIfEmpty,
  type SourceHealthRecord,
} from "./source-health-store.js";

export type { SourceHealthRecord };

export async function runSourceHealth(
  config: AppConfig,
): Promise<SourceHealthRecord[]> {
  const catalog = await loadCatalog(config.dataRoot);
  const by = new Map<string, { last?: string; n: number; kind: string }>();
  for (const e of catalog) {
    const host = hostnameOf(e.canonical_url || e.url) || e.source;
    const id = `${e.source}:${host}`;
    const cur = by.get(id) ?? { n: 0, kind: e.source };
    cur.n += 1;
    if (!cur.last || (e.collected_at || "") > cur.last) cur.last = e.collected_at;
    by.set(id, cur);
  }
  await seedFromCatalogIfEmpty(
    config,
    [...by.entries()].map(([sourceId, v]) => ({
      sourceId,
      sourceKind: v.kind,
      lastItemAt: v.last,
      n: v.n,
    })),
  );

  const rows = await listSourceHealth(config.dataRoot);
  await writeJson(path.join(config.dataRoot, "source-health", "latest.json"), {
    updatedAt: new Date().toISOString(),
    rows,
  });
  return rows;
}

export { formatSourceHealthTable };
