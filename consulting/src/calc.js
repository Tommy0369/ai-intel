// 計算ロジック（画面から独立した純粋関数）。
// 方針: 欠測は null のまま扱いゼロにしない／分母0は「計算不可」／前後比較だけで因果を断定しない。

/** 空文字・null・undefined・NaN を欠測とみなす。0 は観測値。 */
export function isMissing(v) {
  return v === null || v === undefined || v === "" || (typeof v === "number" && Number.isNaN(v));
}

/** 文字列や数値を数値へ。欠測は null を返す（0 にしない）。 */
export function toNum(v) {
  if (isMissing(v)) return null;
  const n = typeof v === "number" ? v : Number(String(v).replace(/[,，円¥\s]/g, ""));
  return Number.isFinite(n) ? n : null;
}

/** a ÷ b。どちらかが欠測、または b が 0 のときは null。 */
export function safeDiv(a, b) {
  const x = toNum(a);
  const y = toNum(b);
  if (x === null || y === null || y === 0) return null;
  return x / y;
}

export const PERIODS = { day: "日", week: "週", month: "月", year: "年" };
const PER_YEAR = { day: 365, week: 52, month: 12, year: 1 };

/** 金額を期間換算する（例: 月額→年額）。日・週と月の換算は概算。 */
export function convertPeriod(amount, from, to) {
  const x = toNum(amount);
  if (x === null) return null;
  if (!PER_YEAR[from] || !PER_YEAR[to]) throw new Error(`unknown period: ${from} → ${to}`);
  return (x * PER_YEAR[from]) / PER_YEAR[to];
}

/** 原価と目標粗利率から売価: P = C / (1 − g)。g は 0 以上 1 未満。 */
export function priceFromMargin(cost, margin) {
  const c = toNum(cost);
  const g = toNum(margin);
  if (c === null || g === null || g < 0 || g >= 1) return null;
  return c / (1 - g);
}

/**
 * 価格の倍率を、顧客側（V/P）と自社側（P/C）に分けて計算する。
 * benefit: { low, mid, high } と benefitPeriod、price と pricePeriod、cost と costPeriod。
 * すべて basis 期間（既定は年）にそろえてから比べる。
 */
export function pricingCheck({ benefit = {}, benefitPeriod = "year", price, pricePeriod = "year", cost, costPeriod, basis = "year" }) {
  const warnings = [];
  const notes = [];
  const P = convertPeriod(price, pricePeriod, basis);
  const C = convertPeriod(cost, costPeriod || pricePeriod, basis);
  const V = {};
  for (const k of ["low", "mid", "high"]) V[k] = convertPeriod(benefit[k], benefitPeriod, basis);

  if (benefitPeriod !== pricePeriod) {
    notes.push(`便益（${PERIODS[benefitPeriod]}）と料金（${PERIODS[pricePeriod]}）の期間が違うため、${PERIODS[basis]}あたりに換算して比べた`);
  }
  if (P === null) warnings.push("料金Pが未入力");
  if (C === null) warnings.push("提供原価Cが未入力（自社採算は判定できない）");
  if (V.mid === null) warnings.push("便益V（標準）が未入力");

  const valueMultiple = {};
  for (const k of ["low", "mid", "high"]) valueMultiple[k] = safeDiv(V[k], P);
  const costMultiple = safeDiv(P, C);
  const grossMargin = P !== null && C !== null && P !== 0 ? (P - C) / P : null;

  if (valueMultiple.mid !== null && valueMultiple.mid < 1) warnings.push("標準の便益が料金を下回る（顧客にとって割に合わない可能性）");
  if (valueMultiple.low !== null && valueMultiple.low < 1 && !(valueMultiple.mid < 1)) notes.push("保守的な見積もりでは便益が料金を下回る");
  if (grossMargin !== null && grossMargin <= 0) warnings.push("料金が提供原価以下（赤字）");
  if (V.low !== null && V.high !== null && V.low > V.high) warnings.push("保守の便益が楽観を上回っている");
  notes.push("倍率は採算と割に合う度合いの目安。成果の保証ではない");

  return { basis, V, P, C, valueMultiple, costMultiple, grossMargin, warnings, notes };
}

