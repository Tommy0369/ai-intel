// skill/remake-consulting-skill/references/sources.md → data/sources.json
// 出典台帳を機械可読にする。確認状態は台帳の記載どおりで、ここで格上げしない。
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const refDir = path.join(root, "skill/remake-consulting-skill/references");
const md = readFileSync(path.join(refDir, "sources.md"), "utf8");
const corrections = readFileSync(path.join(refDir, "corrections.md"), "utf8");

const groups = [];
const sources = [];
let group = null;
for (const line of md.split("\n")) {
  const g = line.match(/^## ([A-M])\. (.+)$/);
  if (g) {
    group = { id: g[1], title: g[2] };
    groups.push(group);
    continue;
  }
  if (line.startsWith("## NotebookLM")) group = null;
  const s = line.match(/^(\d+)\. \[(.+)\]\((https?:\/\/[^)]+)\)$/);
  if (s && group) {
    sources.push({ id: Number(s[1]), group: group.id, label: s[2], url: s[3] });
  }
}

const videos = [];
for (const line of md.split("\n")) {
  const v = line.match(/^\| (\d+) \| (\d+) \| (.+?) \| (.+?) \|$/);
  if (v) videos.push({ summaryNo: Number(v[1]), sourceId: Number(v[2]), title: v[3], topic: v[4] });
}
for (const v of videos) {
  const s = sources.find((x) => x.id === v.sourceId);
  if (s) s.videoTitle = v.title;
}

// corrections.md の一次資料（スキル作成時に監査された資料）
const primary = [];
for (const m of corrections.matchAll(/^(\d)\. (.+?)：(.+)\n(https?:\/\/\S+)/gm)) {
  primary.push({ no: Number(m[1]), label: m[2], note: m[3], url: m[4] });
}

const out = {
  note:
    "ユーザー提供『コンサルをする側の知識108選』の転記。URL・要約の確認状態は提供資料の申告であり、本ツールで原文を読了・再検証したものではない。",
  groups,
  sources,
  primary,
  missingVideo: { sourceId: 78, note: "35件の要約見出しに対応が見当たらない。内容は創作で補完しない。" },
};
if (sources.length !== 108) throw new Error(`sources: expected 108, got ${sources.length}`);
writeFileSync(path.join(root, "data/sources.json"), JSON.stringify(out, null, 1) + "\n");
console.log(`sources=${sources.length} groups=${groups.length} videos=${videos.length} primary=${primary.length}`);
