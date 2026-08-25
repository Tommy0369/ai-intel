import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { assertDataRootReady, ensureLayout } from "./disk.js";
import { loadCatalog, sortByRecency } from "./corpus.js";
import { nowIso } from "./http.js";
import { glanceOf, rebuildTitleJaMap } from "./title-ja.js";
import type { AppConfig, CatalogEntry } from "./types.js";

export type ReviewKind = "systematic-review" | "meta-analysis" | "review-paper";

const KIND_JA: Record<ReviewKind, { name: string; blurb: string }> = {
  "systematic-review": {
    name: "システマティックレビュー",
    blurb:
      "あるテーマの研究論文を、決められた基準で網羅的に集めて整理・評価するもの",
  },
  "meta-analysis": {
    name: "メタアナリシス",
    blurb:
      "複数の研究結果を統計的にまとめて「全体としてどれくらい効果があるのか」を数値化するもの",
  },
  "review-paper": {
    name: "レビュー論文（叙述・スコープ等）",
    blurb:
      "先行研究を広くまとめて解説する論文。必ずしも厳密な検索・統計処理をするとは限らない",
  },
};

function hay(e: CatalogEntry): string {
  return `${e.title}\n${(e.tags || []).join(" ")}`.toLowerCase();
}

/** タグ／タイトルから3種のどれか（複数可）。優先: SR > MA > review */
export function classifyReviewKinds(e: CatalogEntry): ReviewKind[] {
  const h = hay(e);
  const tags = new Set((e.tags || []).map((t) => t.toLowerCase()));
  const kinds: ReviewKind[] = [];

  if (
    tags.has("systematic-review") ||
    /\bsystematic review\b/.test(h) ||
    /システマティックレビュー/.test(e.title)
  ) {
    kinds.push("systematic-review");
  }
  if (
    tags.has("meta-analysis") ||
    /\bmeta[- ]?analysis\b/.test(h) ||
    /メタアナリシス|メタ分析/.test(e.title)
  ) {
    kinds.push("meta-analysis");
  }
  if (
    tags.has("review-paper") ||
    /\b(scoping|narrative|literature|umbrella|integrative) review\b/.test(h) ||
    /レビュー論文/.test(e.title)
  ) {
    kinds.push("review-paper");
  }

  // レビュー棚だが種別不明 → 広いレビュー扱い
  if (!kinds.length && (e.category === "reviews" || tags.has("review-lit"))) {
    if (/\breview\b/.test(h)) kinds.push("review-paper");
  }

  return kinds;
}

function genreHint(e: CatalogEntry): string {
  const tags = e.tags || [];
  const g = tags.find((t) => t.startsWith("genre:"));
  if (g) {
    const map: Record<string, string> = {
      "genre:body": "からだ",
      "genre:mind": "心理",
      "genre:ai": "AI",
      "genre:biz": "ビジネス",
      "genre:dining": "飲食・食",
      "genre:mixed": "複合",
    };
    return map[g] ?? g.replace("genre:", "");
  }
  const h = hay(e);
  if (/sleep|exercise|nutrition|protein|hypertrophy|diet/.test(h)) return "からだ";
  if (/psych|habit|anxiet|mindful|behav|motivat/.test(h)) return "心理";
  if (/llm|language model|artificial intelligence|machine learning|chatgpt/.test(h))
    return "AI";
  if (/entrepreneur|marketing|pricing|consumer/.test(h)) return "ビジネス";
  if (/restaurant|food.?service|hospitality|ultra-processed/.test(h)) return "飲食・食";
  return "その他";
}

function isReviewEntry(e: CatalogEntry): boolean {
  if (e.category === "reviews") return true;
  if ((e.tags || []).some((t) => /review|meta-analysis|europepmc/i.test(t)))
    return true;
  return classifyReviewKinds(e).length > 0;
}

export interface ReviewsDigestResult {
  total: number;
  byKind: Record<ReviewKind, number>;
  digestPath: string;
  briefPath: string;
}

