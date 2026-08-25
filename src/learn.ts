import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { assertDataRootReady, ensureLayout } from "./disk.js";
import { nowIso } from "./http.js";
import {
  countByCategory,
  loadCatalog,
  pickTop,
  sortByRecency,
  topTags,
} from "./corpus.js";
import type { AppConfig, CatalogEntry, Category } from "./types.js";
import { CATEGORIES } from "./types.js";

const TRACK_HELP: Record<Category, { title: string; goal: string; ask: string }> = {
  llms: {
    title: "基盤モデルを理解する",
    goal: "主要LLMの違い・強み・限界を説明できる",
    ask: "この資料群から、今押さえるべきモデルと技術トレンドを3つに要約して",
  },
  agents: {
    title: "エージェントを設計する",
    goal: "ツール使用・自律ループ・失敗時の回復を設計できる",
    ask: "エージェント実装の共通パターンと落とし穴を抽出して",
  },
  tools: {
    title: "道具を使いこなす",
    goal: "RAG / SDK / 開発ツールを実務に組み込める",
    ask: "今すぐ試せるツールと、導入優先度を提案して",
  },
  research: {
    title: "研究の最前線を読む",
    goal: "論文の主張・実験・限界を批判的に読める",
    ask: "初心者が読むべき論文を難易度順に5本選んで要点を教えて",
  },
  industry: {
    title: "産業の動きを追う",
    goal: "製品発表から機会とリスクを読み取れる",
    ask: "今週の業界ニュースから、個人開発者が動くべき機会を挙げて",
  },
  opensource: {
    title: "実装を読む・書く",
    goal: "有力リポジトリをクローンして改造できる",
    ask: "学習・改造に最適なOSSを選び、最初の実験手順を書いて",
  },
  multimodal: {
    title: "マルチモーダルを扱う",
    goal: "画像・音声・動画を含むAI体験を設計できる",
    ask: "テキスト以外の入力/出力で作れるプロダクト案を3つ",
  },
  safety: {
    title: "安全に使う",
    goal: "リスク・ガバナンス・責任ある利用を説明できる",
    ask: "安全面で必ず入れるチェックリストを作って",
  },
  trends: {
    title: "先のトレンドを拾う",
    goal: "これから来る商品・話題・市場信号をSNSで語れる形にできる",
    ask: "trends から『今言うと早い』話題を3つ選び、わからない人向けにたとえ話付きで説明して",
  },
  mind: {
    title: "心と行動を理解する",
    goal: "心理・行動経済・NLPの知見を、AI×運動ビジネスに写せる",
    ask: "mind の最新から、習慣・動機・説得に使える実験/知見を3つ因数分解して",
  },
  body: {
    title: "身体を整える",
    goal: "運動・睡眠・食事・回復の根拠を、実践と発信に落とせる",
    ask: "body から今日試せる身体プロトコルを1つと、誤解しやすい点を抽出して",
  },
  dining: {
    title: "飲食ビジネスを読む",
    goal: "外食・店舗・メニュー・運営の信号を、事業とSNSに使える形にできる",
    ask: "dining から『店舗が今動くべき』話題を3つ、たとえ話付きで因数分解して",
  },
  biz: {
    title: "事業の型を読む",
    goal: "マーケ・集客・価格・起業の信号を、自分の事業とSNSに写せる",
    ask: "biz から『いま動くべき』経営・マーケの話題を3つ、たとえ話付きで因数分解して",
  },
  reviews: {
    title: "レビュー文献を読む",
    goal: "SR / メタアナリシス / 叙述レビューを見分け、根拠の強さで使える",
    ask: "reviews から SR・メタ・叙述レビューを1つずつ抜き、結論と限界を日本語で要約して",
  },
  other: {
    title: "周辺を広く見る",
    goal: "カテゴリ外の信号も見逃さない",
    ask: "other に入った項目から、再分類すべき重要トピックを見つけて",
  },
};

function linkLine(e: CatalogEntry): string {
  return `- [${e.title}](${e.url}) \`${e.source}\` · \`${e.category}\` · \`${e.path}\``;
}

