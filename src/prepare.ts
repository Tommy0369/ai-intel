import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { assertDataRootReady, ensureLayout } from "./disk.js";
import { nowIso } from "./http.js";
import { countByCategory, topTags } from "./corpus.js";
import { readAllItems, type ReadItem } from "./readall.js";
import type { AppConfig, Category } from "./types.js";
import { CATEGORIES, SOURCES } from "./types.js";
import { writePlaybook } from "./playbook.js";
import { runLearn } from "./learn.js";
import { runForge } from "./forge.js";

const BUNDLE_MAX_CHARS = 70_000;

function compactLine(item: ReadItem): string {
  const bits = [
    `- **${item.title}**`,
    `  - URL: ${item.url}`,
    `  - meta: \`${item.source}\` / \`${item.category}\` / \`${item.id}\``,
  ];
  if (item.tags.length) {
    bits.push(`  - tags: ${item.tags.slice(0, 8).join(", ")}`);
  }
  if (item.summary) {
    bits.push(`  - summary: ${item.summary.slice(0, 280)}`);
  } else if (item.source === "youtube") {
    bits.push(`  - summary: (YouTube — タイトルとURLのみ)`);
  }
  return bits.join("\n");
}

function buildOverview(
  items: ReadItem[],
  missingCount: number,
): string {
  const ok = items.filter((i) => i.readOk);
  const byCat = countByCategory(
    ok.map((i) => ({
      id: i.id,
      title: i.title,
      url: i.url,
      source: i.source,
      category: i.category,
      collected_at: i.collectedAt,
      published_at: i.publishedAt,
      tags: i.tags,
      lang: i.lang,
      path: i.path,
    })),
  );
  const bySource: Record<string, number> = {};
  for (const i of ok) {
    bySource[i.source] = (bySource[i.source] ?? 0) + 1;
  }
  const tags = topTags(
    ok.map((i) => ({
      id: i.id,
      title: i.title,
      url: i.url,
      source: i.source,
      category: i.category,
      collected_at: i.collectedAt,
      tags: i.tags,
      lang: i.lang,
      path: i.path,
    })),
    25,
  );

  const lines = [
    "# Corpus Ready — Overview",
    "",
    `生成日時: ${nowIso()}`,
    "",
    "全件を読み込み、活用用パッケージ `ready/` を生成済みです。",
    "",
    "## 読み込み結果",
    "",
    `- 総件数: ${items.length}`,
    `- 読込成功: ${ok.length}`,
    `- 欠落/失敗: ${missingCount}`,
    `- 総文字数: ${ok.reduce((a, b) => a + b.charCount, 0).toLocaleString()}`,
    "",
    "## カテゴリ分布",
    "",
  ];
  for (const c of CATEGORIES) {
    if (byCat[c]) lines.push(`- ${c}: ${byCat[c]}`);
  }
  lines.push("", "## ソース分布", "");
  for (const s of SOURCES) {
    if (bySource[s]) lines.push(`- ${s}: ${bySource[s]}`);
  }
  lines.push("", "## 強いタグ", "");
  lines.push(tags.map((t) => `\`${t.tag}\`(${t.count})`).join(" · "));
  lines.push(
    "",
    "## 活用ファイル",
    "",
    "| ファイル | 用途 |",
    "|---------|------|",
    "| `PROMPT.md` | 他AIにそのまま貼る指示 |",
    "| `ALL.md` | 全件のタイトル+URL+要約一覧 |",
    "| `categories/<cat>.md` | カテゴリ別の全文パック |",
    "| `bundles/part-*.md` | コンテキスト分割済み読込用 |",
    "| `search.jsonl` | 1行検索用インデックス |",
    "| `manifest.json` | 機械可読メタ |",
    "",
    "## 次の一手",
    "",
    "1. `PROMPT.md` を開く",
    "2. 使うAIに `PROMPT.md` + 必要な `bundles/part-*.md` または `categories/*.md` を渡す",
    "3. 実装は `create/IDEAS.md` の buildPrompt へ接続",
    "",
  );
  return lines.join("\n");
}

