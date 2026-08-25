import type { CatalogEntry, Category } from "./types.js";
import { CATEGORIES } from "./types.js";

/** Gentner風の構造写像: 表層より関係（ロール）を写す */
export type Role =
  | "problem"
  | "method"
  | "system"
  | "evaluation"
  | "cost"
  | "safety"
  | "artifact"
  | "domain";

export interface StructuredCase {
  entry: CatalogEntry;
  roles: Partial<Record<Role, string>>;
  relation: string;
  tokens: Set<string>;
}

export interface AnalogyMapping {
  id: string;
  score: number;
  depth: "shallow" | "deep";
  source: StructuredCase;
  target: StructuredCase;
  /** 写された関係 */
  mappedRelation: string;
  /** アナロジーの一文 */
  analogy: string;
  /** 新しい領域への適用（想像） */
  transfer: string;
  /** エージェントが取る次アクション */
  agentMove: string;
  buildPrompt: string;
}

const STOP = new Set([
  "the", "and", "for", "with", "from", "this", "that", "https", "com", "org",
  "www", "how", "what", "into", "your", "our", "new", "using", "build",
]);

export function tokensOf(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/https?:\/\/\S+/g, " ")
      .split(/[^a-z0-9\u3040-\u30ff\u4e00-\u9fff+]+/i)
      .filter((t) => t.length >= 3 && !STOP.has(t)),
  );
}

function clip(s: string, n: number): string {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length <= n ? t : `${t.slice(0, n - 1)}…`;
}

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return h;
}

/** タイトルから粗いロール構造を抽出 */
export function structureCase(entry: CatalogEntry): StructuredCase {
  const title = entry.title;
  const lower = title.toLowerCase();
  const roles: Partial<Record<Role, string>> = {
    domain: entry.category,
    artifact: title,
  };

  if (/(eval|benchmark|observ|monitor|checklist|metric)/i.test(lower)) {
    roles.evaluation = "測定・評価";
  }
  if (/(cost|bill|price|cheap|efficient|optim)/i.test(lower)) {
    roles.cost = "コスト最適化";
  }
  if (/(safe|align|jailbreak|off[- ]?switch|security|backdoor|risk)/i.test(lower)) {
    roles.safety = "安全・制御";
  }
  if (/(agent|multi[- ]?agent|orchestr|tool.?use|autonomous)/i.test(lower)) {
    roles.system = "エージェント系";
    roles.method = "ツール使用 / 協調";
  }
  if (/(rag|retriev|embed|vector|search)/i.test(lower)) {
    roles.method = "検索拡張 (RAG)";
  }
  if (/(chip|inferen|nemo|train|fine[- ]?tun|hardware)/i.test(lower)) {
    roles.method = "推論・学習インフラ";
  }
  if (/(world model|diffusion|multimodal|vision|video)/i.test(lower)) {
    roles.method = "マルチモーダル / 世界モデル";
  }
  if (/(fix|improv|accelerat|scale)/i.test(lower)) {
    roles.problem = "性能・速度・規模の課題";
  }
  if (/(launch|introduc|releas|unveil|announc)/i.test(lower)) {
    roles.problem = "新機能の展開";
  }

  if (!roles.method) {
    roles.method =
      entry.category === "research"
        ? "研究的アプローチ"
        : entry.category === "opensource"
          ? "実装・OSS"
          : "プロダクト手法";
  }
  if (!roles.problem) {
    roles.problem = `${entry.category} 領域の課題`;
  }

  const relation = `${roles.problem} —[${roles.method}]→ ${roles.system ?? roles.artifact}`;

  return {
    entry,
    roles,
    relation,
    tokens: tokensOf(`${title} ${(entry.tags ?? []).join(" ")}`),
  };
}

function jaccard(a: Set<string>, b: Set<string>): number {
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  const union = a.size + b.size - inter || 1;
  return inter / union;
}

