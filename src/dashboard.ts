import { copyFile, mkdir, writeFile, access } from "node:fs/promises";
import path from "node:path";
import { assertDataRootReady, ensureLayout } from "./disk.js";
import { nowIso } from "./http.js";
import { countByCategory, loadCatalog, sortByRecency } from "./corpus.js";
import { loadVetLedger, type VetRecord } from "./vet.js";
import {
  CATEGORIES,
  type AppConfig,
  type CatalogEntry,
  type Category,
} from "./types.js";
import { resolveBridgeRoot } from "./ship.js";
import { glanceOf, rebuildTitleJaMap } from "./title-ja.js";
import { runLinksHtml } from "./links-html.js";

const CAT_LABEL: Record<Category, string> = {
  llms: "LLM",
  agents: "エージェント",
  tools: "道具",
  research: "研究",
  industry: "産業AI",
  opensource: "OSS",
  multimodal: "マルチモーダル",
  safety: "安全",
  trends: "トレンド",
  mind: "心・心理",
  body: "からだ",
  dining: "飲食",
  biz: "ビジネス",
  reviews: "レビュー文献",
  other: "その他",
};

/** 情報収集班の部隊（ビジネス核を先に） */
const SQUAD_ORDER: Category[] = [
  "biz",
  "dining",
  "trends",
  "mind",
  "body",
  "reviews",
  "agents",
  "llms",
  "tools",
  "research",
  "industry",
  "opensource",
  "multimodal",
  "safety",
  "other",
];

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function sharedStyles(): string {
  return `
:root {
  --ink: #1c1914;
  --paper: #f3efe6;
  --mist: #e4ddd0;
  --sea: #1f4b45;
  --ember: #b85c38;
  --line: rgba(28,25,20,.12);
  --ok: #2f6b4f;
  --warn: #8a6a20;
  --mute: rgba(28,25,20,.62);
}
* { box-sizing: border-box; }
html, body { margin: 0; min-height: 100%; }
body {
  font-family: "IBM Plex Sans JP", system-ui, sans-serif;
  color: var(--ink);
  background:
    radial-gradient(1100px 520px at 8% -8%, #dfece8 0%, transparent 55%),
    radial-gradient(800px 420px at 100% 0%, #f0e0d4 0%, transparent 48%),
    linear-gradient(180deg, #f7f3eb 0%, var(--paper) 42%, #ebe4d7 100%);
  line-height: 1.55;
}
body::before {
  content: "";
  position: fixed; inset: 0; pointer-events: none; opacity: .28;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='120' height='120'%3E%3Cpath d='M0 60H120M60 0V120' stroke='%231c1914' stroke-opacity='.04'/%3E%3C/svg%3E");
}
.wrap {
  width: min(920px, calc(100% - 2rem));
  margin: 0 auto;
  padding: max(1.2rem, env(safe-area-inset-top)) 0 max(3.5rem, env(safe-area-inset-bottom));
}
.kicker {
  margin: 0 0 .45rem;
  font-size: .78rem;
  letter-spacing: .14em;
  text-transform: uppercase;
  color: var(--sea);
  font-weight: 600;
}
h1, h2 {
  font-family: Fraunces, Georgia, serif;
  letter-spacing: -.02em;
}
h1 { font-size: clamp(1.8rem, 7vw, 2.6rem); color: var(--sea); margin: 0 0 .35rem; }
h2 { font-size: 1.35rem; margin: 0 0 .25rem; }
.sub { margin: 0 0 .9rem; color: var(--mute); font-size: .88rem; }
.back {
  display: inline-flex;
  align-items: center;
  gap: .35rem;
  margin: 0 0 1rem;
  padding: .55rem .9rem;
  min-height: 44px;
  border-radius: 999px;
  border: 1px solid var(--line);
  background: rgba(255,255,255,.45);
  color: var(--ink);
  text-decoration: none;
  font-weight: 600;
  font-size: .9rem;
}
.list {
  list-style: none;
  margin: 0;
  padding: 0;
  border-top: 1px solid var(--line);
}
.list li {
  padding: .85rem 0;
  border-bottom: 1px solid var(--line);
}
.row-top { display: flex; gap: .4rem; margin-bottom: .25rem; flex-wrap: wrap; }
.pill, .v {
  font-size: .68rem;
  padding: .12rem .42rem;
  border-radius: 999px;
  background: var(--mist);
}
.v.pass { background: rgba(47,107,79,.14); color: var(--ok); }
.v.watch, .v.hold { background: rgba(138,106,32,.14); color: var(--warn); }
.v.reject { background: rgba(138,48,48,.12); color: #8a3030; }
.list a.ja-title {
  color: var(--ink);
  text-decoration: none;
  font-weight: 600;
  font-size: 1.02rem;
  display: block;
  line-height: 1.4;
}
.list a.ja-title:hover { color: var(--sea); }
.orig {
  display: block;
  margin-top: .25rem;
  font-size: .72rem;
  color: rgba(28,25,20,.45);
  line-height: 1.35;
  word-break: break-word;
}
.src { display: block; margin-top: .2rem; font-size: .72rem; color: var(--mute); }
.foot {
  margin-top: 1.8rem;
  padding-top: .8rem;
  border-top: 1px solid var(--line);
  font-size: .75rem;
  color: var(--mute);
}
.empty { color: var(--mute); padding: 1rem 0; }
`;
}

