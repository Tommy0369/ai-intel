/**
 * CorpusAdapter — Fork計画の「コーパスを読むアダプタ」
 * OSS に移植しやすい薄い読み取り層（ローカルHDDのみ）
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { CatalogEntry } from "./types.js";
import { loadCatalog, sortByRecency, topTags } from "./corpus.js";

export interface CorpusHit {
  entry: CatalogEntry;
  score: number;
}

export class CorpusAdapter {
  constructor(private readonly dataRoot: string) {}

  async all(): Promise<CatalogEntry[]> {
    return loadCatalog(this.dataRoot);
  }

  async search(query: string, limit = 10): Promise<CorpusHit[]> {
    const terms = query
      .toLowerCase()
      .split(/\s+/)
      .filter((t) => t.length >= 2);
    const catalog = await this.all();
    return catalog
      .map((entry) => {
        const hay =
          `${entry.title} ${(entry.tags ?? []).join(" ")} ${entry.category} ${entry.source}`.toLowerCase();
        let score = 0;
        for (const t of terms) {
          if (hay.includes(t)) score += 1;
        }
        return { entry, score };
      })
      .filter((h) => h.score > 0)
      .sort(
        (a, b) =>
          b.score - a.score ||
          (b.entry.collected_at || "").localeCompare(a.entry.collected_at || ""),
      )
      .slice(0, limit);
  }

  async latest(limit = 10): Promise<CatalogEntry[]> {
    const catalog = await this.all();
    return sortByRecency(catalog).slice(0, limit);
  }

  async stats(): Promise<{
    total: number;
    tags: Array<{ tag: string; count: number }>;
  }> {
    const catalog = await this.all();
    return { total: catalog.length, tags: topTags(catalog, 10) };
  }

  async readReadyFile(name: string): Promise<string | null> {
    try {
      return await readFile(path.join(this.dataRoot, "ready", name), "utf8");
    } catch {
      return null;
    }
  }

  async readAgentFile(name: string): Promise<string | null> {
    try {
      return await readFile(path.join(this.dataRoot, "agent", name), "utf8");
    } catch {
      return null;
    }
  }
}
