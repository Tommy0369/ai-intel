import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { AppConfig, CatalogEntry, Category } from "./types.js";
import { loadCatalog, sortByRecency } from "./corpus.js";
import { glanceOf } from "./title-ja.js";
import { resolveBridgeRoot } from "./ship.js";

const FILES: Array<{ name: string; cats: Category[]; title: string }> = [
  { name: "AI_GENERAL.md", cats: ["llms", "industry"], title: "AI 全般" },
  { name: "AI_AGENTS.md", cats: ["agents"], title: "AI Agents" },
  { name: "AI_BUSINESS.md", cats: ["biz"], title: "AI × ビジネス" },
  { name: "AI_DINING.md", cats: ["dining"], title: "AI × 飲食" },
  { name: "PSYCHOLOGY.md", cats: ["mind"], title: "心理・NLP" },
  { name: "BODY_HEALTH.md", cats: ["body"], title: "からだ・健康" },
  { name: "TRENDS.md", cats: ["trends"], title: "トレンド" },
  { name: "OPENSOURCE.md", cats: ["opensource", "tools"], title: "OSS / 道具" },
];

function bullet(e: CatalogEntry): string {
  const t = glanceOf(e);
  return `- [${t}](${e.canonical_url || e.url})`;
}

export async function runPersistentNotebook(
  config: AppConfig,
  catalog?: CatalogEntry[],
): Promise<{ dir: string; files: string[] }> {
  const all = catalog ?? (await loadCatalog(config.dataRoot));
  const recent = sortByRecency(all);
  const dir = path.join(config.dataRoot, "notebook", "persistent");
  await mkdir(dir, { recursive: true });
  const files: string[] = [];
  for (const spec of FILES) {
    const file = path.join(dir, spec.name);
    let prev = "";
    try {
      prev = await readFile(file, "utf8");
    } catch {
      prev = `# ${spec.title}\n\n永続ソース。NotebookLM に一度登録して更新し続ける。\n\n`;
    }
    const have = new Set(
      [...prev.matchAll(/\((https?:\/\/[^)]+)\)/g)].map((m) => m[1]),
    );
    const add = recent
      .filter((e) => spec.cats.includes(e.category))
      .slice(0, 40)
      .filter((e) => !have.has(e.url) && !have.has(e.canonical_url || ""))
      .slice(0, 12)
      .map(bullet);
    if (add.length) {
      prev = prev.trimEnd() + `\n\n## 追記 ${new Date().toISOString().slice(0, 10)}\n\n` + add.join("\n") + "\n";
      await writeFile(file, prev, "utf8");
    }
    files.push(file);
  }
  const bridge = resolveBridgeRoot(config);
  const out = path.join(bridge, "notebook", "PERSISTENT");
  await mkdir(out, { recursive: true });
  for (const f of files) {
    const dest = path.join(out, path.basename(f));
    try {
      const { copyFile } = await import("node:fs/promises");
      await copyFile(f, dest);
    } catch {
      // bridge 未接続でも HDD 側は残す
    }
  }
  return { dir, files };
}
