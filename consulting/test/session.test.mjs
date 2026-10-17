import { test } from "node:test";
import assert from "node:assert/strict";
import {
  allMarkdown,
  dueLabel,
  issueSentence,
  memoMarkdown,
  missingInfo,
  newSession,
  ownerLabel,
  planMarkdown,
  proposalMarkdown,
  sampleSession,
  smallestStep,
} from "../src/session.js";

test("担当・期限: 空は未定、未合意は（案）", () => {
  assert.equal(ownerLabel({ owner: "", agreed: false }), "未定");
  assert.equal(ownerLabel({ owner: "Bさん", agreed: false }), "Bさん（案）");
  assert.equal(ownerLabel({ owner: "Bさん", agreed: true }), "Bさん");
  assert.equal(dueLabel({ due: "", agreed: true }), "未定");
  assert.equal(dueLabel({ due: "金曜", agreed: false }), "金曜（案）");
});

test("課題の一文: 空欄は未定のまま残し、目標を勝手に確定しない", () => {
  const t = issueSentence({ target: "見積作成", deadline: "", metric: "作成時間", goal: "", constraint: "", decision: "最初の改善策" });
  assert.match(t, /［未定：期限］/);
  assert.match(t, /目標は未定（まず測定）/);
});

test("不足情報: 新しい相談では主要な不足が出る", () => {
  const m = missingInfo(newSession()).map((x) => x.text);
  assert.ok(m.includes("今日決めたいことが未入力"));
  assert.ok(m.includes("事実が1件もない"));
  assert.ok(m.includes("比較する実行案がない（現状維持と比べる）"));
  assert.ok(m.includes("今日できる最小の一手が未記入"));
});

test("不足情報: 担当未定・未合意を検出する", () => {
  const s = sampleSession();
  const m = missingInfo(s).map((x) => x.text);
  assert.ok(m.some((t) => t.includes("担当が未定")));
  assert.ok(m.some((t) => t.includes("未合意（案）")));
});

test("入力の訂正が出力に反映される", () => {
  const s = sampleSession();
  s.actions[0].owner = "Cさん";
  s.actions[0].agreed = false;
  const md = planMarkdown(s);
  assert.match(md, /Cさん（案）/);
  assert.doesNotMatch(md, /\| Bさん \|/);
});

test("出力: サンプルである旨と最小の一手が必ず入る", () => {
  const s = sampleSession();
  for (const md of [memoMarkdown(s), proposalMarkdown(s), planMarkdown(s)]) {
    assert.match(md, /サンプル（架空の相談データ）/);
  }
  assert.match(allMarkdown(s), /今日できる最小の一手/);
});

test("出力: 未取得の実績は0ではなく未取得と書く", () => {
  const s = sampleSession();
  s.review[0].after = "";
  assert.match(planMarkdown(s), /\| 45 \| 未取得 \|/);
});

test("最小の一手: 未記入なら提案として返す", () => {
  const s = newSession();
  const st = smallestStep(s);
  assert.equal(st.suggested, true);
  s.nextStep = "記録表を作る";
  assert.deepEqual(smallestStep(s), { text: "記録表を作る", suggested: false });
});

test("表のセルに | や改行が入っても崩れない", () => {
  const s = newSession();
  s.actions.push({ id: "a1", what: "A|B\nC", owner: "", due: "", done: "", measure: "", agreed: false, status: "todo" });
  const row = planMarkdown(s).split("\n").find((l) => l.startsWith("| A"));
  assert.equal(row.split("|").length, 8);
});
