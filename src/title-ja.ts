import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { CatalogEntry, Category } from "./types.js";

const CAT_JA: Record<Category, string> = {
  llms: "AIモデル",
  agents: "AIエージェント",
  tools: "AI道具",
  research: "研究",
  industry: "産業AI",
  opensource: "OSS",
  multimodal: "画像・動画AI",
  safety: "AI安全",
  trends: "トレンド",
  mind: "心理",
  body: "からだ",
  dining: "飲食",
  biz: "ビジネス",
  reviews: "レビュー文献",
  other: "その他",
};

/** 全文置換（長い句優先） */
const FULL_PHRASES: Array<[RegExp, string]> = [
  [
    /your coding agent bill doubled\.?\s*here'?s how to fix it\.?/i,
    "コーディングAIの請求が倍になった理由と抑え方",
  ],
  [
    /improving agents is a data mining problem/i,
    "エージェント改善はデータ分析の問題",
  ],
  [
    /tuning the harness,? not the model:?.*nemotron.*/i,
    "モデル本体より足場（ハーネス）を調整するNemotronの話",
  ],
  [
    /high volume vs high intensity:?\s*which builds more muscle\??/i,
    "筋トレは「量」と「強度」どっちが筋肥大に効く？",
  ],
  [/agent evaluation readiness checklist/i, "エージェント評価の準備チェックリスト"],
  [/agent observability:?.*monitor.*/i, "本番エージェントの監視と評価のやり方"],
  [/prompt caching with deep agents/i, "ディープエージェントのプロンプトキャッシュ"],
];

const HINTS: Record<Category, Array<[RegExp, string]>> = {
  dining: [
    [/buy|bought|acquire|stake|merger|invest/i, "買収・出資の動き"],
    [/menu|cuisine|dish|recipe|chef/i, "メニュー・料理の話題"],
    [/labor|wage|staff|hiring|employee|worker/i, "人材・人件費の話題"],
    [/delivery|uber|doordash|grubhub|takeout/i, "配達・テイクアウトの話題"],
    [/sales|revenue|traffic|customer|guest/i, "売上・集客の話題"],
    [/inspect|mold|health|safety|hygiene|violation/i, "衛生・食品安全の話題"],
    [/patio|outdoor|seat/i, "テラス・席まわりの話題"],
    [/franchise|chain|open(ing|s)?|reopen|return/i, "出店・再開・チェーンの話題"],
    [/trend|2026|forecast/i, "外食トレンドの話題"],
  ],
  biz: [
    [/pricing|price|mrr|arr|revenue/i, "価格・売上の話"],
    [/funnel|conversion|lead|acquisition|cac/i, "集客・ファネルの話"],
    [/brand|personal brand|position/i, "ブランド・立ち位置の話"],
    [/content|seo|social media|sns/i, "コンテンツ・SNS運用の話"],
    [/sales|pitch|close|crm/i, "営業・販売の話"],
    [/entrepreneur|startup|solopreneur|indie|bootstrapp?/i, "起業・個人事業の話"],
    [/marketing|grow(th)?|gtm/i, "マーケ・成長の話"],
    [/マーケ|集客|起業|個人事業|副業|経営/i, "経営・マーケの話題"],
  ],
  trends: [
    [/show hn/i, "新しいプロダクト紹介"],
    [/wearable|tracker|gadget/i, "ガジェット・ウェアラブル"],
    [/startup|raises?|funding|valuation/i, "スタートアップ・資金調達"],
    [/launch|release|ship/i, "新サービス公開"],
    [/ai|llm|agent/i, "AI関連の新潮流"],
  ],
  mind: [
    [/gambl|loot box/i, "ギャンブル・課金行動の研究"],
    [/brain|neuro|scan/i, "脳・神経の研究"],
    [/habit|nudge|bias|behav/i, "習慣・行動・バイアスの話"],
    [/sleep|tv|screen|passive/i, "生活習慣と心への影響"],
    [/discuss(ion)? thread/i, "コミュニティの雑談スレ"],
    [/psycholog|mental|emotion/i, "心理・メンタルの話題"],
  ],
  body: [
    [/sleep|nap|all.?nighter|insomnia/i, "睡眠の話"],
    [/volume|intensity|hypertrophy|muscle|lift/i, "筋トレ・筋肥大の話"],
    [/protein|leucine|nutrition|diet|oil|calorie/i, "栄養・食事の話"],
    [/breath|hrv|recovery|cardio/i, "呼吸・回復・有酸素の話"],
    [/workout|fitness|exercise|train/i, "運動・トレーニングの話"],
  ],
  reviews: [
    [/systematic review/i, "システマティックレビュー"],
    [/meta[- ]?analysis/i, "メタアナリシス"],
    [/scoping review/i, "スコーピングレビュー"],
    [/narrative review|literature review|umbrella review/i, "レビュー論文"],
    [/sleep|insomnia|circadian/i, "睡眠まわりのレビュー"],
    [/exercise|training|hypertrophy|physical activity/i, "運動まわりのレビュー"],
    [/nutrition|protein|diet|fasting/i, "栄養まわりのレビュー"],
    [/habit|psych|behav|anxiet|mindful/i, "心理・習慣のレビュー"],
    [/llm|language model|artificial intelligence|machine learning/i, "AIまわりのレビュー"],
    [/entrepreneur|marketing|pricing|consumer/i, "事業・マーケのレビュー"],
    [/restaurant|food.?service|hospitality/i, "飲食・食のレビュー"],
  ],
  agents: [
    [/harness|scaffold/i, "エージェントの足場・運用設計"],
    [/cost|bill|price|token/i, "エージェント利用コストの話"],
    [/eval|benchmark|observ/i, "エージェント評価・監視の話"],
    [/multi.?agent|orchestr/i, "複数エージェント連携の話"],
    [/tool.?use|autonomous/i, "ツール利用・自律実行の話"],
  ],
  llms: [
    [/gpt|claude|gemini|llama|mistral/i, "主要モデルの話題"],
    [/fine.?tun|train|infer/i, "学習・推論の話題"],
    [/release|announce|launch/i, "モデル発表・更新"],
  ],
  tools: [
    [/rag|retriev|embed/i, "検索・RAGの道具"],
    [/sdk|framework|api|cursor/i, "開発ツール・SDK"],
    [/benchmark|eval/i, "評価ツールの話題"],
  ],
  research: [
    [/paper|arxiv|preprint|study|dataset/i, "研究・論文の話題"],
  ],
  industry: [
    [/funding|raise|acquire|partner/i, "企業・提携・資金の動き"],
    [/release|launch|announce|chip/i, "製品・インフラ発表"],
  ],
  opensource: [
    [/github|open.?source|release|star/i, "OSSの公開・更新"],
  ],
  multimodal: [
    [/image|video|audio|vision|diffusion/i, "画像・動画・音声AI"],
  ],
  safety: [
    [/align|jailbreak|risk|secur|guard/i, "安全・リスク・ガードレール"],
  ],
  other: [[/.*/i, "その他の話題"]],
};

