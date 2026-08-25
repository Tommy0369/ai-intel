import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { assertDataRootReady, ensureLayout } from "./disk.js";
import { nowIso } from "./http.js";
import {
  loadCatalog,
  pickTop,
  sortByRecency,
  topTags,
} from "./corpus.js";
import type { AppConfig, CatalogEntry, Category } from "./types.js";

interface IdeaSeed {
  id: string;
  title: string;
  why: string;
  category: Category;
  sources: CatalogEntry[];
  buildPrompt: string;
  mvp: string[];
}

const IDEA_TEMPLATES: Array<{
  id: string;
  match: RegExp;
  category: Category;
  title: string;
  why: string;
  mvp: string[];
  buildPrompt: string;
}> = [
  {
    id: "local-agent",
    match: /\bagents?\b|tool.?use|autonomous|langgraph|crewai/i,
    category: "agents",
    title: "個人用オートノマス・エージェント",
    why: "エージェント関連の信号が強い。日常タスクをツール呼び出しで自動化する土台になる。",
    mvp: [
      "1つの目標（例: 朝の情報要約）を入力",
      "Web検索 or コーパス検索のツールを1つ",
      "実行ログを Markdown で保存",
    ],
    buildPrompt:
      "ai-intel の agents / tools コーパスを前提に、ローカルで動く最小エージェントを設計・実装して。外付けHDDの学習メモも読めるようにして。",
  },
  {
    id: "rag-shelf",
    match: /\brag\b|embedding|vector|retriev/i,
    category: "tools",
    title: "AI Intel RAG シェルフ",
    why: "収集コーパスを検索可能にすれば、学習と創造の速度が上がる。",
    mvp: [
      "catalog.jsonl を読む CLI 検索",
      "カテゴリ / タグフィルタ",
      "ヒットした Markdown をまとめて AI に渡すバンドル生成",
    ],
    buildPrompt:
      " /Volumes/外付け320GB/ai-intel を対象に、キーワード検索とバンドル出力（1つの Markdown）を作って。",
  },
  {
    id: "paper-club",
    match: /\bpaper\b|arxiv|preprint|benchmark|reasoning/i,
    category: "research",
    title: "論文クラブ（自動要約 → 実験ノート）",
    why: "研究トラックが厚い。読むだけでなく「何を試すか」まで落とす仕組みが有効。",
    mvp: [
      "research から今週の5本を選ぶ",
      "各論文1枚サマリ（主張/手法/限界）",
      "再現実験アイデアを1つ",
    ],
    buildPrompt:
      "by-category/research の最新から学習用サマリと、個人が週末に試せる実験を設計して。",
  },
  {
    id: "creator-studio",
    match: /\bmultimodal\b|vision|image|video|diffusion|generate/i,
    category: "multimodal",
    title: "マルチモーダル創作スタジオ",
    why: "テキスト以外の生成・理解は、プロダクト体験の差別化につながる。",
    mvp: [
      "テキスト → 画像 or 動画プロンプトパイプライン",
      "生成結果のメタデータ保存",
      "安全チェック（禁止プロンプト）の最小実装",
    ],
    buildPrompt:
      "multimodal / safety の動向を踏まえ、個人が安全に使える創作パイプラインのMVPを提案・実装して。",
  },
  {
    id: "open-remix",
    match: /\bopen.?source\b|github|huggingface|llama|mistral/i,
    category: "opensource",
    title: "OSS リミックス実験場",
    why: "GitHub 上の実装を読み、小さく改造するのが最短の実装学習。",
    mvp: [
      "注目リポジトリを1つ clone",
      "README の Quickstart を通す",
      "自分のユースケース向けに設定を1つ変える",
    ],
    buildPrompt:
      "opensource / github の収集から、改造しやすいリポジトリを1つ選び、改造タスクを具体化して。",
  },
  {
    id: "industry-radar",
    match: /\brelease\b|launch|product|openai|anthropic|gemini/i,
    category: "industry",
    title: "産業レーダー → 週次プロダクト実験",
    why: "製品リリースは、すぐ試せるAPIや新機能のヒントになる。",
    mvp: [
      "industry の今週トップ5",
      "試せるAPI/機能を1つ選ぶ",
      "48時間で動くデモを定義",
    ],
    buildPrompt:
      "industry ダイジェストから、48時間で作れるデモ案を3つ出し、最も簡単なものを実装計画にして。",
  },
];