export async function runReviewsDigest(
  config: AppConfig,
): Promise<ReviewsDigestResult> {
  await assertDataRootReady(config);
  await ensureLayout(config.dataRoot);

  const catalog = await loadCatalog(config.dataRoot);
  const titles = await rebuildTitleJaMap(config.dataRoot, catalog);
  const reviews = sortByRecency(catalog.filter(isReviewEntry));

  const buckets: Record<ReviewKind, CatalogEntry[]> = {
    "systematic-review": [],
    "meta-analysis": [],
    "review-paper": [],
  };
  const seen = new Set<string>();

  for (const e of reviews) {
    const kinds = classifyReviewKinds(e);
    if (!kinds.length) continue;
    for (const k of kinds) {
      // 代表バケットは先頭種別のみ（二重掲載を減らす）
      if (k === kinds[0] && !seen.has(e.id)) {
        buckets[k].push(e);
        seen.add(e.id);
      }
    }
  }

  const outDir = path.join(config.dataRoot, "reviews");
  await mkdir(outDir, { recursive: true });

  const lines: string[] = [
    "# レビュー文献まとめ（システマティック / メタ / レビュー）",
    "",
    `生成: ${nowIso()}`,
    `対象: ${seen.size} 件（コーパス内のレビュー系）`,
    "",
    "## 用語の見分け方",
    "",
    `| 種類 | 意味 |`,
    `|------|------|`,
    ...(["systematic-review", "meta-analysis", "review-paper"] as ReviewKind[]).map(
      (k) => `| **${KIND_JA[k].name}** | ${KIND_JA[k].blurb} |`,
    ),
    "",
    "> 1本の論文が「システマティックレビュー＋メタアナリシス」のこともある。その場合は系統レビュー側に載せている。",
    "",
  ];

  for (const k of ["systematic-review", "meta-analysis", "review-paper"] as ReviewKind[]) {
    const list = buckets[k].slice(0, 40);
    lines.push(`## ${KIND_JA[k].name}（${buckets[k].length}件）`);
    lines.push("");
    lines.push(KIND_JA[k].blurb);
    lines.push("");
    if (!list.length) {
      lines.push("_まだ該当なし。`npm run collect` で Europe PMC / arXiv を取りに行く。_");
      lines.push("");
      continue;
    }
    for (const e of list) {
      const ja = glanceOf(e, titles);
      const genre = genreHint(e);
      const kinds = classifyReviewKinds(e);
      const kindMarks = kinds
        .map((x) =>
          x === "systematic-review" ? "SR" : x === "meta-analysis" ? "MA" : "Rev",
        )
        .join("+");
      lines.push(`- **${ja}**`);
      lines.push(`  - 分野: ${genre} · 種別: ${kindMarks} · \`${e.source}\``);
      lines.push(`  - 原文: ${e.title}`);
      lines.push(`  - ${e.url}`);
      lines.push("");
    }
  }

  lines.push("## ジャンル別の見方", "");
  lines.push(
    "からだ（睡眠・運動・栄養）・心理・AI・ビジネス・飲食は、収集クエリで寄せている。",
  );
  lines.push(
    "実務に使うときは **SR/MA を優先**し、叙述レビューは地図・用語整理用に分けるとよい。",
  );
  lines.push("");

  const digestPath = path.join(outDir, "DIGEST.md");
  const briefPath = path.join(outDir, "BRIEF.md");
  await writeFile(digestPath, lines.join("\n"), "utf8");

  const brief = [
    "# レビュー文献・一眼ブリーフ",
    "",
    `生成: ${nowIso()}`,
    "",
    `- システマティックレビュー: ${buckets["systematic-review"].length} 件`,
    `- メタアナリシス（代表）: ${buckets["meta-analysis"].length} 件`,
    `- レビュー論文: ${buckets["review-paper"].length} 件`,
    "",
    "## いま押さえる3本",
    "",
  ];
  const picks = [
    ...buckets["systematic-review"].slice(0, 1),
    ...buckets["meta-analysis"].slice(0, 1),
    ...buckets["review-paper"].slice(0, 1),
  ];
  if (!picks.length) {
    brief.push("_収集後にここに出る。_");
  } else {
    for (const e of picks) {
      brief.push(`- ${glanceOf(e, titles)}`);
      brief.push(`  ${e.url}`);
    }
  }
  brief.push("", `詳細: \`${digestPath}\``, "");
  await writeFile(briefPath, brief.join("\n"), "utf8");

  return {
    total: seen.size,
    byKind: {
      "systematic-review": buckets["systematic-review"].length,
      "meta-analysis": buckets["meta-analysis"].length,
      "review-paper": buckets["review-paper"].length,
    },
    digestPath,
    briefPath,
  };
}
