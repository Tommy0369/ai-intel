import { test } from "node:test";
import assert from "node:assert/strict";
import {
  compareBeforeAfter,
  convertPeriod,
  growthRate,
  priceFromMargin,
  pricingCheck,
  salesOf,
  seriesStats,
  toNum,
} from "../src/calc.js";

test("価格: 顧客便益倍率 V/P と原価倍率 P/C を取り違えない", () => {
  const r = pricingCheck({ benefit: { low: 30, mid: 60, high: 90 }, price: 20, cost: 8 });
  assert.equal(r.valueMultiple.mid, 3); // 60 / 20
  assert.equal(r.costMultiple, 2.5); // 20 / 8
  assert.equal(r.grossMargin, 0.6); // (20 - 8) / 20
  assert.notEqual(r.valueMultiple.mid, r.costMultiple);
});

test("価格: 年間便益と月額料金は同じ期間にそろえてから比べる", () => {
  const r = pricingCheck({ benefit: { mid: 360000 }, benefitPeriod: "year", price: 10000, pricePeriod: "month", cost: 4000 });
  assert.equal(r.P, 120000);
  assert.equal(r.C, 48000);
  assert.equal(r.valueMultiple.mid, 3); // 年36万 ÷ 年12万（月1万をそのまま割ると36倍になる誤り）
  assert.ok(r.notes.some((n) => n.includes("換算")));
});

test("価格: 便益が料金を下回る・赤字を警告する", () => {
  const r = pricingCheck({ benefit: { mid: 10 }, price: 20, cost: 25 });
  assert.ok(r.warnings.some((w) => w.includes("下回る")));
  assert.ok(r.warnings.some((w) => w.includes("赤字")));
});

test("価格: 未入力は0として計算しない", () => {
  const r = pricingCheck({ benefit: { mid: "" }, price: 20, cost: "" });
  assert.equal(r.valueMultiple.mid, null);
  assert.equal(r.costMultiple, null);
  assert.equal(r.grossMargin, null);
  assert.ok(r.warnings.some((w) => w.includes("未入力")));
});

test("価格: P = C / (1 − g)", () => {
  assert.equal(priceFromMargin(60000, 0.4), 100000);
  assert.equal(priceFromMargin(60000, 1), null);
  assert.equal(priceFromMargin(60000, -0.1), null);
});

test("期間換算", () => {
  assert.equal(convertPeriod(1000, "month", "year"), 12000);
  assert.equal(convertPeriod("", "month", "year"), null);
});

test("売上 = 客数 × 客単価、欠測があれば計算しない", () => {
  assert.equal(salesOf(120, 2500), 300000);
  assert.equal(salesOf(null, 2500), null);
});

test("欠測: 欠測をゼロにせず、観測日の平均と全期間を区別する", () => {
  // 7日間のうち2日は取得失敗（null / 空文字）、1日は実際に来客ゼロ
  const r = seriesStats([10, 20, null, 0, "", 30, 40]);
  assert.equal(r.days, 7);
  assert.equal(r.observed, 5);
  assert.equal(r.missing, 2);
  assert.equal(r.zeros, 1);
  assert.equal(r.observedTotal, 100);
  assert.equal(r.observedMean, 20); // 100 / 5（実ゼロの日は含める）
  assert.ok(Math.abs(r.zeroFilledMean - 100 / 7) < 1e-9); // 欠測を0で埋めた誤った平均
  assert.notEqual(r.observedMean, r.zeroFilledMean);
  assert.match(r.note, /期間全体の平均ではない/);
});

test("欠測: 文字の数値は読むが、空は0にしない", () => {
  assert.equal(toNum("1,200"), 1200);
  assert.equal(toNum("0"), 0);
  assert.equal(toNum(""), null);
  assert.equal(toNum(undefined), null);
});

test("増減率: 基準が0なら率は計算不可で差だけ返す", () => {
  const g = growthRate(0, 5);
  assert.equal(g.rate, null);
  assert.equal(g.diff, 5);
  assert.match(g.label, /計算不可/);
  assert.equal(growthRate(100, 120).rate, 0.2);
  assert.equal(growthRate(null, 120).rate, null);
});

test("因果: 比較群なしの前後比較では原因と断定しない", () => {
  const r = compareBeforeAfter({ before: 45, after: 30 });
  assert.equal(r.causalClaim, false);
  assert.equal(r.hasControl, false);
  assert.match(r.label, /原因は未確定/);
  assert.ok(r.cautions.some((c) => c.includes("交絡")));
});

test("因果: 比較群があれば差の差を出すが、効果は断定しない", () => {
  const r = compareBeforeAfter({ before: 100, after: 130, controlBefore: 100, controlAfter: 110 });
  assert.equal(r.did, 20);
  assert.equal(r.causalClaim, false);
  assert.match(r.label, /断定しない/);
});

test("因果: データ不足なら判断できないと返す", () => {
  const r = compareBeforeAfter({ before: 45, after: "" });
  assert.match(r.label, /判断できない/);
});
