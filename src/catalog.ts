import { writeFile } from "node:fs/promises";
import path from "node:path";
import { CATEGORIES, SOURCES } from "./types.js";

const CATEGORY_HELP: Record<(typeof CATEGORIES)[number], string> = {
  llms: "大規模言語モデル、基盤モデル、学習・推論手法",
  agents: "エージェント、ツール使用、マルチエージェント",
  tools: "フレームワーク、SDK、RAG、開発ツール",
  research: "論文・研究プレプリント",
  industry: "製品発表、企業ニュース、リリース",
  opensource: "オープンソース実装・リポジトリ",
  multimodal: "画像・音声・動画を含むマルチモーダル",
  safety: "アライメント、安全性、ガバナンス",
  trends: "先読みトレンド・新商品・市場信号（SNS発信向き）",
  mind: "心理・行動経済・NLP・人間の心と行動",
  body: "運動・健康・トレーニング・栄養・睡眠・回復",
  dining: "飲食ビジネス・外食・店舗運営・フードサービス",
  biz: "経営・マーケ・集客・起業・個人事業（飲食以外の事業全般）",
  reviews:
    "システマティックレビュー / メタアナリシス / レビュー論文（分野横断）",
  other: "上記に当てはまらないもの",
};

export async function writeIndexMd(
  dataRoot: string,
  stats?: { total?: number; lastRun?: string },
): Promise<void> {
  const lines = [
    "# AI Intel Corpus",
    "",
    "AI関連情報のポータブル収集コーパスです。埋め込みDBに依存せず、Markdown + `catalog.jsonl` だけで他のAI/ツールに渡せます。",
    "",
    "## 使い方（他AI向け）",
    "",
    "1. このフォルダ全体、または `catalog.jsonl` + 必要な `by-category/` を渡す",
    "2. 学習は `learning/CURRICULUM.md` / `DIGEST.md`、創造は `create/IDEAS.md`",
    "3. **全件活用パック**は `ready/`（`PROMPT.md` / `ALL.md` / `bundles/`）",
    "4. 全体の進め方は `PLAYBOOK.md`",
    "5. 各ファイルの YAML frontmatter に `title` / `url` / `category` / `source` がある",
    "6. YouTube はタイトルと URL のみ（動画本体・字幕なし）",
    "",
    "## レイアウト",
    "",
    "- `catalog.jsonl` — 1行1件の機械可読インデックス",
    "- `by-category/<category>/` — カテゴリ別 Markdown",
    "- `by-source/<source>/` — ソース別 Markdown（同一内容のコピー）",
    "- `ready/` — 全件読込済みの活用パック（AIに渡す用）",
    "- `daily/` — 毎朝の最新・融合・イマジネーション",
    "- `learning/` — カリキュラム・ダイジェスト・メモ",
    "- `create/` — 創造アイデア・プロジェクトメモ",
    "- `PLAYBOOK.md` — 毎朝9時の想像エンジン手順",
    "- `state/` — 重複排除・最終実行メタ",
    "",
    "## カテゴリ",
    "",
  ];

  for (const c of CATEGORIES) {
    lines.push(`- **${c}**: ${CATEGORY_HELP[c]}`);
  }

  lines.push("", "## ソース", "");
  for (const s of SOURCES) {
    lines.push(`- ${s}`);
  }

  if (stats?.total != null || stats?.lastRun) {
    lines.push("", "## 状態", "");
    if (stats.total != null) lines.push(`- 総件数: ${stats.total}`);
    if (stats.lastRun) lines.push(`- 最終収集: ${stats.lastRun}`);
  }

  lines.push(
    "",
    "## catalog.jsonl スキーマ",
    "",
    "```json",
    '{',
    '  "id": "youtube_abc123",',
    '  "title": "...",',
    '  "url": "https://...",',
    '  "source": "youtube",',
    '  "category": "agents",',
    '  "collected_at": "2026-07-12T00:00:00+09:00",',
    '  "published_at": "2026-07-11",',
    '  "tags": ["agents", "youtube"],',
    '  "lang": "en",',
    '  "path": "by-category/agents/....md"',
    "}",
    "```",
    "",
  );

  await writeFile(path.join(dataRoot, "INDEX.md"), lines.join("\n"), "utf8");
}
