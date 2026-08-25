import { copyFile, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { assertDataRootReady, ensureLayout } from "./disk.js";
import { nowIso } from "./http.js";
import { resolveBridgeRoot } from "./ship.js";
import type { AppConfig } from "./types.js";
import {
  analyzeCorpus,
  type NotebookAnalysis,
  type NotebookClusterView,
} from "./notebook.js";

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** ごく薄い Markdown → HTML（見出し・リスト・段落・リンク） */
function mdToHtml(md: string): string {
  const lines = md.replace(/\r\n/g, "\n").split("\n");
  const out: string[] = [];
  let inUl = false;
  let inOl = false;
  let inPre = false;
  let para: string[] = [];

  const flushPara = () => {
    if (!para.length) return;
    const text = para.join(" ").trim();
    if (text) out.push(`<p>${inline(text)}</p>`);
    para = [];
  };
  const closeLists = () => {
    if (inUl) {
      out.push("</ul>");
      inUl = false;
    }
    if (inOl) {
      out.push("</ol>");
      inOl = false;
    }
  };
  const inline = (t: string) =>
    esc(t)
      .replace(/`([^`]+)`/g, "<code>$1</code>")
      .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
      .replace(
        /\[([^\]]+)\]\((https?:[^)]+)\)/g,
        '<a href="$2" target="_blank" rel="noopener">$1</a>',
      )
      .replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noopener">$1</a>');

  for (const raw of lines) {
    const line = raw;
    if (line.startsWith("```")) {
      flushPara();
      closeLists();
      if (inPre) {
        out.push("</pre>");
        inPre = false;
      } else {
        out.push("<pre>");
        inPre = true;
      }
      continue;
    }
    if (inPre) {
      out.push(esc(line));
      continue;
    }
    if (!line.trim()) {
      flushPara();
      closeLists();
      continue;
    }
    const h = line.match(/^(#{1,3})\s+(.+)$/);
    if (h) {
      flushPara();
      closeLists();
      const level = h[1].length;
      out.push(`<h${level}>${inline(h[2])}</h${level}>`);
      continue;
    }
    const ul = line.match(/^[-*]\s+(.+)$/);
    if (ul) {
      flushPara();
      if (inOl) {
        out.push("</ol>");
        inOl = false;
      }
      if (!inUl) {
        out.push("<ul>");
        inUl = true;
      }
      out.push(`<li>${inline(ul[1])}</li>`);
      continue;
    }
    const ol = line.match(/^\d+[.)]\s+(.+)$/);
    if (ol) {
      flushPara();
      if (inUl) {
        out.push("</ul>");
        inUl = false;
      }
      if (!inOl) {
        out.push("<ol>");
        inOl = true;
      }
      out.push(`<li>${inline(ol[1])}</li>`);
      continue;
    }
    if (line.startsWith("|")) {
      flushPara();
      closeLists();
      continue; // 表は簡略スキップ（一覧は別セクション）
    }
    if (/^---+$/.test(line.trim())) {
      flushPara();
      closeLists();
      out.push("<hr />");
      continue;
    }
    para.push(line.trim());
  }
  flushPara();
  closeLists();
  if (inPre) out.push("</pre>");
  return out.join("\n");
}