function vetMark(v?: VetRecord): { mark: string; cls: string } {
  if (!v) return { mark: "未精査", cls: "na" };
  if (v.verdict === "pass") return { mark: "精査OK", cls: "pass" };
  if (v.verdict === "watch" || v.verdict === "hold")
    return { mark: "精査中", cls: v.verdict };
  if (v.verdict === "reject") return { mark: "見送り", cls: "reject" };
  return { mark: "未精査", cls: "na" };
}

function itemRows(
  entries: CatalogEntry[],
  vet: Map<string, VetRecord>,
  titles: Map<string, string>,
  opts?: { showCategory?: boolean },
): string {
  if (!entries.length) return `<p class="empty">この棚にはまだ本がないよ</p>`;
  return `<ul class="list">${entries
    .map((e, i) => {
      const { mark, cls } = vetMark(vet.get(e.id));
      const ja = glanceOf(e, titles);
      const cat = opts?.showCategory
        ? `<span class="pill">${esc(CAT_LABEL[e.category] || e.category)}</span>`
        : "";
      return `<li style="--i:${i}">
        <div class="row-top">${cat}<span class="v ${cls}">${mark}</span></div>
        <a class="ja-title" href="${esc(e.url)}" target="_blank" rel="noopener">${esc(ja)}</a>
        <span class="orig">${esc(e.title)}</span>
        <span class="src">${esc(e.source)}${e.collected_at ? ` · ${esc(e.collected_at.slice(0, 10))}` : ""}</span>
      </li>`;
    })
    .join("\n")}</ul>`;
}

/** 別ファイル用。スマホでは DASHBOARD.html#cat-xxx へ誘導 */
function renderCategoryPage(cat: Category): string {
  const label = CAT_LABEL[cat];
  return `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta http-equiv="refresh" content="0;url=DASHBOARD.html#cat-${cat}" />
<title>${esc(label)} — 情報収集班</title>
<script>location.replace("DASHBOARD.html#cat-${cat}");</script>
</head>
<body>
  <p><a href="DASHBOARD.html#cat-${cat}">${esc(label)} の棚へ移動</a></p>
</body>
</html>`;
}

function levelFromCount(n: number): { lv: number; title: string; nextAt: number; xpPct: number } {
  const lv = Math.max(1, Math.floor(Math.sqrt(n / 8)) + 1);
  const titles = [
    "",
    "見習い班員",
    "収集係",
    "情報の狩人",
    "分析班",
    "精査係",
    "作戦参謀",
    "収集班長",
    "特務班",
    "伝説の収集班",
  ];
  const prev = Math.pow(Math.max(0, lv - 1), 2) * 8;
  const nextAt = Math.pow(lv, 2) * 8;
  const xpNeed = Math.max(1, nextAt - prev);
  const xpInLevel = Math.max(0, n - prev);
  return {
    lv,
    title: titles[Math.min(titles.length - 1, lv)] || "特級",
    nextAt,
    xpPct: Math.min(100, Math.round((xpInLevel / xpNeed) * 100)),
  };
}