function buildAllMd(items: ReadItem[]): string {
  const ok = items.filter((i) => i.readOk);
  const lines = [
    "# Full Corpus Listing",
    "",
    `生成日時: ${nowIso()}`,
    `件数: ${ok.length}`,
    "",
    "全件を読んだ結果のコンパクト一覧です（タイトル / URL / 要約）。",
    "",
  ];
  for (const cat of CATEGORIES) {
    const slice = ok.filter((i) => i.category === cat);
    if (!slice.length) continue;
    lines.push(`## ${cat} (${slice.length})`, "");
    for (const item of slice) lines.push(compactLine(item), "");
  }
  return lines.join("\n");
}

function buildCategoryMd(cat: Category, items: ReadItem[]): string {
  const lines = [
    `# Category Pack — ${cat}`,
    "",
    `生成日時: ${nowIso()}`,
    `件数: ${items.length}`,
    "",
    "このカテゴリの収集項目をすべて含みます。学習・実装の根拠として使ってください。",
    "",
  ];
  for (const item of items) {
    lines.push(`## ${item.title}`, "");
    lines.push(`- id: \`${item.id}\``);
    lines.push(`- url: ${item.url}`);
    lines.push(`- source: \`${item.source}\``);
    lines.push(`- path: \`${item.path}\``);
    if (item.publishedAt) lines.push(`- published: ${item.publishedAt}`);
    if (item.tags.length) lines.push(`- tags: ${item.tags.join(", ")}`);
    lines.push("");
    if (item.summary) {
      lines.push(item.summary);
    } else {
      lines.push(item.source === "youtube" ? "_YouTube: タイトルとURLのみ_" : "_要約なし_");
    }
    lines.push("");
  }
  return lines.join("\n");
}

function buildBundles(items: ReadItem[]): string[] {
  const ok = items.filter((i) => i.readOk);
  const bundles: string[] = [];
  let current = "";
  let part = 1;

  const flush = () => {
    if (!current.trim()) return;
    bundles.push(
      [
        `# Corpus Bundle part-${String(part).padStart(2, "0")}`,
        "",
        `生成日時: ${nowIso()}`,
        "",
        "AIコンテキスト用の分割パックです。順番に読んで全体を把握してください。",
        "",
        current.trim(),
        "",
      ].join("\n"),
    );
    part++;
    current = "";
  };

  for (const item of ok) {
    const block = compactLine(item) + "\n\n";
    if (current.length + block.length > BUNDLE_MAX_CHARS && current) {
      flush();
    }
    current += block;
  }
  flush();
  return bundles;
}

function buildPrompt(itemCount: number, bundleCount: number): string {
  return `# AI活用プロンプト（準備済みコーパス）

あなたはAI学習コーチ兼実装パートナーです。
外付けHDD上の AI Intel コーパスを **全件読んだ前提の準備済みパック** を使います。

## 読むファイル（優先順）

1. \`/Volumes/外付け320GB/ai-intel/ready/OVERVIEW.md\`
2. \`/Volumes/外付け320GB/ai-intel/ready/PROMPT.md\`（このファイル）
3. 必要に応じて:
   - 全体俯瞰: \`ready/ALL.md\`
   - 分割読込: \`ready/bundles/part-01.md\` … part-${String(bundleCount).padStart(2, "0")}.md（計 ${bundleCount} 部）
   - カテゴリ深掘り: \`ready/categories/<category>.md\`
4. 創造接続: \`/Volumes/外付け320GB/ai-intel/create/IDEAS.md\`
5. 学習接続: \`/Volumes/外付け320GB/ai-intel/learning/CURRICULUM.md\`

コーパス件数（準備時点）: **${itemCount}**

## やってほしいこと

1. OVERVIEW と bundles（または ALL.md）から、いまのAI世界の地図を日本語で要約する
2. 今後30日で学ぶべきテーマを優先度付きで5つ出す
3. \`create/IDEAS.md\` から、今すぐ実装すべきMVPを1つ選ぶ
4. そのMVPの実装手順を具体化し、コードを書き始める
5. 根拠にはコーパスの URL / id を必ず付ける

## 制約

- YouTube はタイトルとURLのみ（動画内容は推測しすぎない）
- 事実と推論を分ける
- 最初の成果物は小さく動くものにする
`;
}