function matchIdeas(entries: CatalogEntry[]): IdeaSeed[] {
  const recent = sortByRecency(entries).slice(0, 200);
  const ideas: IdeaSeed[] = [];

  for (const tmpl of IDEA_TEMPLATES) {
    const hits = recent.filter(
      (e) =>
        tmpl.match.test(e.title) ||
        (e.tags ?? []).some((t) => tmpl.match.test(t)) ||
        e.category === tmpl.category,
    );
    const sources = pickTop(hits, 5);
    if (sources.length < 2) continue;
    ideas.push({
      id: tmpl.id,
      title: tmpl.title,
      why: tmpl.why,
      category: tmpl.category,
      sources,
      mvp: tmpl.mvp,
      buildPrompt: tmpl.buildPrompt,
    });
  }

  // Always include a meta idea: improve the collector itself
  ideas.push({
    id: "intel-flywheel",
    title: "収集→学習→創造のフライホイール強化",
    why: "情報が増えるほど、学習と創造の質が上がるループを太くする。",
    category: "tools",
    sources: pickTop(recent, 3),
    mvp: [
      "learn / forge を週次で回す",
      "notes に実験結果を残す",
      "うまくいった創造を comic-shelf などに実装",
    ],
    buildPrompt:
      "ai-intel の learn/forge 出力を前提に、来週の創造プロジェクトを1つ選んで実装を開始して。",
  });

  return ideas;
}

function renderIdeas(ideas: IdeaSeed[], tags: Array<{ tag: string; count: number }>): string {
  const lines: string[] = [
    "# Create — AI活用の世界を広げるアイデア",
    "",
    `生成日時: ${nowIso()}`,
    "",
    "収集コーパスの信号から作った、実装可能な創造アイデアです。",
    "Cursor / 他AIに「選んだアイデアの buildPrompt」を渡して実装を始めてください。",
    "",
    "## 使い方",
    "",
    "1. 下から1つ選ぶ",
    "2. 根拠ソースをざっと読む",
    "3. `AIへの実装依頼` をチャットに貼る",
    "4. できたものは `create/projects/<id>/` にメモする",
    "",
  ];

  if (tags.length) {
    lines.push("## いま強いシグナル（タグ）", "");
    lines.push(tags.map((t) => `\`${t.tag}\`(${t.count})`).join(" · "));
    lines.push("");
  }

  for (const idea of ideas) {
    lines.push(`## ${idea.title}`);
    lines.push("");
    lines.push(`- ID: \`${idea.id}\``);
    lines.push(`- カテゴリ: \`${idea.category}\``);
    lines.push(`- なぜ今か: ${idea.why}`);
    lines.push("");
    lines.push("### MVP");
    lines.push("");
    for (const step of idea.mvp) lines.push(`- ${step}`);
    lines.push("");
    lines.push("### 根拠ソース");
    lines.push("");
    for (const s of idea.sources) {
      lines.push(`- [${s.title}](${s.url}) (\`${s.source}\`)`);
    }
    lines.push("");
    lines.push("### AIへの実装依頼");
    lines.push("");
    lines.push("```");
    lines.push(idea.buildPrompt);
    lines.push("```");
    lines.push("");
  }

  lines.push(
    "## 世界を創るための原則",
    "",
    "1. **小さく動くもの**から始める（デモ > 企画書）",
    "2. **収集コーパスを根拠**にする（思いつきだけで終わらせない）",
    "3. **学習メモを残す**（同じ失敗を繰り返さない）",
    "4. **他者にも渡せる形**にする（Markdown / 公開可能な設計）",
    "",
  );

  return lines.join("\n");
}

export async function runForge(config: AppConfig): Promise<{
  ideaCount: number;
  ideasPath: string;
}> {
  await assertDataRootReady(config);
  await ensureLayout(config.dataRoot);

  const entries = await loadCatalog(config.dataRoot);
  if (!entries.length) {
    throw new Error(
      "catalog が空です。先に `npm run collect` を実行してください。",
    );
  }

  const createDir = path.join(config.dataRoot, "create");
  const projectsDir = path.join(createDir, "projects");
  await mkdir(projectsDir, { recursive: true });

  const ideas = matchIdeas(entries);
  const tags = topTags(entries, 12);
  const body = renderIdeas(ideas, tags);
  const ideasPath = path.join(createDir, "IDEAS.md");
  const stamp = new Date().toISOString().slice(0, 10);
  await writeFile(ideasPath, body, "utf8");
  await writeFile(path.join(createDir, `ideas-${stamp}.md`), body, "utf8");

  const projectGuide = [
    "# Projects",
    "",
    "選んだアイデアごとにフォルダを作り、進捗を残してください。",
    "",
    "例: `create/projects/rag-shelf/NOTES.md`",
    "",
  ].join("\n");
  await writeFile(path.join(projectsDir, "README.md"), projectGuide, "utf8");

  return { ideaCount: ideas.length, ideasPath };
}