const SHELL_CSS = `
:root {
  --navy: #000080;
  --navy-deep: #00004a;
  --cream: #f8f0d8;
  --gold: #ffd65e;
  --cyan: #5ec8ff;
  --dim: #a8a8e0;
  --ink: #f8f0d8;
  --panel: rgba(0,0,74,.92);
  --line: rgba(255,255,255,.85);
  --font: "Hiragino Kaku Gothic ProN", "Noto Sans JP", sans-serif;
}
* { box-sizing: border-box; }
body {
  margin: 0;
  min-height: 100vh;
  font-family: var(--font);
  color: var(--ink);
  background:
    radial-gradient(900px 420px at 10% -10%, #003090 0%, transparent 55%),
    linear-gradient(180deg, #00004a, #000028 60%, #001a10);
  line-height: 1.5;
}
.wrap { width: min(980px, calc(100% - 1.5rem)); margin: 0 auto; padding: 1.2rem 0 3rem; }
.win {
  border: 4px solid #fff;
  box-shadow: 0 0 0 2px #000, 6px 6px 0 #000;
  background: linear-gradient(180deg, #000090, var(--navy-deep));
  padding: 1rem 1.1rem 1.15rem;
  margin-bottom: 1rem;
}
h1 { margin: 0 0 .35rem; color: var(--gold); font-size: 1.45rem; letter-spacing: .06em; }
.sub { color: var(--dim); margin: 0 0 .8rem; font-size: .92rem; }
.badges { display: flex; flex-wrap: wrap; gap: .4rem; margin-bottom: .8rem; }
.badge {
  border: 2px solid #fff; padding: .15rem .55rem; font-size: .78rem;
  background: rgba(0,0,0,.35); color: var(--cream);
}
.toolbar { display: flex; flex-wrap: wrap; gap: .5rem; align-items: center; margin-bottom: .6rem; }
input#q {
  flex: 1; min-width: 12rem; padding: .45rem .6rem;
  border: 2px solid #fff; background: #000040; color: var(--cream); font: inherit;
}
.grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
  gap: .75rem;
}
.card {
  display: block; text-decoration: none; color: inherit;
  border: 3px solid #fff; background: rgba(0,0,40,.55);
  padding: .75rem .85rem; transition: transform .12s ease;
}
.card:hover { transform: translateY(-2px); border-color: var(--gold); }
.card h2 { margin: 0 0 .35rem; font-size: 1.05rem; color: var(--gold); }
.card .meta { color: var(--dim); font-size: .82rem; }
.kw { display: flex; flex-wrap: wrap; gap: .25rem; margin-top: .45rem; }
.kw span {
  font-size: .72rem; border: 1px solid var(--dim); padding: .05rem .35rem; color: var(--cyan);
}
.hidden { display: none !important; }
.topic-body { color: var(--cream); }
.topic-body h1, .topic-body h2, .topic-body h3 { color: var(--gold); }
.topic-body a { color: var(--cyan); word-break: break-all; }
.topic-body code { background: rgba(0,0,0,.35); padding: .05rem .25rem; }
.topic-body pre {
  overflow-x: auto; background: rgba(0,0,0,.4); padding: .75rem; border: 1px solid #fff;
}
.topic-body ul, .topic-body ol { padding-left: 1.2rem; }
.members { margin-top: 1rem; }
.members a { display: block; margin: .35rem 0; }
.back { color: var(--gold); text-decoration: none; border-bottom: 2px solid var(--gold); }
`;

function topicFileName(c: NotebookClusterView): string {
  const n = String(c.index).padStart(2, "0");
  const safe = (c.folderName || c.slug || `topic-${c.index}`)
    .replace(/[^\w\u3040-\u30ff\u4e00-\u9fff-]+/g, "-")
    .slice(0, 80);
  return `${n}_${safe}.html`;
}

function renderTopicPage(c: NotebookClusterView, generatedAt: string): string {
  const members = c.members
    .map(
      (m) =>
        `<a href="${esc(m.url)}" target="_blank" rel="noopener">${esc(m.titleJa || m.title)} <span class="meta">(${esc(m.source)})</span></a>`,
    )
    .join("\n");
  return `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${esc(c.titleJa || c.label)} — 知識の書</title>
<style>${SHELL_CSS}</style>
</head>
<body>
<div class="wrap">
  <div class="win">
    <p><a class="back" href="NOTEBOOK.html">← 知識の書にもどる</a></p>
    <h1>${esc(c.titleJa || c.label)}</h1>
    <p class="sub">${esc(c.category)} · ${c.size}件 · 関連度 ${esc(c.relatedness)} · 更新 ${esc(generatedAt)}</p>
    <div class="badges">
      ${(c.keywords ?? []).slice(0, 8).map((k) => `<span class="badge">${esc(k)}</span>`).join("")}
    </div>
    <p class="sub">${esc(c.overview || "")}</p>
  </div>
  <div class="win topic-body">
    ${mdToHtml(c.contextMarkdown || "")}
    <div class="members">
      <h2>出典リンク</h2>
      ${members || "<p>（メンバーなし）</p>"}
    </div>
  </div>
</div>
</body>
</html>`;
}