/** 売上 = 客数 × 平均客単価。どちらか欠測なら null。 */
export function salesOf(customers, avgSpend) {
  const n = toNum(customers);
  const s = toNum(avgSpend);
  if (n === null || s === null) return null;
  return n * s;
}

/**
 * 日次などの系列を、欠測と実ゼロを分けて集計する。
 * values: (number|null|"")[]。0 は「実際にゼロだった日」として平均に含める。
 */
export function seriesStats(values) {
  const nums = values.map(toNum);
  const observed = nums.filter((v) => v !== null);
  const total = observed.reduce((s, v) => s + v, 0);
  const days = values.length;
  const k = observed.length;
  return {
    days,
    observed: k,
    missing: days - k,
    zeros: observed.filter((v) => v === 0).length,
    coverage: days ? k / days : null,
    observedTotal: k ? total : null,
    observedMean: k ? total / k : null,
    // 欠測を0で埋めた誤った平均（比較表示用）
    zeroFilledMean: days ? total / days : null,
    note:
      days - k > 0
        ? `${days}日中${k}日のみ観測。平均は観測できた${k}日が分母で、期間全体の平均ではない。欠測日の代表性は不明`
        : "全日観測",
  };
}

/** 増減率。基準が0なら率は計算不可とし、差だけ返す。 */
export function growthRate(before, after) {
  const b = toNum(before);
  const a = toNum(after);
  if (b === null || a === null) return { rate: null, diff: null, label: "未取得のため計算不可" };
  const diff = a - b;
  if (b === 0) return { rate: null, diff, label: "基準が0のため増減率は計算不可（差で示す）" };
  return { rate: diff / b, diff, label: null };
}

export const CONFOUNDERS = [
  "季節・曜日・天候",
  "客層や対象者の変化",
  "営業日数・期間の長さ",
  "スタッフ・担当者の変化",
  "同時期の販促・値上げ・他施策",
  "測り方や集計定義の変更",
];

/**
 * 導入前後の比較。比較群があれば差の差（DiD）も出す。
 * どの場合も「原因」とは書かず、言える範囲を label に入れる。
 */
export function compareBeforeAfter({ before, after, controlBefore, controlAfter, checkedConfounders = [] }) {
  const main = growthRate(before, after);
  const hasControl = !isMissing(controlBefore) && !isMissing(controlAfter);
  const control = hasControl ? growthRate(controlBefore, controlAfter) : null;
  const did = hasControl && main.diff !== null && control.diff !== null ? main.diff - control.diff : null;
  const unchecked = CONFOUNDERS.filter((c) => !checkedConfounders.includes(c));

  let label;
  if (main.diff === null) label = "データ不足のため判断できない";
  else if (!hasControl) label = "前後で変化が見られた。比較群がないため原因は未確定（関連の段階）";
  else label = "比較群との差が見られた。交絡の確認と再現が済むまで効果は断定しない";

  const cautions = [];
  if (unchecked.length) cautions.push(`未確認の交絡候補: ${unchecked.join("、")}`);
  if (!hasControl) cautions.push("同じ期間に施策をしていない比較群（店舗・担当・曜日など）を用意すると解釈が強くなる");
  return { main, control, did, hasControl, label, cautions, causalClaim: false };
}

export function fmtNum(n, digits = 0) {
  if (n === null || n === undefined || Number.isNaN(n)) return "—";
  return n.toLocaleString("ja-JP", { maximumFractionDigits: digits, minimumFractionDigits: 0 });
}

export function fmtYen(n) {
  return n === null || n === undefined ? "—" : `${fmtNum(Math.round(n))}円`;
}

export function fmtPct(r, digits = 1) {
  return r === null || r === undefined ? "—" : `${fmtNum(r * 100, digits)}%`;
}

export function fmtTimes(r, digits = 2) {
  return r === null || r === undefined ? "—" : `${fmtNum(r, digits)}倍`;
}