export async function runDashboard(
  config: AppConfig,
): Promise<{ path: string; mobilePath: string }> {
  await assertDataRootReady(config);
  await ensureLayout(config.dataRoot);

  const catalog = await loadCatalog(config.dataRoot);
  const titles = await rebuildTitleJaMap(config.dataRoot, catalog);
  const counts = countByCategory(catalog);
  const recent = sortByRecency(catalog).slice(0, 8);
  const vet = await loadVetLedger(config.dataRoot);
  let pass = 0;
  let pending = 0;
  for (const r of vet.values()) {
    if (r.verdict === "pass") pass++;
    else if (r.verdict === "watch" || r.verdict === "hold") pending++;
  }

  const business = new Set<Category>([
    "biz",
    "dining",
    "trends",
    "mind",
    "body",
    "reviews",
  ]);
  const maxCount = Math.max(1, ...CATEGORIES.map((c) => counts[c] || 0));
  const prog = levelFromCount(catalog.length);
  const ordered = SQUAD_ORDER.filter((c) => CATEGORIES.includes(c));

  const shelfRows = ordered
    .map((c) => {
      const n = counts[c] || 0;
      const pct = Math.round((n / maxCount) * 100);
      const biz = business.has(c) ? " biz" : "";
      // スマホのFilesアプリでも動くよう、同一HTML内の # リンクにする
      return `<li>
        <a class="shelf${biz}" href="#cat-${c}" style="--w:${pct}%">
          <span class="name">${CAT_LABEL[c]}</span>
          <span class="track"><i></i></span>
          <span class="n">${n}</span>
          <span class="go" aria-hidden="true">›</span>
        </a>
      </li>`;
    })
    .join("\n");

  const recentRows = itemRows(recent, vet, titles, { showCategory: true }).replace(
    '<ul class="list">',
    '<ul class="list" id="inbox-list">',
  );

  const categoryPanels = ordered
    .map((c) => {
      const entries = sortByRecency(
        catalog.filter((e) => e.category === c),
      ).slice(0, 40);
      const biz = business.has(c);
      return `<section class="cat-panel" id="cat-${c}">
        <a class="back" href="#shelves">← 担当棚に戻る</a>
        <p class="kicker">情報収集班 · ${esc(c)}</p>
        <h2 class="${biz ? "biz-title" : ""}">${esc(CAT_LABEL[c])}</h2>
        <p class="sub">${entries.length} 件（新しい順・最大40）· 日本語タイトルをタップで原文へ</p>
        ${itemRows(entries, vet, titles)}
      </section>`;
    })
    .join("\n");

  const diningN = counts.dining || 0;
  const bizN = counts.biz || 0;
  const topBiz = sortByRecency(catalog.filter((e) => e.category === "biz")).slice(0, 1)[0];
  const topDining = sortByRecency(catalog.filter((e) => e.category === "dining")).slice(0, 1)[0];
  const topBizJa = topBiz ? glanceOf(topBiz, titles) : "";
  const topDiningJa = topDining ? glanceOf(topDining, titles) : "";
  const topRecentJa = recent[0] ? glanceOf(recent[0], titles) : "";

  const html = `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
<meta name="apple-mobile-web-app-capable" content="yes" />
<meta name="apple-mobile-web-app-status-bar-style" content="default" />
<meta name="apple-mobile-web-app-title" content="情報収集班" />
<meta name="theme-color" content="#1f4b45" />
<title>情報収集班 — とみー</title>
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,560;9..144,700&family=IBM+Plex+Sans+JP:wght@400;500;600&display=swap" rel="stylesheet" />
<style>
:root {
  --ink: #1c1914;
  --paper: #f3efe6;
  --mist: #e4ddd0;
  --sea: #1f4b45;
  --ember: #b85c38;
  --line: rgba(28,25,20,.12);
  --ok: #2f6b4f;
  --warn: #8a6a20;
  --mute: rgba(28,25,20,.62);
}
* { box-sizing: border-box; }
html, body { margin: 0; min-height: 100%; }
body {
  font-family: "IBM Plex Sans JP", system-ui, sans-serif;
  color: var(--ink);
  background:
    radial-gradient(1100px 520px at 8% -8%, #dfece8 0%, transparent 55%),
    radial-gradient(800px 420px at 100% 0%, #f0e0d4 0%, transparent 48%),
    linear-gradient(180deg, #f7f3eb 0%, var(--paper) 42%, #ebe4d7 100%);
  line-height: 1.55;
}
body::before {
  content: "";
  position: fixed; inset: 0; pointer-events: none; opacity: .28;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='120' height='120'%3E%3Cpath d='M0 60H120M60 0V120' stroke='%231c1914' stroke-opacity='.04'/%3E%3C/svg%3E");
}
.wrap {
  width: min(920px, calc(100% - 2rem));
  margin: 0 auto;
  padding: max(1.2rem, env(safe-area-inset-top)) 0 max(3.5rem, env(safe-area-inset-bottom));
}
.hero { padding: 1.2rem 0 1.6rem; animation: rise .55s ease both; }
.kicker {
  margin: 0 0 .45rem;
  font-size: .78rem;
  letter-spacing: .14em;
  text-transform: uppercase;
  color: var(--sea);
  font-weight: 600;
}
.brand {
  font-family: Fraunces, Georgia, serif;
  font-size: clamp(2.6rem, 8vw, 4.2rem);
  line-height: .98;
  letter-spacing: -.03em;
  color: var(--sea);
  margin: 0;
}
.lede {
  margin: .85rem 0 0;
  max-width: 32rem;
  color: var(--mute);
  font-size: 1.02rem;
}
.cta { margin-top: 1rem; display: flex; gap: .6rem; flex-wrap: wrap; }
.btn {
  text-decoration: none;
  display: inline-flex;
  padding: .75rem 1.1rem;
  border-radius: 999px;
  font-weight: 600;
  font-size: .92rem;
  transition: transform .18s ease;
}
.btn:hover { transform: translateY(-2px); }
.btn-main { background: var(--sea); color: #f7f3eb; }
.btn-ghost { color: var(--ink); border: 1px solid var(--line); background: rgba(255,255,255,.35); }

.strip {
  display: grid;
  grid-template-columns: 1.4fr 1fr 1fr 1fr;
  gap: .65rem;
  margin: .4rem 0 1.8rem;
  animation: rise .6s .06s ease both;
}
@media (max-width: 720px) {
  .strip { grid-template-columns: 1fr 1fr; }
  .brand { font-size: clamp(2.2rem, 11vw, 3.2rem); }
  .btn { width: 100%; justify-content: center; min-height: 48px; }
  .cta { flex-direction: column; }
  .shelf { grid-template-columns: 5.2rem 1fr 2.2rem 1rem; gap: .4rem; }
  .mission { padding: 1rem; }
}
.card {
  padding: .9rem 1rem;
  background: rgba(255,255,255,.48);
  border: 1px solid var(--line);
  border-radius: 16px;
  backdrop-filter: blur(6px);
}
.card.wide { grid-column: span 1; }
.card b {
  display: block;
  font-family: Fraunces, serif;
  font-size: 1.55rem;
  color: var(--sea);
  line-height: 1.1;
}
.card span { font-size: .78rem; color: var(--mute); }
.xp {
  margin-top: .55rem;
  height: 5px;
  background: var(--mist);
  border-radius: 99px;
  overflow: hidden;
}
.xp i { display: block; height: 100%; width: var(--p); background: var(--ember); border-radius: inherit; }

section { margin: 0 0 1.8rem; animation: rise .55s .1s ease both; }
h2 {
  font-family: Fraunces, serif;
  font-size: 1.35rem;
  margin: 0 0 .25rem;
  letter-spacing: -.02em;
}
.sub { margin: 0 0 .9rem; color: var(--mute); font-size: .88rem; }

.missions { display: grid; gap: .55rem; }
.mission {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: .75rem;
  padding: .85rem 1rem;
  border-radius: 14px;
  background: rgba(255,255,255,.48);
  border: 1px solid var(--line);
}
.mission .n {
  font-family: Fraunces, serif;
  color: var(--ember);
  font-size: 1.15rem;
  min-width: 1.4rem;
}
.mission h3 { margin: 0 0 .15rem; font-size: .98rem; }
.mission p { margin: 0; color: var(--mute); font-size: .86rem; }

.shelves {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: 0;
}
.shelves > li { border-bottom: 1px solid var(--line); }
.shelf {
  display: grid;
  grid-template-columns: 7.5rem 1fr 2.6rem 1.1rem;
  gap: .55rem;
  align-items: center;
  padding: .85rem .15rem;
  min-height: 52px;
  text-decoration: none;
  color: inherit;
  -webkit-tap-highlight-color: rgba(31,75,69,.12);
}
.shelf:active { background: rgba(255,255,255,.35); }
.shelf.biz .name { color: var(--ember); font-weight: 600; }
.name { font-size: .95rem; }
.track {
  height: 6px;
  background: var(--mist);
  border-radius: 99px;
  overflow: hidden;
}
.track i { display: block; height: 100%; width: var(--w); background: var(--sea); border-radius: inherit; }
.shelf.biz .track i { background: var(--ember); }
.n { text-align: right; font-variant-numeric: tabular-nums; font-weight: 600; font-size: .92rem; color: var(--mute); }
.go { color: var(--mute); font-size: 1.2rem; text-align: right; }

/* スマホ向け: 棚タップで同一ページ内のカテゴリへ（Filesアプリ対応） */
.cat-panel {
  display: none;
  scroll-margin-top: 12px;
  padding-top: .4rem;
  margin: 0 0 1.8rem;
  animation: rise .4s ease both;
}
.cat-panel:target { display: block; }
.home-view { display: block; }
body:has(.cat-panel:target) .home-view { display: none; }
.cat-panel .back {
  display: inline-flex;
  align-items: center;
  margin: 0 0 1rem;
  padding: .55rem .95rem;
  min-height: 44px;
  border-radius: 999px;
  border: 1px solid var(--line);
  background: rgba(255,255,255,.55);
  color: var(--ink);
  text-decoration: none;
  font-weight: 600;
  font-size: .9rem;
}
.cat-panel .biz-title { color: var(--ember); }
.cat-panel h2 {
  font-family: Fraunces, Georgia, serif;
  font-size: clamp(1.6rem, 7vw, 2.2rem);
  margin: 0 0 .35rem;
  color: var(--sea);
}

.list {
  list-style: none;
  margin: 0;
  padding: 0;
  border-top: 1px solid var(--line);
}
.list li {
  padding: .85rem 0;
  border-bottom: 1px solid var(--line);
  animation: rise .45s calc(var(--i) * .04s) ease both;
}
.row-top { display: flex; gap: .4rem; margin-bottom: .25rem; }
.pill, .v {
  font-size: .68rem;
  padding: .12rem .42rem;
  border-radius: 999px;
  background: var(--mist);
}
.v.pass { background: rgba(47,107,79,.14); color: var(--ok); }
.v.watch, .v.hold { background: rgba(138,106,32,.14); color: var(--warn); }
.v.reject { background: rgba(138,48,48,.12); color: #8a3030; }
.list a.ja-title {
  color: var(--ink);
  text-decoration: none;
  font-weight: 600;
  font-size: 1.02rem;
  display: block;
  line-height: 1.4;
}
.list a.ja-title:hover { color: var(--sea); }
.orig {
  display: block;
  margin-top: .28rem;
  font-size: .72rem;
  color: rgba(28,25,20,.45);
  line-height: 1.35;
  word-break: break-word;
}
.src { display: block; margin-top: .2rem; font-size: .72rem; color: var(--mute); }

.note {
  margin-top: 1.2rem;
  padding: .9rem 1rem;
  border-radius: 14px;
  background: rgba(31,75,69,.06);
  border: 1px solid rgba(31,75,69,.14);
  font-size: .88rem;
  color: var(--mute);
}
.note strong { color: var(--sea); }
.foot {
  margin-top: 1.8rem;
  padding-top: .8rem;
  border-top: 1px solid var(--line);
  font-size: .75rem;
  color: var(--mute);
}
@keyframes rise {
  from { opacity: 0; transform: translateY(10px); }
  to { opacity: 1; transform: none; }
}
</style>
</head>
<body>
  <div class="wrap">
    <div class="home-view" id="home">
      <header class="hero">
        <p class="kicker">情報収集班</p>
        <h1 class="brand">とみーの今日</h1>
        <p class="lede">集めて、噛み砕いて、渡す。班の任務はこれだけ。ビジネス・飲食・心・からだ・トレンドも同じ班の担当だよ。</p>
        <div class="cta">
          <a class="btn btn-main" href="#missions">今日の任務を見る</a>
          <a class="btn btn-ghost" href="#shelves">担当棚を開く</a>
          <a class="btn btn-ghost" href="LINKS.html">リンク一覧を開く</a>
          <a class="btn btn-ghost" href="NOTEBOOK.html">知識の書を開く</a>
        </div>
      </header>

      <div class="strip">
        <div class="card">
          <b>Lv ${prog.lv}</b>
          <span>${esc(prog.title)} · 収集 ${catalog.length} 件</span>
          <div class="xp" style="--p:${prog.xpPct}%"><i></i></div>
        </div>
        <div class="card"><b>${bizN}</b><span>ビジネス班</span></div>
        <div class="card"><b>${diningN}</b><span>飲食チーム</span></div>
        <div class="card"><b>${pass}</b><span>精査OK</span></div>
        <div class="card"><b>${pending}</b><span>精査待ち</span></div>
      </div>

      <section id="missions">
        <h2>今日の任務</h2>
        <p class="sub">情報収集班のデイリークエスト · 3つで完了</p>
        <div class="missions">
          <article class="mission">
            <div class="n">1</div>
            <div>
              <h3>班の状況を30秒見る</h3>
              <p>この画面の数字と、下の担当棚だけ目を通す</p>
            </div>
          </article>
          <article class="mission">
            <div class="n">2</div>
            <div>
              <h3>棚を1つひらく</h3>
              <p>${
                topBizJa
                  ? `ビジネスなら → ${esc(topBizJa.replace(/^【[^】]+】/, "").slice(0, 36))}`
                  : topDiningJa
                    ? `飲食なら → ${esc(topDiningJa.replace(/^【[^】]+】/, "").slice(0, 36))}`
                    : topRecentJa
                      ? `おすすめ → ${esc(topRecentJa.replace(/^【[^】]+】/, "").slice(0, 36))}`
                      : "まだ新着がないときは収集を回そう"
              }</p>
            </div>
          </article>
          <article class="mission">
            <div class="n">3</div>
            <div>
              <h3>小さな一手だけ進める</h3>
              <p>棚の中の1件を読んだらOK。全部やらなくていい</p>
            </div>
          </article>
        </div>
      </section>

      <section id="shelves">
        <h2>班の担当棚</h2>
        <p class="sub">色つきは重点部隊 · タップでその棚の一覧へ（スマホ対応）</p>
        <ul class="shelves">${shelfRows}</ul>
      </section>

      <section id="inbox">
        <h2>新着インボックス</h2>
        <p class="sub">いちばん新しい8件 · 精査バッジつき</p>
        ${recentRows}
        <p class="note"><strong>受け渡し:</strong> 投稿文は作らない。噛み砕いた理解パックを iCloud の intel-bridge へ渡すのが班の仕事。</p>
      </section>

      <footer class="foot">更新 ${esc(nowIso())} · スマホは同じファイル内で棚移動できます</footer>
    </div>

    ${categoryPanels}
  </div>
  <script>
  /* iOS Files / 古いWebView向けフォールバック */
  (function () {
    function sync() {
      var id = (location.hash || "").replace(/^#/, "");
      var panels = document.querySelectorAll(".cat-panel");
      var home = document.querySelector(".home-view");
      var showCat = id.indexOf("cat-") === 0;
      if (home) home.style.display = showCat ? "none" : "";
      panels.forEach(function (p) {
        p.style.display = showCat && p.id === id ? "block" : showCat ? "none" : "";
      });
      if (showCat) {
        var el = document.getElementById(id);
        if (el) el.scrollIntoView({ block: "start" });
      }
    }
    window.addEventListener("hashchange", sync);
    window.addEventListener("DOMContentLoaded", sync);
    sync();
  })();
  </script>
</body>
</html>`;

  const outDir = path.join(config.dataRoot, "ready");
  await mkdir(outDir, { recursive: true });
  const outPath = path.join(outDir, "DASHBOARD.html");

  const catPages = ordered.map((c) => ({
    name: `cat-${c}.html`,
    body: renderCategoryPage(c),
  }));

  async function writeBundle(dir: string): Promise<void> {
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, "DASHBOARD.html"), html, "utf8");
    await writeFile(path.join(dir, "index.html"), html, "utf8");
    for (const p of catPages) {
      await writeFile(path.join(dir, p.name), p.body, "utf8");
    }
  }

  await writeBundle(outDir);
  await writeBundle(path.join(config.dataRoot, "agent"));
  await writeBundle(path.join(config.dataRoot, "daily"));

  // スマホ用: iCloud に置いて Files アプリから開けるようにする
  const bridgeRoot = resolveBridgeRoot(config);
  const mobilePath = path.join(bridgeRoot, "mobile");
  await writeBundle(mobilePath);

  // リンク一覧も同梱（動画 / Web 分け）
  try {
    const links = await runLinksHtml(config);
    for (const dir of [
      outDir,
      path.join(config.dataRoot, "agent"),
      path.join(config.dataRoot, "daily"),
      mobilePath,
    ]) {
      try {
        await copyFile(links.path, path.join(dir, "LINKS.html"));
      } catch {
        // 個別コピー失敗は無視
      }
    }
  } catch {
    // カタログ空などでもダッシュボードは出す
  }

  // 知識の書 HTML も同梱（キャッシュがあれば再生成）
  try {
    const { runNotebookHtml } = await import("./notebook-html.js");
    const nb = await runNotebookHtml(config);
    for (const dir of [
      outDir,
      path.join(config.dataRoot, "agent"),
      path.join(config.dataRoot, "daily"),
      mobilePath,
    ]) {
      try {
        await copyFile(nb.path, path.join(dir, "NOTEBOOK.html"));
      } catch {
        // ignore
      }
    }
  } catch {
    // 解析キャッシュが無いときはスキップ
  }

  const tommySrc = path.join(config.dataRoot, "agent", "TOMMY.md");
  try {
    await access(tommySrc);
    await copyFile(tommySrc, path.join(mobilePath, "TOMMY.md"));
  } catch {
    // tommy がまだなくても画面だけで見られる
  }

  await writeFile(
    path.join(mobilePath, "README.md"),
    `# 情報収集班 — スマホから見る

更新: ${nowIso()}

## iPhone での開き方

1. **ファイル**アプリを開く
2. **iCloud Drive** → \`99_システム\` → \`AI共有OS\` → \`AI活動OS\` → \`intel-bridge\` → \`mobile\`
3. **DASHBOARD.html**（または index.html）をタップ
4. **班の担当棚**の項目（飲食など）をタップ → その棚の一覧が開く
5. **← 担当棚に戻る** で戻れる
6. 右上共有 → **ホーム画面に追加** するとアプリっぽく使える

※ 棚の移動は同じファイル内で完結（iPhoneのファイルアプリでも動く）

同じWi-FiでMacから配信する場合:

\`\`\`bash
cd ai-intel
npm run phone
\`\`\`

表示された \`http://192.168.x.x:8787\` をスマホのSafariで開く。
`,
    "utf8",
  );

  return { path: outPath, mobilePath };
}
