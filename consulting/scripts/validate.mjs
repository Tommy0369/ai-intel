// 知識カード（data/knowledge/*.json）を目次（data/outline.json）と照合する。
// 使い方: node scripts/validate.mjs [C01 C02 ...]   引数なしなら全章
// 終了コード: エラーがあれば 1。警告は表示のみ。
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outline = JSON.parse(readFileSync(path.join(root, "data/outline.json"), "utf8"));
const ledger = JSON.parse(readFileSync(path.join(root, "data/sources.json"), "utf8"));

const SKILL_FILES = ["SKILL", "workflow", "playbook", "templates", "examples", "corrections", "sources", "video-map"];
const allowedUrls = new Set([...ledger.sources.map((s) => s.url), ...ledger.primary.map((p) => p.url)]);

// 内容上の禁止事項（HANDOFF.md・corrections.md の重要ルール）
const FORBIDDEN = [
  [/花園神社/, "実在の可能性がある店舗名は使わない（架空名にする）"],
  [/最低\s*20\s*万円|20万円以上/, "一律の価格下限を書かない"],
  [/(効果|成果|売上|成功)を?(必ず|確実に)|必ず(儲|成功|売れ|上が)/, "成果を保証する表現"],
  [/保証(します|できます|される)/, "保証の断定"],
  [/(納品|納期)を?(わざと|意図的に)遅ら(せ|す)(る|ます|ましょう)/, "意図的な納品遅延を推奨しない"],
  [/NLPで(治|改善す|変わ)/, "NLPの治療効果を示唆しない"],
];

const LEN = {
  summary: [30, 220],
  point: [6, 90],
  step: [6, 110],
  pitfall: [15, 180],
  example: [20, 220],
  q: [8, 160],
  choice: [1, 90],
  explain: [10, 200],
};

function len(s) {
  return [...s].length;
}

export function validateChapter(chapter, items) {
  const errors = [];
  const warnings = [];
  const err = (id, msg) => errors.push(`${id}: ${msg}`);
  const warn = (id, msg) => warnings.push(`${id}: ${msg}`);

  if (!Array.isArray(items)) {
    err(chapter.id, "配列ではない");
    return { errors, warnings };
  }
  if (items.length !== chapter.items.length) {
    err(chapter.id, `件数 ${items.length}（目次は ${chapter.items.length}）`);
  }
  chapter.items.forEach((o, i) => {
    const it = items[i];
    if (!it) return;
    const id = o.id;
    if (it.id !== o.id) err(id, `id 不一致: ${it.id}`);
    if (it.title !== o.title) err(id, `title 不一致: ${it.title}`);
    if (it.level !== o.level) err(id, `level 不一致: ${it.level}`);
    const str = (k, v, [min, max]) => {
      if (typeof v !== "string" || !v.trim()) return err(id, `${k} が空`);
      const n = len(v);
      if (n < min || n > max) warn(id, `${k} の長さ ${n}（目安 ${min}〜${max}）`);
    };
    str("summary", it.summary, LEN.summary);
    if (!Array.isArray(it.points) || it.points.length < 2 || it.points.length > 4) err(id, "points は2〜4件");
    else it.points.forEach((p, j) => str(`points[${j}]`, p, LEN.point));
    if (!Array.isArray(it.howto) || it.howto.length < 2 || it.howto.length > 5) err(id, "howto は2〜5件");
    else it.howto.forEach((p, j) => str(`howto[${j}]`, p, LEN.step));
    str("pitfall", it.pitfall, LEN.pitfall);
    str("example", it.example, LEN.example);
    const q = it.quiz;
    if (!q || typeof q !== "object") err(id, "quiz がない");
    else {
      str("quiz.q", q.q, LEN.q);
      if (!Array.isArray(q.choices) || q.choices.length !== 4) err(id, "quiz.choices は4件");
      else {
        q.choices.forEach((c, j) => str(`quiz.choices[${j}]`, c, LEN.choice));
        if (new Set(q.choices).size !== 4) err(id, "quiz.choices が重複");
      }
      if (!Number.isInteger(q.answer) || q.answer < 0 || q.answer > 3) err(id, "quiz.answer は0〜3");
      str("quiz.explain", q.explain, LEN.explain);
    }
    if (!["skill", "general"].includes(it.basis)) err(id, "basis は skill / general");
    if (!Array.isArray(it.tags) || it.tags.length < 1 || it.tags.length > 5) err(id, "tags は1〜5件");
    if (!Array.isArray(it.refs)) err(id, "refs は配列");
    else {
      if (it.basis === "skill" && !it.refs.some((r) => r.kind === "remake" || r.kind === "skill"))
        err(id, "basis=skill なら remake か skill の参照が必要");
      for (const r of it.refs) {
        if (r.kind === "remake") {
          if (!Number.isInteger(r.id) || r.id < 1 || r.id > 108) err(id, `remake id 不正: ${r.id}`);
        } else if (r.kind === "skill") {
          if (!SKILL_FILES.includes(r.file)) err(id, `skill file 不正: ${r.file}`);
        } else if (r.kind === "book") {
          if (typeof r.label !== "string" || !r.label.includes("『")) err(id, "book.label は 著者『書名』 形式");
        } else if (r.kind === "web") {
          if (!allowedUrls.has(r.url)) err(id, `台帳にないURL: ${r.url}`);
        } else err(id, `refs.kind 不正: ${r.kind}`);
      }
    }
    const text = JSON.stringify(it);
    for (const [re, why] of FORBIDDEN) if (re.test(text)) err(id, `禁止表現（${why}）: ${text.match(re)[0]}`);
  });
  return { errors, warnings };
}