function buildCurriculum(entries: CatalogEntry[]): string {
  const lines: string[] = [
    "# AI Learning Curriculum",
    "",
    `生成日時: ${nowIso()}`,
    "",
    "コーパスから作った学習トラックです。Cursor や他のAIにこのファイルを渡し、各トラックの「AIへの依頼」を実行してください。",
    "",
    "## 学習の進め方（1日30–60分）",
    "",
    "1. 下の **今日の焦点** を1つ選ぶ",
    "2. リンクを読み / 見て、自分の言葉で3行メモする（`learning/notes/` に追記可）",
    "3. 「AIへの依頼」をチャットに貼り、理解を深める",
    "4. 理解できたら `npm run forge` で創造アイデアに落とす",
    "",
  ];

  const recent = sortByRecency(entries).slice(0, 40);
  const focusPool = pickTop(recent, 12);
  lines.push("## 今日の焦点（高シグナル）", "");
  for (const e of focusPool) lines.push(linkLine(e));
  lines.push("");

  const counts = countByCategory(entries);
  lines.push("## カテゴリ別トラック", "");

  for (const cat of CATEGORIES) {
    if (counts[cat] === 0) continue;
    const meta = TRACK_HELP[cat];
    const catItems = pickTop(
      entries.filter((e) => e.category === cat),
      8,
    );
    lines.push(`### ${cat} — ${meta.title}`);
    lines.push("");
    lines.push(`- 目標: ${meta.goal}`);
    lines.push(`- コーパス件数: ${counts[cat]}`);
    lines.push(`- AIへの依頼: 「${meta.ask}」`);
    lines.push("");
    for (const e of catItems) lines.push(linkLine(e));
    lines.push("");
  }

  const tags = topTags(entries, 15);
  if (tags.length) {
    lines.push("## 頻出タグ（学習キーワード）", "");
    lines.push(tags.map((t) => `\`${t.tag}\`(${t.count})`).join(" · "));
    lines.push("");
  }

  lines.push(
    "## 他AIへの渡し方",
    "",
    "1. このファイル + `catalog.jsonl` を渡す",
    "2. 「今日の焦点から、私向けの60分レッスンを作って。演習付きで」と依頼",
    "3. 理解後は `create/IDEAS.md`（`npm run forge`）で実装アイデアへ",
    "",
  );

  return lines.join("\n");
}

function buildDailyDigest(entries: CatalogEntry[]): string {
  const recent = sortByRecency(entries).slice(0, 25);
  const byCat = countByCategory(recent);
  const lines = [
    "# Daily AI Digest",
    "",
    `生成日時: ${nowIso()}`,
    "",
    "最近の収集から作った短い学習ダイジェストです。",
    "",
    "## 分布（直近）",
    "",
  ];
  for (const cat of CATEGORIES) {
    if (byCat[cat] > 0) lines.push(`- ${cat}: ${byCat[cat]}`);
  }
  lines.push("", "## 読む順番（推奨）", "");
  for (const e of pickTop(recent, 10)) {
    lines.push(linkLine(e));
  }
  lines.push(
    "",
    "## 5分振り返りプロンプト",
    "",
    "「上の10件を前提に、今日覚えるべき概念を3つ、明日試す実験を1つ提案して」",
    "",
  );
  return lines.join("\n");
}

export async function runLearn(config: AppConfig): Promise<{
  total: number;
  curriculumPath: string;
  digestPath: string;
}> {
  await assertDataRootReady(config);
  await ensureLayout(config.dataRoot);

  const entries = await loadCatalog(config.dataRoot);
  if (!entries.length) {
    throw new Error(
      "catalog が空です。先に `npm run collect` を実行してください。",
    );
  }

  const learningDir = path.join(config.dataRoot, "learning");
  const notesDir = path.join(learningDir, "notes");
  await mkdir(notesDir, { recursive: true });

  const curriculum = buildCurriculum(entries);
  const digest = buildDailyDigest(entries);
  const stamp = new Date().toISOString().slice(0, 10);

  const curriculumPath = path.join(learningDir, "CURRICULUM.md");
  const digestPath = path.join(learningDir, "DIGEST.md");
  const archivePath = path.join(learningDir, `digest-${stamp}.md`);

  await writeFile(curriculumPath, curriculum, "utf8");
  await writeFile(digestPath, digest, "utf8");
  await writeFile(archivePath, digest, "utf8");

  const notesGuide = [
    "# Learning Notes",
    "",
    "ここに自分の言葉でメモを書いてください。AIに渡すときはこのフォルダも一緒に。",
    "",
    "## テンプレ",
    "",
    "### YYYY-MM-DD",
    "",
    "- 読んだもの:",
    "- 理解したこと（3行）:",
    "- まだ曖昧なこと:",
    "- 次に作る / 試す:",
    "",
  ].join("\n");
  await writeFile(path.join(notesDir, "README.md"), notesGuide, "utf8");

  return { total: entries.length, curriculumPath, digestPath };
}