function roleOverlap(
  a: StructuredCase,
  b: StructuredCase,
): { shared: Role[]; count: number } {
  const shared: Role[] = [];
  for (const role of Object.keys(a.roles) as Role[]) {
    if (role === "artifact" || role === "domain") continue;
    if (a.roles[role] && b.roles[role]) shared.push(role);
  }
  return { shared, count: shared.length };
}

const DOMAIN_TRANSFER: Record<Category, string> = {
  trends: "先読みトレンドをSNSと商品企画へ写す",
  mind: "心理・行動の知見を習慣設計と発信へ写す",
  body: "運動・睡眠・食事の知見を実践プロトコルへ写す",
  dining: "飲食の運営知見をメニュー・接客・集客へ写す",
  biz: "経営・マーケ・集客の知見を事業と発信へ写す",
  reviews: "レビュー文献の結論を、実践プロトコルと発信の根拠へ写す",
  llms: "個人の思考パートナー / コーディング支援",
  agents: "日常を回すオートノマス秘書",
  tools: "comic-shelf / ai-intel の開発ツールチェーン",
  research: "週末実験ラボ（再現可能な小実験）",
  industry: "48時間デモプロダクト",
  opensource: "clone→改造→自分用フォーク",
  multimodal: "創作スタジオ（画像・動画・音）",
  safety: "ガードレール付き実行環境",
  other: "未開拓ニッチのプロトタイプ",
};

/** 深層アナロジーを優先してペアを生成 */
export function findAnalogies(
  focus: CatalogEntry[],
  corpus: CatalogEntry[],
  limit = 12,
): AnalogyMapping[] {
  const focusCases = focus.map(structureCase);
  const pool = corpus
    .filter((c) => !focus.some((f) => f.id === c.id))
    .map(structureCase);

  const out: AnalogyMapping[] = [];

  for (const src of focusCases.slice(0, 50)) {
    let best: { tgt: StructuredCase; score: number; depth: "shallow" | "deep"; shared: Role[] } | null =
      null;

    for (const tgt of pool) {
      const { shared, count } = roleOverlap(src, tgt);
      const surface = jaccard(src.tokens, tgt.tokens);
      const cross =
        src.entry.category !== tgt.entry.category ? 1.8 : 0.2;
      // 深層: ロールが似て表層が違う
      const deepBonus = count >= 2 && surface < 0.25 ? 3.5 : 0;
      const shallowPenalty = surface > 0.45 ? -1.5 : 0;
      const score =
        count * 2.2 + cross + deepBonus + surface * 0.8 + shallowPenalty;

      if (score < 3.2) continue;
      if (!best || score > best.score) {
        best = {
          tgt,
          score,
          depth: deepBonus > 0 ? "deep" : "shallow",
          shared,
        };
      }
    }

    if (!best) continue;

    const tgt = best.tgt;
    const sharedRoles = best.shared.join("·") || "構造的類似";
    const transferDomain = DOMAIN_TRANSFER[tgt.entry.category] ?? DOMAIN_TRANSFER.other;
    const mappedRelation = `${src.roles.problem} を、${tgt.roles.method} のやり方で解く（${sharedRoles} を写像）`;

    const analogy = [
      `【源】${clip(src.entry.title, 70)}`,
      `　構造: ${src.relation}`,
      `【的】${clip(tgt.entry.title, 70)}`,
      `　構造: ${tgt.relation}`,
      `【写像】${mappedRelation}`,
    ].join("\n");

    const transfer = [
      `${src.entry.category} の知見を ${tgt.entry.category} へ移植し、`,
      `最終的に「${transferDomain}」として実装する。`,
      best.depth === "deep"
        ? "（深層アナロジー: 表層は違うが関係構造が一致）"
        : "（表層も近い浅層アナロジー — すぐ試せる）",
    ].join("");

    const agentMove =
      best.depth === "deep"
        ? `クロスドメイン実装: ${src.entry.category}→${tgt.entry.category} の最小ブリッジを1つ作れ`
        : `同系強化: ${tgt.entry.category} で源の method「${src.roles.method}」を再現せよ`;

    const id = `anl_${Math.abs(hash(`${src.entry.id}:${tgt.entry.id}`)).toString(16)}`;

    out.push({
      id,
      score: best.score,
      depth: best.depth,
      source: src,
      target: tgt,
      mappedRelation,
      analogy,
      transfer,
      agentMove,
      buildPrompt: [
        "あなたはアナロジー思考の最強エージェントです。",
        "構造写像（源の関係を的へ写す）で、まだ無いシステムを設計しコードまで書いてください。",
        "",
        analogy,
        "",
        `適用先: ${transfer}`,
        `エージェントの次手: ${agentMove}`,
        "",
        "制約:",
        "- comic-shelf / ai-intel のデータと外付けHDDコーパスを使ってよい",
        "- 小さく動くMVP（CLIまたは1画面）",
        "- 評価指標を1つ定義する（agentsコーパスの evaluation 文化を写せ）",
        "- コストまたは安全のガードを1つ入れよ",
      ].join("\n"),
    });
  }

  out.sort((a, b) => {
    if (a.depth !== b.depth) return a.depth === "deep" ? -1 : 1;
    return b.score - a.score;
  });

  // 多様性: 同じ源は1つまで優先
  const seenSrc = new Set<string>();
  const diverse: AnalogyMapping[] = [];
  for (const m of out) {
    if (seenSrc.has(m.source.entry.id)) continue;
    seenSrc.add(m.source.entry.id);
    diverse.push(m);
    if (diverse.length >= limit) break;
  }
  return diverse;
}

