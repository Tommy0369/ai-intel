// src/ と data/ を1つのHTMLにまとめる。
//   dist/index.html    … そのままブラウザで開ける完全なHTML（ローカル用）
//   dist/artifact.html … <html>/<head>/<body> を含まない断片（claude.ai Artifact 用）
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(path.join(root, p), "utf8");
const readJson = (p) => JSON.parse(read(p));

const outline = readJson("data/outline.json");
const cards = [];
const missing = [];
for (const ch of outline.chapters) {
  const file = `data/knowledge/${ch.id}.json`;
  if (!existsSync(path.join(root, file))) {
    missing.push(ch.id);
    continue;
  }
  for (const c of readJson(file)) cards.push(c);
}

const docs = {};
const skillDir = "skill/remake-consulting-skill";
const docFiles = {
  SKILL: `${skillDir}/SKILL.md`,
  workflow: `${skillDir}/references/workflow.md`,
  playbook: `${skillDir}/references/playbook.md`,
  templates: `${skillDir}/references/templates.md`,
  examples: `${skillDir}/references/examples.md`,
  corrections: `${skillDir}/references/corrections.md`,
  "video-map": `${skillDir}/references/video-map.md`,
  sources: `${skillDir}/references/sources.md`,
  HANDOFF: "skill/HANDOFF.md",
};
for (const [k, p] of Object.entries(docFiles)) if (existsSync(path.join(root, p))) docs[k] = read(p);

const data = {
  builtAt: new Date().toISOString(),
  outline,
  cards,
  sources: readJson("data/sources.json"),
  drills: readJson("data/drills.json"),
  docs,
};

// ES モジュールを1つのスクリプトへ（import 行と export キーワードを外して即時関数で包む）
const modules = ["src/calc.js", "src/session.js", "src/app.js"];
const seen = new Map();
const parts = modules.map((m) => {
  const src = read(m)
    .replace(/^import\s[\s\S]*?;\s*$/gm, "")
    .replace(/^export\s+(?=(async\s+)?function|const|let|class)/gm, "");
  for (const [, name] of src.matchAll(/^(?:const|let|function|class)\s+([A-Za-z_$][\w$]*)/gm)) {
    if (seen.has(name)) throw new Error(`トップレベル名の重複: ${name}（${seen.get(name)} と ${m}）`);
    seen.set(name, m);
  }
  return `// ---- ${m}\n${src}`;
});
const script = `(() => {\n"use strict";\n${parts.join("\n")}\n})();`;

const json = JSON.stringify(data).replace(/</g, "\\u003c");
const fragment = read("src/index.html")
  .replace("/*STYLE*/", () => read("src/styles.css"))
  .replace("/*DATA*/", () => json)
  .replace("/*SCRIPT*/", () => script.replace(/<\/script/gi, "<\\/script"));

const full = `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
${fragment.split("<header")[0].trim()}
</head>
<body>
<header${fragment.split("<header").slice(1).join("<header")}
</body>
</html>
`;

mkdirSync(path.join(root, "dist"), { recursive: true });
writeFileSync(path.join(root, "dist/artifact.html"), fragment);
writeFileSync(path.join(root, "dist/index.html"), full);
const kb = (s) => `${Math.round(Buffer.byteLength(s) / 1024)}KB`;
console.log(`cards=${cards.length}/333 drills=${data.drills.length} docs=${Object.keys(docs).length} → dist/index.html (${kb(full)}), dist/artifact.html`);
if (missing.length) console.log(`未作成の章: ${missing.join(" ")}`);
