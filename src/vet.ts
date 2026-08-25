import { mkdir, writeFile, readFile, appendFile } from "node:fs/promises";
import path from "node:path";
import { assertDataRootReady, ensureLayout } from "./disk.js";
import { nowIso } from "./http.js";
import { loadCatalog, sortByRecency } from "./corpus.js";
import type { AppConfig, CatalogEntry, SourceKind } from "./types.js";

export type VetVerdict = "hold" | "pass" | "watch" | "reject";

export interface VetRecord {
  id: string;
  title: string;
  url: string;
  category: string;
  source: SourceKind;
  firstSeenAt: string;
  reviewUntil: string;
  freshnessScore: number;
  credibilityScore: number;
  overallScore: number;
  verdict: VetVerdict;
  reasons: string[];
  flags: string[];
  ageHours: number | null;
  vettedAt: string;
}

/** 出典の信憑性ベース点（知識テーブル） */
const SOURCE_TRUST: Record<SourceKind, number> = {
  arxiv: 85,
  europepmc: 88,
  docs: 78,
  github: 70,
  rss: 62,
  youtube: 48,
  reddit: 35,
  x: 30,
};

/** ドメイン別の上乗せ／減点（知っている媒体） */
const DOMAIN_ADJUST: Array<{ re: RegExp; delta: number; label: string }> = [
  { re: /arxiv\.org/i, delta: 10, label: "査読前でも研究プレプリント" },
  { re: /pubmed\.ncbi\.nlm\.nih\.gov|doi\.org|europepmc\.org/i, delta: 12, label: "論文データベース（PubMed/DOI）" },
  { re: /langchain\.com|openai\.com|anthropic\.com|deepmind|pytorch\.org/i, delta: 12, label: "一次情報に近い公式/開発者ブログ" },
  { re: /behavioralscientist\.org|digest\.bps\.org|strongerbyscience\.com|examine\.com/i, delta: 10, label: "分野の信頼メディア" },
  { re: /sciencedaily\.com/i, delta: 2, label: "二次要約（元論文確認推奨）" },
  { re: /techcrunch\.com|theverge\.com|marktechpost\.com/i, delta: 4, label: "テック報道（速報寄り）" },
  { re: /news\.google\.com/i, delta: -5, label: "集約ニュース（元記事へ当たる）" },
  { re: /reddit\.com/i, delta: -15, label: "掲示板・個人意見が混ざる" },
  { re: /nitter\.|twitter\.com|x\.com/i, delta: -18, label: "短文SNS・RT混入" },
  { re: /youtube\.com|youtu\.be/i, delta: -8, label: "動画はタイトルのみ収集" },
  { re: /producthunt\.com/i, delta: 0, label: "新着プロダクト信号（未検証が多い）" },
];