/** レポートテーマ起点の定番アナロジー（人間が強いと認めた型） */
export const SEED_ANALOGIES: Array<{
  id: string;
  name: string;
  sourceDomain: string;
  targetDomain: string;
  mapping: string;
  agentBlueprint: string;
}> = [
  {
    id: "seed_immune",
    name: "免疫系 → エージェント安全",
    sourceDomain: "生物の免疫（自己/非自己・オフスイッチ）",
    targetDomain: "コーディングエージェントの実行権限",
    mapping: "危険知識の off-switch ＝ 危険ツール呼び出しの回路遮断",
    agentBlueprint:
      "ツール実行前に『危険度スコア』を通し、閾値超で人間承認 or 拒否。Anthropic dual-use の発想をローカルに写す。",
  },
  {
    id: "seed_orchestra",
    name: "オーケストラ → マルチエージェント",
    sourceDomain: "指揮者が楽器パートを調整する",
    targetDomain: "research/agent 論文の multi-agent 協調",
    mapping: "指揮者＝オーケストレータ、楽譜＝共有ゴール、奏者＝専門ツール",
    agentBlueprint:
      "観察→アナロジー→計画→実行の4奏者を分け、指揮者エージェントが順序と停止を決める。",
  },
  {
    id: "seed_ledger",
    name: "家計簿 → エージェントコスト",
    sourceDomain: "家計の予算と明細",
    targetDomain: "coding agent bill / LLMトークン",
    mapping: "明細＝ツール呼び出しログ、予算＝1日トークン上限",
    agentBlueprint:
      "毎アクションの推定コストを記録し、日次予算を超えたら要約モードへ縮退。",
  },
  {
    id: "seed_library",
    name: "司書 → RAGコーパス",
    sourceDomain: "司書がレファレンス質問に本を当てる",
    targetDomain: "ai-intel コーパス検索",
    mapping: "質問＝情報要求、書架＝by-category、推薦＝analogy 付き引用",
    agentBlueprint:
      "質問を受けたら catalog を検索し、答えではなく『構造が似た先例』を3つ返す。",
  },
  {
    id: "seed_dojo",
    name: "道場 → 評価ループ",
    sourceDomain: "稽古・型・昇級審査",
    targetDomain: "agent evaluation checklist",
    mapping: "型＝固定シナリオ、昇級＝メトリクス合格",
    agentBlueprint:
      "エージェントに毎回同じ3課題を課し、成功率を state/eval.json に残して進化を測る。",
  },
];

export function categoriesList(): Category[] {
  return [...CATEGORIES];
}