function renderIndex(
  analysis: NotebookAnalysis,
  topics: Array<{ file: string; cluster: NotebookClusterView }>,
): string {
  const cards = topics
    .map(({ file, cluster: c }) => {
      const hay = esc(
        `${c.titleJa} ${c.label} ${c.category} ${(c.keywords ?? []).join(" ")}`.toLowerCase(),
      );
      return `<a class="card" href="${esc(file)}" data-hay="${hay}">
  <h2>${esc(c.titleJa || c.label)}</h2>
  <p class="meta">${esc(c.category)} · ${c.size}件 · 関連 ${esc(c.relatedness)}</p>
  <p class="meta">${esc((c.overview || "").slice(0, 120))}</p>
  <div class="kw">${(c.keywords ?? []).slice(0, 5).map((k) => `<span>${esc(k)}</span>`).join("")}</div>
</a>`;
    })
    .join("\n");

  return `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>知識の書 — NOTEBOOK</title>
<style>${SHELL_CSS}</style>
</head>
<body>
<div class="wrap">
  <div class="win">
    <h1>◆ 知識の書 ◆</h1>
    <p class="sub">収集した情報を話題ごとに束ねた HTML パック。タップすると文脈と出典が開きます。</p>
    <p class="sub">更新 ${esc(analysis.generatedAt)} · 話題 ${topics.length} · 元記事 ${analysis.totalItems}</p>
    <div class="toolbar">
      <input id="q" type="search" placeholder="話題・キーワードで絞り込み" autocomplete="off" />
    </div>
  </div>
  <div class="grid" id="grid">
    ${cards || '<p class="sub">まだ話題がありません。アプリで「クラスタを再解析」→「HTMLで出す」を実行してください。</p>'}
  </div>
</div>
<script>
(function(){
  var q = document.getElementById("q");
  var cards = document.querySelectorAll(".card");
  q.addEventListener("input", function(){
    var n = (q.value || "").trim().toLowerCase();
    cards.forEach(function(c){
      var hay = c.getAttribute("data-hay") || "";
      c.classList.toggle("hidden", n && hay.indexOf(n) === -1);
    });
  });
})();
</script>
</body>
</html>`;
}

async function loadAnalysis(config: AppConfig): Promise<NotebookAnalysis> {
  try {
    const raw = await readFile(
      path.join(config.dataRoot, "notebook", "analysis-cache.json"),
      "utf8",
    );
    const parsed = JSON.parse(raw) as NotebookAnalysis;
    if (parsed?.ok && Array.isArray(parsed.clusters) && parsed.clusters.length) {
      return parsed;
    }
  } catch {
    // fall through
  }
  return analyzeCorpus(config);
}

export interface NotebookHtmlResult {
  path: string;
  mobilePath: string;
  topicsDir: string;
  topicCount: number;
  generatedAt: string;
}

/**
 * 知識の書を HTML パックとして ready/ と iCloud mobile に出す。
 * NotebookLM の MD フォルダは別出口として残し、こちらがアプリ本丸の閲覧形。
 */
export async function runNotebookHtml(
  config: AppConfig,
  opts?: { forceAnalyze?: boolean },
): Promise<NotebookHtmlResult> {
  await assertDataRootReady(config);
  await ensureLayout(config.dataRoot);

  const analysis = opts?.forceAnalyze
    ? await analyzeCorpus(config)
    : await loadAnalysis(config);

  const readyDir = path.join(config.dataRoot, "ready");
  const topicsDir = path.join(readyDir, "notebook-html");
  await mkdir(topicsDir, { recursive: true });

  // 旧トピック掃除
  try {
    const { unlink } = await import("node:fs/promises");
    const old = await readdir(topicsDir);
    for (const f of old) {
      if (f.endsWith(".html")) {
        await unlink(path.join(topicsDir, f)).catch(() => {});
      }
    }
  } catch {
    // ignore
  }

  const topics: Array<{ file: string; cluster: NotebookClusterView }> = [];
  for (const c of analysis.clusters) {
    const file = topicFileName(c);
    const html = renderTopicPage(c, analysis.generatedAt);
    await writeFile(path.join(topicsDir, file), html, "utf8");
    // 相対リンク用に ready/ 直下からも開けるコピーはせず、index から notebook-html/ へ
    topics.push({ file: `notebook-html/${file}`, cluster: c });
  }

  const indexHtml = renderIndex(analysis, topics);
  const outPath = path.join(readyDir, "NOTEBOOK.html");
  await writeFile(outPath, indexHtml, "utf8");

  const bridgeRoot = resolveBridgeRoot(config);
  const mobileDir = path.join(bridgeRoot, "mobile");
  const mobileTopics = path.join(mobileDir, "notebook-html");
  await mkdir(mobileTopics, { recursive: true });
  await copyFile(outPath, path.join(mobileDir, "NOTEBOOK.html"));
  for (const t of topics) {
    const base = path.basename(t.file);
    await copyFile(
      path.join(topicsDir, base),
      path.join(mobileTopics, base),
    );
  }

  console.log(`📓 NOTEBOOK.html → ${outPath} (${topics.length} topics)`);

  return {
    path: outPath,
    mobilePath: path.join(mobileDir, "NOTEBOOK.html"),
    topicsDir,
    topicCount: topics.length,
    generatedAt: nowIso(),
  };
}