function hasMuchJapanese(s: string): boolean {
  const jp = (s.match(/[\u3040-\u30ff\u4e00-\u9fff]/g) || []).length;
  return jp >= 6;
}

function clip(s: string, n: number): string {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length <= n ? t : `${t.slice(0, n - 1)}…`;
}

function tidy(s: string): string {
  return s.replace(/\s+/g, " ").replace(/\s*([:：])\s*/g, "$1").trim();
}

function stripNoise(title: string): string {
  return title
    .replace(/^RT by @[^:]+:\s*/i, "")
    .replace(/^R to @[^:]+:\s*/i, "")
    .replace(/^Show HN:\s*/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

function hintFor(category: Category, title: string): string {
  const rules = HINTS[category] ?? HINTS.other;
  for (const [re, hint] of rules) {
    if (re.test(title)) return hint;
  }
  return `${CAT_JA[category]}の話題`;
}

/** 一眼でわかる日本語タイトル */
export function toGlanceTitle(
  entry: Pick<CatalogEntry, "title" | "category" | "source">,
): string {
  const cat = CAT_JA[entry.category] ?? entry.category;
  const raw = stripNoise(entry.title);

  // すでに日本語が十分ある記事（国内ニュースなど）
  if (hasMuchJapanese(raw)) {
    return `【${cat}】${clip(raw.replace(/^【[^】]+】\s*/, ""), 48)}`;
  }

  // 既知の定番タイトルは全文日本語化
  for (const [re, ja] of FULL_PHRASES) {
    if (re.test(raw)) return `【${cat}】${ja}`;
  }

  const hint = hintFor(entry.category, raw);
  // 固有名詞っぽい先頭を少し残して識別しやすくする
  const anchor = clip(
    raw
      .replace(/https?:\/\/\S+/g, "")
      .replace(/\[[^\]]*\]/g, "")
      .trim(),
    34,
  );

  let body = `${hint} — ${anchor}`;
  if (entry.source === "youtube") body += "（動画題名）";
  if (entry.source === "x") body += "（短文）";
  if (entry.source === "reddit") body += "（掲示板）";

  return `【${cat}】${tidy(body)}`;
}

export async function loadTitleJaMap(dataRoot: string): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  try {
    const raw = await readFile(path.join(dataRoot, "state", "title-ja.json"), "utf8");
    const obj = JSON.parse(raw) as Record<string, string>;
    for (const [k, v] of Object.entries(obj)) map.set(k, v);
  } catch {
    // none
  }
  return map;
}

export async function rebuildTitleJaMap(
  dataRoot: string,
  entries: CatalogEntry[],
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  for (const e of entries) map.set(e.id, toGlanceTitle(e));
  await mkdir(path.join(dataRoot, "state"), { recursive: true });
  await writeFile(
    path.join(dataRoot, "state", "title-ja.json"),
    JSON.stringify(Object.fromEntries(map)),
    "utf8",
  );
  return map;
}

export function glanceOf(
  entry: CatalogEntry,
  map?: Map<string, string>,
): string {
  // マップ（最新辞書）を優先。旧 title_ja より新しいルールを効かせる
  if (map?.has(entry.id)) return map.get(entry.id)!;
  if (entry.title_ja?.trim()) return entry.title_ja.trim();
  return toGlanceTitle(entry);
}
