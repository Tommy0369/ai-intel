import { assertDataRootReady } from "./disk.js";
import { loadCatalog } from "./corpus.js";
import type { AppConfig } from "./types.js";

export async function runSearch(
  config: AppConfig,
  query: string,
  limit = 20,
): Promise<void> {
  await assertDataRootReady(config);
  const q = query.trim().toLowerCase();
  if (!q) {
    throw new Error("検索語が空です。例: npm run search -- agent rag");
  }
  const terms = q.split(/\s+/).filter(Boolean);
  const catalog = await loadCatalog(config.dataRoot);

  const scored = catalog
    .map((e) => {
      const hay = `${e.title} ${e.tags?.join(" ") ?? ""} ${e.category} ${e.source} ${e.url}`.toLowerCase();
      let score = 0;
      for (const t of terms) {
        if (hay.includes(t)) score += 1;
      }
      return { e, score };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || b.e.collected_at.localeCompare(a.e.collected_at))
    .slice(0, limit);

  console.log(`search "${query}" → ${scored.length} hits (limit ${limit})`);
  for (const { e, score } of scored) {
    console.log(`\n[${score}] ${e.title}`);
    console.log(`  ${e.url}`);
    console.log(`  ${e.category}/${e.source} · ${e.path}`);
  }
}