export interface PrepareResult {
  total: number;
  readOk: number;
  missing: number;
  bundles: number;
  readyRoot: string;
}

export async function runPrepare(
  config: AppConfig,
  opts?: { withLearnForge?: boolean },
): Promise<PrepareResult> {
  await assertDataRootReady(config);
  await ensureLayout(config.dataRoot);

  console.log("▶ reading all corpus items…");
  const { items, missing, catalogTotal } = await readAllItems(config.dataRoot);
  const readOk = items.filter((i) => i.readOk).length;
  console.log(`  catalog=${catalogTotal} readOk=${readOk} missing=${missing.length}`);

  const readyRoot = path.join(config.dataRoot, "ready");
  await rm(readyRoot, { recursive: true, force: true });
  await mkdir(path.join(readyRoot, "categories"), { recursive: true });
  await mkdir(path.join(readyRoot, "bundles"), { recursive: true });

  const overview = buildOverview(items, missing.length);
  const allMd = buildAllMd(items);
  const bundles = buildBundles(items);
  const prompt = buildPrompt(readOk, bundles.length);

  await writeFile(path.join(readyRoot, "OVERVIEW.md"), overview, "utf8");
  await writeFile(path.join(readyRoot, "ALL.md"), allMd, "utf8");
  await writeFile(path.join(readyRoot, "PROMPT.md"), prompt, "utf8");

  for (const cat of CATEGORIES) {
    const slice = items.filter((i) => i.readOk && i.category === cat);
    if (!slice.length) continue;
    await writeFile(
      path.join(readyRoot, "categories", `${cat}.md`),
      buildCategoryMd(cat, slice),
      "utf8",
    );
  }

  for (let i = 0; i < bundles.length; i++) {
    const name = `part-${String(i + 1).padStart(2, "0")}.md`;
    await writeFile(path.join(readyRoot, "bundles", name), bundles[i], "utf8");
  }

  const searchLines = items
    .filter((i) => i.readOk)
    .map((i) =>
      JSON.stringify({
        id: i.id,
        title: i.title,
        url: i.url,
        category: i.category,
        source: i.source,
        tags: i.tags,
        summary: i.summary.slice(0, 300),
        path: i.path,
      }),
    );
  await writeFile(
    path.join(readyRoot, "search.jsonl"),
    searchLines.join("\n") + (searchLines.length ? "\n" : ""),
    "utf8",
  );

  const manifest = {
    generatedAt: nowIso(),
    catalogTotal,
    readOk,
    missing: missing.map((m) => ({ id: m.id, path: m.path })),
    bundleCount: bundles.length,
    categories: Object.fromEntries(
      CATEGORIES.map((c) => [
        c,
        items.filter((i) => i.readOk && i.category === c).length,
      ]),
    ),
    files: {
      overview: "ready/OVERVIEW.md",
      all: "ready/ALL.md",
      prompt: "ready/PROMPT.md",
      search: "ready/search.jsonl",
      categories: "ready/categories/",
      bundles: "ready/bundles/",
    },
  };
  await writeFile(
    path.join(readyRoot, "manifest.json"),
    JSON.stringify(manifest, null, 2) + "\n",
    "utf8",
  );

  if (opts?.withLearnForge !== false) {
    console.log("▶ refresh learn + forge…");
    await runLearn(config);
    await runForge(config);
  }
  await writePlaybook(config.dataRoot);

  return {
    total: catalogTotal,
    readOk,
    missing: missing.length,
    bundles: bundles.length,
    readyRoot,
  };
}