/**
 * 選択肢の長さの手がかり。正解だけが最長（または最短）だと、読まずに当てられてしまう。
 * 4択の偶然は25%。章全体で35%を超えたら直す。
 */
export const LENGTH_BIAS_LIMIT = 0.35;
export function lengthBias(items) {
  const longest = [];
  const shortest = [];
  for (const it of items) {
    const q = it.quiz;
    if (!q || !Array.isArray(q.choices) || q.choices.length !== 4) continue;
    const L = q.choices.map(len);
    const mx = Math.max(...L);
    const mn = Math.min(...L);
    if (L[q.answer] === mx && L.filter((x) => x === mx).length === 1) longest.push(it.id);
    if (L[q.answer] === mn && L.filter((x) => x === mn).length === 1) shortest.push(it.id);
  }
  const n = items.length || 1;
  return { longest, shortest, longestRate: longest.length / n, shortestRate: shortest.length / n };
}

export function loadChapter(id) {
  const file = path.join(root, "data/knowledge", `${id}.json`);
  if (!existsSync(file)) return null;
  return JSON.parse(readFileSync(file, "utf8"));
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const want = process.argv.slice(2);
  const chapters = outline.chapters.filter((c) => !want.length || want.includes(c.id));
  let nErr = 0;
  let nWarn = 0;
  let nItems = 0;
  for (const ch of chapters) {
    let items;
    try {
      items = loadChapter(ch.id);
    } catch (e) {
      console.log(`✗ ${ch.id}: JSON 解析エラー ${e.message}`);
      nErr++;
      continue;
    }
    if (!items) {
      console.log(`… ${ch.id}: 未作成`);
      if (want.length) nErr++;
      continue;
    }
    const { errors, warnings } = validateChapter(ch, items);
    const bias = lengthBias(items);
    if (bias.longestRate > LENGTH_BIAS_LIMIT)
      errors.push(`${ch.id}: 正解だけが最長の問題が ${bias.longest.length}/${items.length}（上限${LENGTH_BIAS_LIMIT * 100}%）: ${bias.longest.join(" ")}`);
    if (bias.shortestRate > LENGTH_BIAS_LIMIT)
      errors.push(`${ch.id}: 正解だけが最短の問題が ${bias.shortest.length}/${items.length}（上限${LENGTH_BIAS_LIMIT * 100}%）: ${bias.shortest.join(" ")}`);
    nItems += items.length;
    nErr += errors.length;
    nWarn += warnings.length;
    console.log(`${errors.length ? "✗" : "✓"} ${ch.id} ${ch.title}: ${items.length}件 エラー${errors.length} 警告${warnings.length}`);
    for (const e of errors) console.log("   ERROR " + e);
    for (const w of warnings) console.log("   warn  " + w);
  }
  console.log(`合計 ${nItems}件 / エラー ${nErr} / 警告 ${nWarn}`);
  process.exit(nErr ? 1 : 0);
}
