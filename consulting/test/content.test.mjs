import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { loadChapter, validateChapter } from "../scripts/validate.mjs";

const outline = JSON.parse(readFileSync(new URL("../data/outline.json", import.meta.url), "utf8"));
const drills = JSON.parse(readFileSync(new URL("../data/drills.json", import.meta.url), "utf8"));
const sources = JSON.parse(readFileSync(new URL("../data/sources.json", import.meta.url), "utf8"));

test("目次: 13章・333項目・タイトル重複なし・4段階", () => {
  assert.equal(outline.chapters.length, 13);
  const items = outline.chapters.flatMap((c) => c.items);
  assert.equal(items.length, 333);
  assert.equal(new Set(items.map((i) => i.id)).size, 333);
  assert.equal(new Set(items.map((i) => i.title)).size, 333);
  for (const lv of [1, 2, 3, 4]) assert.ok(items.some((i) => i.level === lv));
});

test("知識カード: 全章が目次どおりで、検証エラーがない", () => {
  let total = 0;
  for (const ch of outline.chapters) {
    const items = loadChapter(ch.id);
    assert.ok(items, `${ch.id} がない`);
    const { errors } = validateChapter(ch, items);
    assert.deepEqual(errors, [], `${ch.id} の検証エラー`);
    total += items.length;
  }
  assert.equal(total, 333);
});

test("知識カード: クイズの問いが重複しない", () => {
  const qs = outline.chapters.flatMap((ch) => loadChapter(ch.id) || []).map((c) => c.quiz.q);
  assert.equal(new Set(qs).size, qs.length);
});

test("誤り探しドリル: 4択・正解位置が範囲内・選択肢の重複なし", () => {
  assert.ok(drills.length >= 12);
  for (const d of drills) {
    assert.equal(d.choices.length, 4, d.id);
    assert.equal(new Set(d.choices).size, 4, d.id);
    assert.ok(Number.isInteger(d.answer) && d.answer >= 0 && d.answer <= 3, d.id);
  }
});

test("出典台帳: 108件で番号が連続している", () => {
  assert.equal(sources.sources.length, 108);
  sources.sources.forEach((s, i) => assert.equal(s.id, i + 1));
});