const HYPE_RE =
  /\b(miracle|cure|guaranteed|secret|you won't believe|breakthrough!!!|100%|never fail)\b|絶対|奇跡|必ず稼|完全攻略/i;

function parseTime(s?: string): number | null {
  if (!s) return null;
  const t = Date.parse(s);
  return Number.isFinite(t) ? t : null;
}

function freshnessScore(entry: CatalogEntry, now: number): {
  score: number;
  ageHours: number | null;
  reasons: string[];
} {
  const reasons: string[] = [];
  const pub = parseTime(entry.published_at);
  const col = parseTime(entry.collected_at);
  const ts = pub ?? col;
  if (ts == null) {
    reasons.push("日時不明のため新鮮さは低めに見る");
    return { score: 40, ageHours: null, reasons };
  }
  const ageHours = (now - ts) / 3_600_000;
  let score = 100;
  if (ageHours <= 24) {
    score = 95;
    reasons.push("24時間以内 → 鮮度高い");
  } else if (ageHours <= 72) {
    score = 85;
    reasons.push("3日以内 → 新しい");
  } else if (ageHours <= 168) {
    score = 70;
    reasons.push("1週間以内");
  } else if (ageHours <= 720) {
    score = 50;
    reasons.push("1ヶ月以内（背景知識向き）");
  } else if (ageHours <= 2160) {
    score = 30;
    reasons.push("数ヶ月前 — 『最新』とは言わない");
  } else {
    score = 15;
    reasons.push("古い情報 — トレンド発信には不向き");
  }
  if (pub == null && col != null) {
    score = Math.max(10, score - 10);
    reasons.push("公開日不明（収集日のみ）");
  }
  return { score, ageHours, reasons };
}

function credibilityScore(entry: CatalogEntry): {
  score: number;
  reasons: string[];
  flags: string[];
} {
  const reasons: string[] = [];
  const flags: string[] = [];
  let score = SOURCE_TRUST[entry.source] ?? 40;
  reasons.push(`出典種別 ${entry.source} の基準点 ${SOURCE_TRUST[entry.source]}`);

  for (const d of DOMAIN_ADJUST) {
    if (d.re.test(entry.url) || d.re.test(entry.title)) {
      score += d.delta;
      reasons.push(`${d.label}（${d.delta >= 0 ? "+" : ""}${d.delta}）`);
    }
  }

  const hay = `${entry.title}`;
  if (HYPE_RE.test(hay)) {
    score -= 20;
    flags.push("煽り表現");
    reasons.push("煽り・断定表現あり → 信憑性ダウン");
  }
  if (/^RT by |^R to /i.test(entry.title)) {
    score -= 10;
    flags.push("RT/返信");
    reasons.push("RT・返信タイトル → 一次情報か要確認");
  }
  if (!entry.url || entry.url.length < 12) {
    score -= 25;
    flags.push("URL弱い");
    reasons.push("URLが弱い");
  }
  // ビジネス棚は健康・心理クレームに厳しめ
  if (
    (entry.category === "body" || entry.category === "mind") &&
    /\b(cure|treats? cancer|lose \d+ pounds)\b|治る|痩せる/i.test(hay)
  ) {
    score -= 15;
    flags.push("医療・効果の強い主張");
    reasons.push("健康・効果の強い主張 → 精査必須");
  }

  score = Math.max(0, Math.min(100, score));
  return { score, reasons, flags };
}

function decideVerdict(
  freshness: number,
  credibility: number,
  flags: string[],
  ageHours: number | null,
): { verdict: VetVerdict; overall: number; extra: string[] } {
  const overall = Math.round(freshness * 0.4 + credibility * 0.6);
  const extra: string[] = [];

  if (flags.includes("医療・効果の強い主張") && credibility < 70) {
    return { verdict: "reject", overall, extra: ["強い健康主張かつ信頼点が足りない"] };
  }
  if (credibility < 35) {
    return { verdict: "reject", overall, extra: ["信憑性が低すぎる"] };
  }
  if (overall >= 70 && credibility >= 55 && (ageHours == null || ageHours <= 720)) {
    return { verdict: "pass", overall, extra: ["鮮度・信憑性とも出荷候補"] };
  }
  if (overall >= 50 || freshness >= 70) {
    return { verdict: "watch", overall, extra: ["使えるが精査期間中に再確認"] };
  }
  return { verdict: "hold", overall, extra: ["精査期間で様子見"] };
}

export function vetEntry(
  entry: CatalogEntry,
  opts: { reviewHours: number; now?: number },
): VetRecord {
  const now = opts.now ?? Date.now();
  const fresh = freshnessScore(entry, now);
  const cred = credibilityScore(entry);
  const { verdict, overall, extra } = decideVerdict(
    fresh.score,
    cred.score,
    cred.flags,
    fresh.ageHours,
  );
  const firstSeen = entry.collected_at || nowIso();
  const reviewUntil = new Date(
    now + opts.reviewHours * 3_600_000,
  ).toISOString();

  // 精査期間中は原則 hold/watch（passでも期間未了なら ship 側で待つ）
  return {
    id: entry.id,
    title: entry.title,
    url: entry.url,
    category: entry.category,
    source: entry.source,
    firstSeenAt: firstSeen,
    reviewUntil,
    freshnessScore: fresh.score,
    credibilityScore: cred.score,
    overallScore: overall,
    verdict,
    reasons: [...fresh.reasons, ...cred.reasons, ...extra],
    flags: cred.flags,
    ageHours:
      fresh.ageHours == null ? null : Math.round(fresh.ageHours * 10) / 10,
    vettedAt: new Date(now).toISOString(),
  };
}

/** 精査期間が明け、かつ reject でないもの */
export function isShipEligible(rec: VetRecord, now = Date.now()): boolean {
  if (rec.verdict === "reject") return false;
  if (Date.parse(rec.reviewUntil) > now) return false;
  return rec.verdict === "pass" || rec.verdict === "watch";
}

export async function runVet(
  config: AppConfig,
  opts?: { limit?: number; reviewHours?: number },
): Promise<{
  records: VetRecord[];
  reportPath: string;
  ledgerPath: string;
  counts: Record<VetVerdict, number>;
}> {
  await assertDataRootReady(config);
  await ensureLayout(config.dataRoot);

  const reviewHours =
    opts?.reviewHours ??
    (config as AppConfig & { vetReviewHours?: number }).vetReviewHours ??
    24;
  const limit = opts?.limit ?? 200;

  const vetRoot = path.join(config.dataRoot, "vet");
  await mkdir(path.join(vetRoot, "quarantine"), { recursive: true });
  await mkdir(path.join(vetRoot, "cleared"), { recursive: true });

  const catalog = await loadCatalog(config.dataRoot);
  const focus = sortByRecency(catalog).slice(0, limit);
  const records = focus.map((e) => vetEntry(e, { reviewHours }));

  const counts: Record<VetVerdict, number> = {
    hold: 0,
    pass: 0,
    watch: 0,
    reject: 0,
  };
  for (const r of records) counts[r.verdict]++;

  const ledgerPath = path.join(vetRoot, "ledger.jsonl");
  await writeFile(
    ledgerPath,
    records.map((r) => JSON.stringify(r)).join("\n") + "\n",
    "utf8",
  );

  // 精査中 / 通過の振り分けメモ
  const holding = records.filter((r) => !isShipEligible(r));
  const cleared = records.filter((r) => isShipEligible(r));
  await writeFile(
    path.join(vetRoot, "quarantine", "HOLDING.md"),
    [
      `# 精査中（quarantine）`,
      "",
      `精査期間: 収集から約 **${reviewHours}時間**`,
      `件数: ${holding.length}`,
      "",
      ...holding.slice(0, 40).map(
        (r) =>
          `- [${r.verdict}] ${r.title.slice(0, 70)}\n  - 鮮度${r.freshnessScore} / 信頼${r.credibilityScore} / 総合${r.overallScore}\n  - 解除目安: ${r.reviewUntil}\n  - ${r.url}`,
      ),
      "",
    ].join("\n"),
    "utf8",
  );
  await writeFile(
    path.join(vetRoot, "cleared", "CLEARED.md"),
    [
      `# 精査通過（出荷候補）`,
      "",
      `件数: ${cleared.length}`,
      "",
      ...cleared.slice(0, 40).map(
        (r) =>
          `- [${r.verdict}] ${r.title.slice(0, 70)}\n  - 鮮度${r.freshnessScore} / 信頼${r.credibilityScore}\n  - ${r.url}`,
      ),
      "",
    ].join("\n"),
    "utf8",
  );

  const reportPath = path.join(vetRoot, "REPORT.md");
  await writeFile(
    path.join(vetRoot, "KNOWLEDGE.md"),
    `# 鮮度・信憑性の知識（精査ルール）

更新: ${nowIso()}

## 新鮮さ（freshness）

| 経過 | 見方 |
|------|------|
| 24h以内 | 最新に近い |
| 3日 | 新しい |
| 1週間 | まだ使える |
| 1ヶ月 | 背景知識 |
| それ以上 | 『最新』とは言わない |

## 信憑性（credibility）

出典の基準点: arxiv > docs > github > rss > youtube > reddit > x

上乗せ: 公式ブログ、BPS、Stronger by Science、Examine など  
減点: Reddit、X/RT、煽り表現、強い医療効果の主張、Google News集約

## 判定

- **pass**: 出荷候補（ただし精査期間が明けるまで待つ）
- **watch**: 使えるが再確認
- **hold**: 期間中は様子見
- **reject**: 出荷しない

## 精査期間

いまの設定: **${reviewHours}時間**（\`config.vetReviewHours\`）
この間は intel-bridge へ「確定ネタ」として急がない。信号の収集は続ける。
`,
    "utf8",
  );

  await writeFile(
    reportPath,
    [
      `# Vet Report — 鮮度・信憑性精査`,
      "",
      `生成: ${nowIso()}`,
      `精査期間: **${reviewHours}時間**`,
      `対象: 最新 ${records.length} 件`,
      "",
      "## 集計",
      "",
      `| 判定 | 件数 |`,
      `|------|------|`,
      `| pass | ${counts.pass} |`,
      `| watch | ${counts.watch} |`,
      `| hold | ${counts.hold} |`,
      `| reject | ${counts.reject} |`,
      "",
      `精査期間明け出荷候補: **${cleared.length}**`,
      `まだ待機: **${holding.length}**`,
      "",
      "## 見方",
      "",
      "- 知識の正本: `vet/KNOWLEDGE.md`",
      "- 待機リスト: `vet/quarantine/HOLDING.md`",
      "- 通過リスト: `vet/cleared/CLEARED.md`",
      "- 機械用: `vet/ledger.jsonl`",
      "",
      "## 上位（総合点）",
      "",
      ...[...records]
        .sort((a, b) => b.overallScore - a.overallScore)
        .slice(0, 15)
        .map(
          (r) =>
            `- **${r.overallScore}** [${r.verdict}] ${r.title.slice(0, 60)} (鮮度${r.freshnessScore}/信頼${r.credibilityScore})`,
        ),
      "",
    ].join("\n"),
    "utf8",
  );

  // 履歴追記
  await appendFile(
    path.join(vetRoot, "history.jsonl"),
    JSON.stringify({
      at: nowIso(),
      reviewHours,
      counts,
      cleared: cleared.length,
      holding: holding.length,
    }) + "\n",
    "utf8",
  );

  return { records, reportPath, ledgerPath, counts };
}

export async function loadVetLedger(
  dataRoot: string,
): Promise<Map<string, VetRecord>> {
  const map = new Map<string, VetRecord>();
  try {
    const raw = await readFile(path.join(dataRoot, "vet", "ledger.jsonl"), "utf8");
    for (const line of raw.split("\n")) {
      if (!line.trim()) continue;
      const r = JSON.parse(line) as VetRecord;
      map.set(r.id, r);
    }
  } catch {
    // none
  }
  return map;
}
