// RE:MAKE コンサル道場 — 画面。依存なしのバニラJS。
// データは build 時に <script id="dojo-data" type="application/json"> へ埋め込まれる。
// 保存はこのブラウザの localStorage のみ（外部送信なし）。
import {
  CONFOUNDERS,
  PERIODS,
  compareBeforeAfter,
  fmtNum,
  fmtPct,
  fmtTimes,
  fmtYen,
  growthRate,
  priceFromMargin,
  pricingCheck,
  seriesStats,
} from "./calc.js";
import {
  ITEM_KINDS,
  STEPS,
  SUPPORT_MODES,
  diagnosisPrompt,
  dueLabel,
  issueSentence,
  memoMarkdown,
  missingInfo,
  newSession,
  ownerLabel,
  planMarkdown,
  proposalMarkdown,
  allMarkdown,
  sampleSession,
  smallestStep,
  uid,
} from "./session.js";

const DATA = JSON.parse(document.getElementById("dojo-data").textContent);
const CHAPTERS = DATA.outline.chapters;
const LEVELS = DATA.outline.levels;
const CARDS = DATA.cards;
const CARD = new Map(CARDS.map((c) => [c.id, c]));
const CHAPTER = new Map(CHAPTERS.map((c) => [c.id, c]));
const SOURCE = new Map(DATA.sources.sources.map((s) => [s.id, s]));
const GROUP = new Map(DATA.sources.groups.map((g) => [g.id, g]));

const COURSES = [
  { id: "basic", title: "基礎コース", desc: "全13章のレベル1で全体像をつかむ", test: (c) => c.level === 1 },
  { id: "ai", title: "AI導入支援コース", desc: "聞く→論点→提案→実行→AI活用", test: (c) => c.chapter === "C11" || (["C02", "C03", "C08", "C09"].includes(c.chapter) && c.level <= 2) },
  { id: "store", title: "店舗支援コース", desc: "数字・KPI・QSC・SV・会議", test: (c) => c.chapter === "C10" || (c.chapter === "C05" && c.level <= 3) || (c.chapter === "C07" && c.level <= 2) },
  { id: "nlp", title: "NLP教育・研修コース", desc: "支援者の姿勢・質問・研修設計", test: (c) => ["C01", "C12"].includes(c.chapter) || (c.chapter === "C02" && c.level <= 3) },
  { id: "biz", title: "一人コンサル事業コース", desc: "価格・契約・集客・事業運営", test: (c) => ["C08", "C13"].includes(c.chapter) },
  { id: "adv", title: "上級の総仕上げ", desc: "全章のレベル4", test: (c) => c.level === 4 },
];

const DOCS = [
  { key: "SKILL", title: "スキル本体（SKILL.md）", desc: "成果の定義・開始時・品質条件・標準出力" },
  { key: "workflow", title: "ポリア式の進行", desc: "合意→理解→計画→実行→振り返り→支援モード" },
  { key: "playbook", title: "実務プレイブック", desc: "ヒアリング・論点・提案・会議・価格・店舗・AI・独立" },
  { key: "templates", title: "テンプレート13種", desc: "初回面談・診断メモ・3案・KPIカード・AI用プロンプト" },
  { key: "examples", title: "適用例5つ（架空）", desc: "AI導入・NLP教育・店舗・価格交渉・定着" },
  { key: "corrections", title: "誤読・一般化の修正", desc: "必須修正と一次資料・品質ゲート" },
  { key: "video-map", title: "35動画の対応表", desc: "要約から取り込んだ技法と実装先" },
  { key: "HANDOFF", title: "依頼書（引き継ぎ）", desc: "このツールの目的・要件・完成条件" },
];

// ---------------------------------------------------------------- 保存
const KEY = "remake-dojo:v1";
let storageOk = true;
let store = { progress: {}, sessions: [], prefs: {} };
try {
  const raw = localStorage.getItem(KEY);
  if (raw) store = Object.assign(store, JSON.parse(raw));
} catch {
  storageOk = false;
}
let saveTimer = null;
function save() {
  try {
    localStorage.setItem(KEY, JSON.stringify(store));
    storageOk = true;
  } catch {
    storageOk = false;
  }
}
function saveSoon() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(save, 250);
}
// 入力直後に閉じたり再読み込みしても失わないよう、離れるときに書き出す
function flushSave() {
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
    save();
  }
}
window.addEventListener("pagehide", flushSave);
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") flushSave();
});

// ---------------------------------------------------------------- 画面状態
const ui = {
  tab: "home",
  learn: { view: "home", chapter: null, cardId: null, q: "", levels: [], course: null, list: [] },
  practice: { view: "menu", scope: "all", count: 10, quiz: null, drill: null, calc: "price" },
  consult: { view: "list", sessionId: null, confirmDelete: null, outTab: "memo" },
  library: { view: "menu", doc: null, confirmWipe: false },
};
const calcState = {
  price: { low: "", mid: "", high: "", benefitPeriod: "year", price: "", pricePeriod: "year", cost: "", marginCost: "", margin: "" },
  series: { text: "12, 15, , 0, 18, -, 20" },
  ba: { before: "45", after: "30", cb: "", ca: "", checked: [] },
};
let derived = [];

// ---------------------------------------------------------------- DOM小道具
function h(tag, props, ...kids) {
  const el = document.createElement(tag);
  if (props) {
    for (const [k, v] of Object.entries(props)) {
      if (v === null || v === undefined || v === false) continue;
      if (k === "class") el.className = v;
      else if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2).toLowerCase(), v);
      else if (k === "value") el.value = v;
      else if (k === "checked") el.checked = Boolean(v);
      else if (k === "html") el.innerHTML = v;
      else el.setAttribute(k, v === true ? "" : v);
    }
  }
  for (const kid of kids.flat(Infinity)) {
    if (kid === null || kid === undefined || kid === false) continue;
    el.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
  }
  return el;
}
const $main = () => document.getElementById("main");

function toast(msg) {
  document.querySelectorAll(".toast").forEach((t) => t.remove());
  const t = h("div", { class: "toast", role: "status" }, msg);
  document.body.append(t);
  setTimeout(() => t.remove(), 1900);
}

function copyText(text, fallbackEl) {
  const done = () => toast("コピーしました");
  const fail = () => {
    if (fallbackEl) {
      const r = document.createRange();
      r.selectNodeContents(fallbackEl);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(r);
    }
    toast("自動コピーできません。選択した文字をコピーしてください");
  };
  try {
    navigator.clipboard.writeText(text).then(done, fail);
  } catch {
    fail();
  }
}

function downloadText(name, text) {
  try {
    const url = URL.createObjectURL(new Blob([text], { type: "text/markdown;charset=utf-8" }));
    const a = h("a", { href: url, download: name });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast("ダウンロードを開始しました（Artifact表示では動かないことがあります）");
  } catch {
    toast("この画面ではダウンロードできません。コピーを使ってください");
  }
}

const ICONS = {
  home: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 11l9-7 9 7"/><path d="M5 10v10h14V10"/><path d="M10 20v-5h4v5"/></svg>',
  learn: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2z"/><path d="M4 21V5"/><path d="M9 7h6M9 11h6"/></svg>',
  practice: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="4"/><path d="M12 12l6-6"/></svg>',
  consult: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 5h16v10H9l-5 4z"/><path d="M8 9h8M8 12h5"/></svg>',
  library: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4h4v16H4zM10 4h4v16h-4z"/><path d="M16 5l3.5-1 3 15.5-3.5 1z"/></svg>',
};
const TABS = [
  ["home", "ホーム"],
  ["learn", "学ぶ"],
  ["practice", "練習"],
  ["consult", "伴走"],
  ["library", "資料"],
];

// ---------------------------------------------------------------- 共通表示
function levelPips(level) {
  return h(
    "span",
    { class: "lv", title: `レベル${level}：${LEVELS[level]}` },
    h("span", { class: "pips", "aria-hidden": "true" }, [1, 2, 3, 4].map((n) => h("i", { class: n <= level ? "on" : "" }))),
    LEVELS[level]
  );
}
function basisBadge(card) {
  return card.basis === "skill"
    ? h("span", { class: "badge skill", title: "ユーザー提供の要約と一次資料監査を統合したRE:MAKEスキルに基づく。原典の全文は未確認" }, "RE:MAKE資料ベース")
    : h("span", { class: "badge general", title: "一般的なコンサル知識としてClaudeが作成。原典とは照合していない" }, "一般知識・原典未照合");
}
function progressOf(id) {
  return store.progress[id] || {};
}
function understoodCount(cards = CARDS) {
  return cards.filter((c) => progressOf(c.id).u).length;
}
function bar(ratio) {
  return h("div", { class: "bar", role: "img", "aria-label": `${Math.round(ratio * 100)}%` }, h("span", { style: `width:${Math.max(0, Math.min(100, ratio * 100))}%` }));
}
function nextStepBox(text, suggested) {
  return h(
    "section",
    { class: "next-step", "aria-label": "今日できる最小の一手" },
    h("span", { class: "eyebrow" }, "今日できる最小の一手"),
    h("p", null, text),
    suggested ? h("span", { class: "tiny muted" }, "提案（未合意）。自分の言葉に書き換えて使う") : null
  );
}
function crumb() {
  const t = ui.tab;
  if (t === "learn") {
    if (ui.learn.view === "card" && ui.learn.cardId) return `学ぶ › ${ui.learn.cardId}`;
    if (ui.learn.view === "chapter" && ui.learn.chapter) return `学ぶ › ${CHAPTER.get(ui.learn.chapter)?.title || ""}`;
    return "学ぶ › コンサル知識333";
  }
  if (t === "practice") return { menu: "練習", quiz: "練習 › クイズ", result: "練習 › 結果", drill: "練習 › 誤り探し", calc: "練習 › 計算ツール" }[ui.practice.view];
  if (t === "consult") {
    const s = currentSession();
    return s ? `伴走 › ${STEPS[s.step].label}` : "伴走 › 相談の一覧";
  }
  if (t === "library") return "資料";
  return "ホーム";
}

function go(tab, patch) {
  ui.tab = tab;
  if (patch) Object.assign(ui[tab], patch);
  try {
    history.replaceState(null, "", `#${tab}`);
  } catch {
    /* 読み取り専用のフレームでは無視 */
  }
  render();
  window.scrollTo(0, 0);
}

function render() {
  derived = [];
  const main = $main();
  main.replaceChildren();
  const view = { home: viewHome, learn: viewLearn, practice: viewPractice, consult: viewConsult, library: viewLibrary }[ui.tab]();
  main.append(...[].concat(view).flat(Infinity).filter((x) => x !== null && x !== undefined && x !== false));
  document.getElementById("crumb").textContent = crumb();
  for (const b of document.querySelectorAll(".tabbar button")) {
    if (b.dataset.tab === ui.tab) b.setAttribute("aria-current", "page");
    else b.removeAttribute("aria-current");
  }
}
function refreshDerived() {
  for (const f of derived) f();
}

// ---------------------------------------------------------------- ホーム
function dayHash(s) {
  let x = 0;
  for (const ch of s) x = (x * 31 + ch.charCodeAt(0)) >>> 0;
  return x;
}
function todaysCard() {
  const today = new Date().toISOString().slice(0, 10);
  const pool = CARDS.filter((c) => !progressOf(c.id).u);
  const list = pool.length ? pool : CARDS;
  return list.length ? list[dayHash(today) % list.length] : null;
}

function viewHome() {
  const total = CARDS.length;
  const u = understoodCount();
  const answered = CARDS.reduce((s, c) => s + (progressOf(c.id).r || 0) + (progressOf(c.id).w || 0), 0);
  const right = CARDS.reduce((s, c) => s + (progressOf(c.id).r || 0), 0);
  const tc = todaysCard();
  const sessions = store.sessions.length;

  const next = !u
    ? "基礎コースの最初の1枚を読み、「理解した」を押す"
    : tc
      ? `「${tc.title}」を読み、次の面談で1回使う場面を決める`
      : "復習クイズを5問解く";

  return [
    h(
      "section",
      { class: "hero" },
      h("h1", null, h("small", null, "RE:MAKE"), "コンサル道場"),
      h("p", { class: "muted" }, `基礎から上級までの知識${total}件を学び、クイズで確かめ、実際の相談整理に使う。`),
      h(
        "div",
        { class: "stats" },
        h("div", { class: "stat" }, h("b", null, `${u}`), h("span", null, `理解した / ${total}`)),
        h("div", { class: "stat" }, h("b", null, answered ? fmtPct(right / answered, 0) : "—"), h("span", null, `正答率（${answered}問）`)),
        h("div", { class: "stat" }, h("b", null, `${sessions}`), h("span", null, "整理中の相談"))
      ),
      bar(total ? u / total : 0)
    ),
    nextStepBox(next, false),
    tc
      ? h(
          "section",
          { class: "panel raised" },
          h("div", { class: "row between" }, h("span", { class: "eyebrow" }, "今日の1枚"), levelPips(tc.level)),
          h("h2", null, tc.title),
          h("p", null, tc.summary),
          h("div", { class: "row" }, h("button", { class: "btn primary", onclick: () => openCard(tc.id, [tc.id]) }, "読む"), h("button", { class: "btn", onclick: () => startQuiz([tc.id]) }, "1問だけ解く"))
        )
      : null,
    h(
      "section",
      { class: "panel" },
      h("h2", null, "コース"),
      h(
        "div",
        { class: "stack" },
        COURSES.map((co) => {
          const cs = CARDS.filter(co.test);
          const done = understoodCount(cs);
          return h(
            "button",
            { class: "chapter-tile", onclick: () => go("learn", { view: "home", course: co.id, chapter: null, q: "", levels: [] }) },
            h("div", { class: "row between" }, h("h3", null, co.title), h("span", { class: "mono small muted" }, `${done}/${cs.length}`)),
            h("p", null, co.desc),
            bar(cs.length ? done / cs.length : 0)
          );
        })
      )
    ),
    h(
      "section",
      { class: "grid2" },
      h(
        "button",
        { class: "chapter-tile", onclick: () => go("consult", { view: "list" }) },
        h("h3", null, "相談を整理する"),
        h("p", null, "開始→整理→比較→行動→振り返り→Markdown出力。架空のサンプルで試せる")
      ),
      h(
        "button",
        { class: "chapter-tile", onclick: () => go("practice", { view: "drill", drill: { i: 0, chosen: null, order: null } }) },
        h("h3", null, "誤り探しドリル"),
        h("p", null, "価格倍率の逆転、欠測のゼロ埋め、前後比較の因果断定などを見抜く")
      )
    ),
    storageOk ? null : h("p", { class: "small muted" }, "このブラウザでは保存が使えないため、進捗はページを閉じると消えます。"),
  ];
}

// ---------------------------------------------------------------- 学ぶ
function normalize(s) {
  return String(s || "").toLowerCase().normalize("NFKC");
}
function filteredCards() {
  const L = ui.learn;
  let xs = CARDS;
  if (L.chapter) xs = xs.filter((c) => c.chapter === L.chapter);
  if (L.course) {
    const co = COURSES.find((c) => c.id === L.course);
    if (co) xs = xs.filter(co.test);
  }
  if (L.levels.length) xs = xs.filter((c) => L.levels.includes(c.level));
  const q = normalize(L.q).trim();
  if (q) {
    const terms = q.split(/\s+/);
    xs = xs.filter((c) => {
      const hay = normalize([c.id, c.title, c.summary, (c.tags || []).join(" "), (c.points || []).join(" ")].join(" "));
      return terms.every((t) => hay.includes(t));
    });
  }
  return xs;
}
function openCard(id, list) {
  ui.learn.list = list || filteredCards().map((c) => c.id);
  const card = CARD.get(id);
  if (card) {
    const p = (store.progress[id] = store.progress[id] || {});
    p.seen = (p.seen || 0) + 1;
    saveSoon();
  }
  go("learn", { view: "card", cardId: id });
}

function levelChips(onChange) {
  return h(
    "div",
    { class: "seg", role: "group", "aria-label": "レベルで絞る" },
    [1, 2, 3, 4].map((lv) =>
      h(
        "button",
        {
          class: "chip",
          "aria-pressed": ui.learn.levels.includes(lv) ? "true" : "false",
          onclick: () => {
            const L = ui.learn.levels;
            ui.learn.levels = L.includes(lv) ? L.filter((x) => x !== lv) : [...L, lv].sort();
            onChange();
          },
        },
        `${lv} ${LEVELS[lv]}`
      )
    )
  );
}

function cardRows(xs) {
  if (!xs.length) return h("p", { class: "muted" }, "該当する項目がありません。条件を減らしてください。");
  const ids = xs.map((c) => c.id);
  return h(
    "div",
    { class: "cardlist" },
    xs.map((c) =>
      h(
        "button",
        { class: "cardrow", onclick: () => openCard(c.id, ids) },
        h("span", { class: "id" }, c.id),
        h("span", { class: "stack", style: "gap:2px" }, h("span", { class: "t" }, c.title), h("span", { class: "row", style: "gap:6px" }, levelPips(c.level))),
        progressOf(c.id).u ? h("span", { class: "done", "aria-label": "理解した" }, "✓") : h("span")
      )
    )
  );
}

function viewLearn() {
  const L = ui.learn;
  if (L.view === "card") return viewCard();
  if (L.view === "chapter") return viewChapter();

  const listMount = h("div");
  const filtering = () => L.q.trim() || L.levels.length || L.course;
  const drawList = () => {
    const xs = filteredCards();
    listMount.replaceChildren(
      filtering()
        ? h(
            "section",
            { class: "stack" },
            h(
              "div",
              { class: "row between" },
              h("span", { class: "small muted" }, `${xs.length}件`),
              xs.length ? h("button", { class: "btn small", onclick: () => startQuiz(xs.map((c) => c.id)) }, "この範囲でクイズ") : null
            ),
            cardRows(xs)
          )
        : h(
            "div",
            { class: "chapters" },
            CHAPTERS.map((ch) => {
              const cs = CARDS.filter((c) => c.chapter === ch.id);
              const done = understoodCount(cs);
              return h(
                "button",
                { class: "chapter-tile", onclick: () => go("learn", { view: "chapter", chapter: ch.id }) },
                h("span", { class: "no" }, `${ch.id}　${ch.items.length}項目`),
                h("h3", null, ch.title),
                h("p", null, ch.desc),
                bar(cs.length ? done / cs.length : 0)
              );
            })
          )
    );
  };
  const search = h("input", {
    type: "search",
    id: "learn-q",
    placeholder: "キーワードで探す（例：仮説　価格　QSC）",
    value: L.q,
    oninput: (e) => {
      L.q = e.target.value;
      drawList();
    },
  });
  const courseChips = h(
    "div",
    { class: "seg", role: "group", "aria-label": "コース" },
    COURSES.map((co) =>
      h(
        "button",
        {
          class: "chip",
          "aria-pressed": L.course === co.id ? "true" : "false",
          onclick: () => {
            L.course = L.course === co.id ? null : co.id;
            render();
          },
        },
        co.title
      )
    )
  );
  drawList();
  return [
    h(
      "section",
      { class: "panel" },
      h("div", { class: "row between" }, h("h1", null, `コンサル知識${CARDS.length}`), h("span", { class: "small muted" }, `13章・4段階`)),
      search,
      h("span", { class: "eyebrow" }, "コース"),
      courseChips,
      h("span", { class: "eyebrow" }, "レベル"),
      levelChips(() => render()),
      filtering() ? h("button", { class: "linkish small", onclick: () => go("learn", { q: "", levels: [], course: null }) }, "条件をクリア") : null
    ),
    listMount,
  ];
}

function viewChapter() {
  const ch = CHAPTER.get(ui.learn.chapter);
  const xs = filteredCards();
  const all = CARDS.filter((c) => c.chapter === ch.id);
  return [
    h("button", { class: "linkish small", onclick: () => go("learn", { view: "home", chapter: null }) }, "‹ 章の一覧"),
    h(
      "section",
      { class: "panel" },
      h("span", { class: "no mono small", style: "color:var(--accent);font-weight:700" }, ch.id),
      h("h1", null, ch.title),
      h("p", { class: "muted" }, ch.desc),
      h("div", { class: "row" }, h("span", { class: "small muted" }, `理解した ${understoodCount(all)} / ${all.length}`)),
      bar(all.length ? understoodCount(all) / all.length : 0),
      levelChips(() => render()),
      h("div", { class: "row" }, xs.length ? h("button", { class: "btn small", onclick: () => startQuiz(xs.map((c) => c.id)) }, "この章でクイズ") : null)
    ),
    all.length ? cardRows(xs) : h("p", { class: "muted" }, "この章の本文はまだ入っていません。"),
  ];
}

function refView(r) {
  if (r.kind === "remake") {
    const s = SOURCE.get(r.id);
    if (!s) return h("li", null, `出典台帳 #${r.id}`);
    return h(
      "li",
      null,
      h("span", { class: "mono small muted" }, `#${r.id} `),
      h("a", { href: s.url, target: "_blank", rel: "noopener noreferrer" }, s.videoTitle || s.label),
      h("span", { class: "tiny muted" }, `　${GROUP.get(s.group)?.title || ""}・提供要約ベース／原文未確認`)
    );
  }
  if (r.kind === "skill") {
    return h(
      "li",
      null,
      h("button", { class: "linkish", onclick: () => go("library", { view: "doc", doc: r.file }) }, `RE:MAKEスキル：${r.file}${r.section ? ` ${r.section}` : ""}`)
    );
  }
  if (r.kind === "book") return h("li", null, r.label, h("span", { class: "tiny muted" }, "　参考書籍（該当箇所は未照合）"));
  if (r.kind === "web") return h("li", null, h("a", { href: r.url, target: "_blank", rel: "noopener noreferrer" }, r.label));
  return null;
}

function viewCard() {
  const c = CARD.get(ui.learn.cardId);
  if (!c) return h("p", null, "項目が見つかりません。");
  const ch = CHAPTER.get(c.chapter);
  const list = ui.learn.list && ui.learn.list.includes(c.id) ? ui.learn.list : CARDS.filter((x) => x.chapter === c.chapter).map((x) => x.id);
  const i = list.indexOf(c.id);
  const prev = i > 0 ? list[i - 1] : null;
  const next = i >= 0 && i < list.length - 1 ? list[i + 1] : null;
  const p = progressOf(c.id);
  return [
    h("button", { class: "linkish small", onclick: () => go("learn", { view: ui.learn.chapter ? "chapter" : "home", chapter: ui.learn.chapter || null }) }, "‹ 一覧に戻る"),
    h(
      "article",
      { class: "panel raised" },
      h(
        "div",
        { class: "card-head" },
        h("div", { class: "row" }, h("span", { class: "mono small muted" }, c.id), h("span", { class: "small muted" }, ch?.title), levelPips(c.level), basisBadge(c)),
        h("h1", null, c.title),
        h("p", null, c.summary)
      ),
      h("div", { class: "section-title" }, "要点"),
      h("ul", { class: "points" }, (c.points || []).map((x) => h("li", null, x))),
      h("div", { class: "section-title" }, "使い方"),
      h("ol", { class: "steps" }, (c.howto || []).map((x) => h("li", null, x))),
      h("div", { class: "pitfall" }, h("b", null, "落とし穴　"), c.pitfall),
      h("div", { class: "example" }, h("span", { class: "badge sample" }, "架空例"), " ", c.example),
      c.refs && c.refs.length
        ? [h("div", { class: "section-title" }, "さらに読む・出典"), h("div", { class: "refs" }, h("ul", null, c.refs.map(refView)))]
        : h("p", { class: "tiny muted" }, "出典：一般知識（特定の資料に基づかない）"),
      (c.tags || []).length ? h("div", { class: "row" }, c.tags.map((t) => h("button", { class: "chip", onclick: () => go("learn", { view: "home", q: t, chapter: null, course: null, levels: [] }) }, `#${t}`))) : null
    ),
    h(
      "div",
      { class: "row" },
      h(
        "button",
        {
          class: p.u ? "btn" : "btn primary",
          onclick: () => {
            const pp = (store.progress[c.id] = store.progress[c.id] || {});
            pp.u = !pp.u;
            pp.t = Date.now();
            save();
            toast(pp.u ? "理解した に記録しました" : "記録を取り消しました");
            render();
          },
        },
        p.u ? "✓ 理解した（取り消す）" : "理解した"
      ),
      h("button", { class: "btn", onclick: () => startQuiz([c.id]) }, "この項目のクイズ")
    ),
    h(
      "div",
      { class: "navbtns" },
      h("button", { class: "btn ghost", disabled: !prev, onclick: () => prev && openCard(prev, list) }, "‹ 前"),
      h("span", { class: "small muted mono", style: "align-self:center" }, i >= 0 ? `${i + 1} / ${list.length}` : ""),
      h("button", { class: "btn ghost", disabled: !next, onclick: () => next && openCard(next, list) }, "次 ›")
    ),
  ];
}

// ---------------------------------------------------------------- 練習
function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
function scopeCards(scope) {
  if (scope === "all") return CARDS;
  if (scope === "weak") return CARDS.filter((c) => progressOf(c.id).ok === false);
  if (scope === "unseen") return CARDS.filter((c) => !progressOf(c.id).r && !progressOf(c.id).w);
  if (scope === "understood") return CARDS.filter((c) => progressOf(c.id).u);
  if (scope.startsWith("L")) return CARDS.filter((c) => c.level === Number(scope.slice(1)));
  if (scope.startsWith("course:")) {
    const co = COURSES.find((x) => x.id === scope.slice(7));
    return co ? CARDS.filter(co.test) : [];
  }
  return CARDS.filter((c) => c.chapter === scope);
}
function startQuiz(ids, count) {
  const pool = shuffle(ids.filter((id) => CARD.get(id)?.quiz));
  const picked = pool.slice(0, count || Math.min(pool.length, 10));
  if (!picked.length) {
    toast("出題できる問題がありません");
    return;
  }
  ui.practice.quiz = { ids: picked, i: 0, chosen: null, order: shuffle([0, 1, 2, 3]), results: [] };
  go("practice", { view: "quiz" });
}

function viewPractice() {
  const P = ui.practice;
  if (P.view === "quiz") return viewQuiz();
  if (P.view === "result") return viewResult();
  if (P.view === "drill") return viewDrill();
  if (P.view === "calc") return viewCalc();

  const scopes = [
    ["all", "全333から"],
    ["unseen", "まだ解いていない"],
    ["weak", "前回まちがえた"],
    ["understood", "理解したにした項目"],
    ...[1, 2, 3, 4].map((l) => [`L${l}`, `レベル${l}（${LEVELS[l]}）`]),
    ...COURSES.map((co) => [`course:${co.id}`, co.title]),
    ...CHAPTERS.map((ch) => [ch.id, `${ch.id} ${ch.title}`]),
  ];
  const n = scopeCards(P.scope).length;
  const countSel = h(
    "div",
    { class: "seg", role: "group", "aria-label": "問題数" },
    [5, 10, 20].map((k) =>
      h(
        "button",
        {
          class: "chip",
          "aria-pressed": P.count === k ? "true" : "false",
          onclick: () => {
            P.count = k;
            render();
          },
        },
        `${k}問`
      )
    )
  );
  return [
    h(
      "section",
      { class: "panel raised" },
      h("h1", null, "クイズ"),
      h("p", { class: "muted small" }, "各項目に1問。場面で判断する4択。選択肢は毎回並び替える。"),
      h(
        "label",
        { class: "field" },
        "出題範囲",
        h(
          "select",
          {
            id: "quiz-scope",
            onchange: (e) => {
              P.scope = e.target.value;
              render();
            },
          },
          scopes.map(([v, t]) => h("option", { value: v, selected: P.scope === v ? "selected" : null }, t))
        )
      ),
      countSel,
      h(
        "div",
        { class: "row between" },
        h("span", { class: "small muted" }, `対象 ${n}問`),
        h("button", { class: "btn primary", disabled: !n, onclick: () => startQuiz(scopeCards(P.scope).map((c) => c.id), P.count) }, "はじめる")
      )
    ),
    h(
      "section",
      { class: "grid2" },
      h(
        "button",
        { class: "chapter-tile", onclick: () => go("practice", { view: "drill", drill: { i: 0, chosen: null, order: null } }) },
        h("span", { class: "no" }, `${DATA.drills.length}問`),
        h("h3", null, "誤り探しドリル"),
        h("p", null, "よくある誤読・一般化（価格倍率の逆転、欠測のゼロ埋め、因果の断定など）を見抜く")
      ),
      h(
        "button",
        { class: "chapter-tile", onclick: () => go("practice", { view: "calc" }) },
        h("span", { class: "no" }, "3種"),
        h("h3", null, "計算ツール"),
        h("p", null, "価格の倍率（V/PとP/C）、欠測を含む平均、導入前後の比較の読み方")
      )
    ),
  ];
}

function quizChoiceButtons(choices, order, chosen, answer, onPick) {
  return h(
    "div",
    { class: "choices" },
    order.map((orig, k) => {
      let cls = "choice";
      if (chosen !== null) {
        if (orig === answer) cls += " right";
        else if (orig === chosen) cls += " wrong";
      }
      return h(
        "button",
        { class: cls, disabled: chosen !== null, onclick: () => onPick(orig) },
        h("span", { class: "k" }, "ABCD"[k]),
        h("span", null, choices[orig])
      );
    })
  );
}

function viewQuiz() {
  const Q = ui.practice.quiz;
  const c = CARD.get(Q.ids[Q.i]);
  const qz = c.quiz;
  const pick = (orig) => {
    Q.chosen = orig;
    const ok = orig === qz.answer;
    Q.results.push({ id: c.id, ok });
    const pp = (store.progress[c.id] = store.progress[c.id] || {});
    pp[ok ? "r" : "w"] = (pp[ok ? "r" : "w"] || 0) + 1;
    pp.ok = ok;
    pp.t = Date.now();
    save();
    render();
  };
  const answered = Q.chosen !== null;
  const ok = answered && Q.chosen === qz.answer;
  return [
    h("div", { class: "row between" }, h("span", { class: "mono small muted" }, `${Q.i + 1} / ${Q.ids.length}`), h("button", { class: "linkish small", onclick: () => go("practice", { view: "result" }) }, "ここで終える")),
    bar((Q.i + (answered ? 1 : 0)) / Q.ids.length),
    h(
      "section",
      { class: "panel raised" },
      h("div", { class: "row" }, h("span", { class: "mono small muted" }, c.id), levelPips(c.level)),
      h("p", { class: "quiz-q" }, qz.q),
      quizChoiceButtons(qz.choices, Q.order, Q.chosen, qz.answer, pick),
      answered
        ? h(
            "div",
            { class: `feedback ${ok ? "ok" : "ng"}` },
            h("b", { class: "v" }, ok ? "正解" : "不正解"),
            h("p", null, qz.explain),
            h("button", { class: "linkish small", onclick: () => openCard(c.id, Q.ids) }, `「${c.title}」を読む ›`)
          )
        : null
    ),
    answered
      ? h(
          "div",
          { class: "row", style: "justify-content:flex-end" },
          h(
            "button",
            {
              class: "btn primary",
              onclick: () => {
                if (Q.i + 1 >= Q.ids.length) go("practice", { view: "result" });
                else {
                  Q.i += 1;
                  Q.chosen = null;
                  Q.order = shuffle([0, 1, 2, 3]);
                  render();
                  window.scrollTo(0, 0);
                }
              },
            },
            Q.i + 1 >= Q.ids.length ? "結果を見る" : "次の問題"
          )
        )
      : null,
  ];
}

function viewResult() {
  const Q = ui.practice.quiz;
  if (!Q) {
    ui.practice.view = "menu";
    return viewPractice();
  }
  const n = Q.results.length;
  const r = Q.results.filter((x) => x.ok).length;
  const wrong = Q.results.filter((x) => !x.ok).map((x) => CARD.get(x.id));
  return [
    h(
      "section",
      { class: "panel raised" },
      h("h1", null, `${n}問中 ${r}問 正解`),
      bar(n ? r / n : 0),
      h("p", { class: "muted small" }, "点数より、まちがえた項目を読み直して現場で1回使うことを優先する。")
    ),
    wrong.length ? h("section", { class: "stack" }, h("h2", null, "読み直す項目"), cardRows(wrong)) : h("p", null, "すべて正解。上のレベルに進むか、伴走で実際の相談整理に使ってみる。"),
    nextStepBox(wrong.length ? `「${wrong[0].title}」を読み直し、使い方を1つ自分の業務に書き換える` : "伴走でサンプル相談を開き、問題の整理を1件やってみる", false),
    h(
      "div",
      { class: "row" },
      wrong.length ? h("button", { class: "btn primary", onclick: () => startQuiz(wrong.map((c) => c.id)) }, "まちがえた問題だけ再挑戦") : null,
      h("button", { class: "btn", onclick: () => go("practice", { view: "menu" }) }, "練習メニューへ")
    ),
  ];
}

function viewDrill() {
  const D = (ui.practice.drill = ui.practice.drill || { i: 0, chosen: null, order: null });
  const d = DATA.drills[D.i];
  if (!D.order) D.order = shuffle([0, 1, 2, 3]);
  const answered = D.chosen !== null;
  return [
    h("div", { class: "row between" }, h("span", { class: "mono small muted" }, `誤り探し ${D.i + 1} / ${DATA.drills.length}`), h("button", { class: "linkish small", onclick: () => go("practice", { view: "menu" }) }, "練習メニューへ")),
    h(
      "section",
      { class: "panel raised" },
      h("span", { class: "eyebrow" }, "この主張の問題として最も適切なのは？"),
      h("blockquote", { class: "pitfall", style: "margin:0" }, h("b", null, "主張　"), d.claim),
      quizChoiceButtons(d.choices, D.order, D.chosen, d.answer, (orig) => {
        D.chosen = orig;
        render();
      }),
      answered
        ? h(
            "div",
            { class: `feedback ${D.chosen === d.answer ? "ok" : "ng"}` },
            h("b", { class: "v" }, D.chosen === d.answer ? "正解" : "不正解"),
            h("p", null, d.explain),
            h("span", { class: "tiny muted" }, `参照：${d.refs.join("、")}`)
          )
        : null
    ),
    h(
      "div",
      { class: "navbtns" },
      h(
        "button",
        {
          class: "btn ghost",
          disabled: D.i === 0,
          onclick: () => {
            ui.practice.drill = { i: D.i - 1, chosen: null, order: null };
            render();
          },
        },
        "‹ 前"
      ),
      h(
        "button",
        {
          class: "btn primary",
          disabled: D.i >= DATA.drills.length - 1,
          onclick: () => {
            ui.practice.drill = { i: D.i + 1, chosen: null, order: null };
            render();
            window.scrollTo(0, 0);
          },
        },
        "次 ›"
      )
    ),
  ];
}

// 計算ツール（練習タブと伴走の比較ステップで共用）
function numField(obj, key, label, hint, onChange) {
  return h(
    "label",
    { class: "field" },
    label,
    hint ? h("span", { class: "hint" }, hint) : null,
    h("input", {
      type: "text",
      inputmode: "decimal",
      value: obj[key] ?? "",
      oninput: (e) => {
        obj[key] = e.target.value;
        onChange();
      },
    })
  );
}
function periodSelect(obj, key, onChange) {
  return h(
    "select",
    {
      onchange: (e) => {
        obj[key] = e.target.value;
        onChange();
      },
      "aria-label": "期間",
    },
    Object.entries(PERIODS).map(([k, v]) => h("option", { value: k, selected: obj[key] === k ? "selected" : null }, `${v}あたり`))
  );
}

function pricingTool(st, onChange = () => {}) {
  const out = h("div", { class: "stack" });
  const draw = () => {
    const r = pricingCheck({
      benefit: { low: st.low, mid: st.mid, high: st.high },
      benefitPeriod: st.benefitPeriod,
      price: st.price,
      pricePeriod: st.pricePeriod,
      cost: st.cost,
      costPeriod: st.pricePeriod,
    });
    const mp = priceFromMargin(st.marginCost, st.margin === "" ? null : Number(st.margin) / 100);
    out.replaceChildren(
      h(
        "div",
        { class: "table-wrap" },
        h(
          "table",
          null,
          h("thead", null, h("tr", null, h("th", null, "指標"), h("th", null, "保守"), h("th", null, "標準"), h("th", null, "楽観"))),
          h(
            "tbody",
            null,
            h("tr", null, h("td", null, "顧客便益倍率 V/P（顧客側）"), ["low", "mid", "high"].map((k) => h("td", { class: "mono" }, fmtTimes(r.valueMultiple[k])))),
            h("tr", null, h("td", null, "原価倍率 P/C（自社側）"), h("td", { class: "mono", colspan: "3" }, fmtTimes(r.costMultiple))),
            h("tr", null, h("td", null, "自社粗利率 (P−C)/P"), h("td", { class: "mono", colspan: "3" }, fmtPct(r.grossMargin))),
            h("tr", null, h("td", null, `比較の期間`), h("td", { colspan: "3" }, `${PERIODS[r.basis]}あたりに換算（料金 ${fmtYen(r.P)}・原価 ${fmtYen(r.C)}）`))
          )
        )
      ),
      r.warnings.length ? h("ul", { class: "small", style: "margin:0;padding-left:1.2em;color:var(--bad)" }, r.warnings.map((w) => h("li", null, w))) : null,
      h("ul", { class: "small muted", style: "margin:0;padding-left:1.2em" }, r.notes.map((w) => h("li", null, w))),
      h("p", { class: "small" }, "目標粗利率からの売価 P＝C÷(1−g)：", h("b", { class: "mono" }, mp === null ? "—" : fmtYen(mp)))
    );
  };
  const changed = () => {
    draw();
    onChange();
  };
  draw();
  return h(
    "div",
    { class: "stack" },
    h("p", { class: "small muted" }, "数値は円。空欄は0として扱わず「—」になる。"),
    h(
      "div",
      { class: "grid2" },
      numField(st, "low", "顧客の便益V（保守）", "増分利益・削減費用など", changed),
      numField(st, "mid", "便益V（標準）", null, changed),
      numField(st, "high", "便益V（楽観）", null, changed),
      h("label", { class: "field" }, "便益の期間", periodSelect(st, "benefitPeriod", changed)),
      numField(st, "price", "料金P", "税・追加費用の扱いをそろえる", changed),
      h("label", { class: "field" }, "料金・原価の期間", periodSelect(st, "pricePeriod", changed)),
      numField(st, "cost", "提供原価C", "工数・外注・ツール・管理・修正", changed),
      numField(st, "marginCost", "（売価試算）原価C", null, changed),
      numField(st, "margin", "（売価試算）目標粗利率g（%）", null, changed)
    ),
    out
  );
}

function parseSeries(text) {
  return String(text)
    .split(/[,\n、，\t]/)
    .map((t) => t.trim())
    .map((t) => (t === "" || t === "-" || t === "ー" || t === "欠" ? null : t));
}
function seriesTool(st) {
  const out = h("div", { class: "stack" });
  const draw = () => {
    const r = seriesStats(parseSeries(st.text));
    out.replaceChildren(
      h(
        "div",
        { class: "table-wrap" },
        h(
          "table",
          null,
          h(
            "tbody",
            null,
            h("tr", null, h("th", null, "期間の日数"), h("td", { class: "mono" }, r.days)),
            h("tr", null, h("th", null, "観測できた日"), h("td", { class: "mono" }, `${r.observed}（うち実ゼロ ${r.zeros}）`)),
            h("tr", null, h("th", null, "欠測（取得失敗）"), h("td", { class: "mono" }, r.missing)),
            h("tr", null, h("th", null, "観測日の合計"), h("td", { class: "mono" }, fmtNum(r.observedTotal, 2))),
            h("tr", null, h("th", null, "観測日の平均（正）"), h("td", { class: "mono" }, fmtNum(r.observedMean, 2))),
            h("tr", null, h("th", null, h("s", null, "欠測を0で埋めた平均（誤）")), h("td", { class: "mono", style: "color:var(--bad)" }, fmtNum(r.zeroFilledMean, 2)))
          )
        )
      ),
      h("p", { class: "small" }, r.note)
    );
  };
  draw();
  return h(
    "div",
    { class: "stack" },
    h(
      "label",
      { class: "field" },
      "日別の値",
      h("span", { class: "hint" }, "カンマか改行で区切る。取れなかった日は空欄か「-」。実際にゼロの日は0"),
      h("textarea", {
        id: "series-text",
        value: st.text,
        oninput: (e) => {
          st.text = e.target.value;
          draw();
        },
      })
    ),
    out
  );
}
function beforeAfterTool(st) {
  const out = h("div", { class: "stack" });
  const draw = () => {
    const r = compareBeforeAfter({ before: st.before, after: st.after, controlBefore: st.cb, controlAfter: st.ca, checkedConfounders: st.checked });
    out.replaceChildren(
      h(
        "div",
        { class: "verdict" },
        h("b", null, r.label),
        h(
          "p",
          { class: "small" },
          `差 ${fmtNum(r.main.diff, 2)}、増減率 ${r.main.rate === null ? r.main.label : fmtPct(r.main.rate)}`,
          r.hasControl ? `／比較群の差 ${fmtNum(r.control.diff, 2)}／差の差 ${fmtNum(r.did, 2)}` : ""
        )
      ),
      r.cautions.length ? h("ul", { class: "small muted", style: "margin:0;padding-left:1.2em" }, r.cautions.map((c) => h("li", null, c))) : null
    );
  };
  draw();
  return h(
    "div",
    { class: "stack" },
    h(
      "div",
      { class: "grid2" },
      numField(st, "before", "導入前（施策した側）", null, draw),
      numField(st, "after", "導入後（施策した側）", "未取得なら空欄", draw),
      numField(st, "cb", "比較群の前（任意）", "施策していない店舗・担当など", draw),
      numField(st, "ca", "比較群の後（任意）", null, draw)
    ),
    h("span", { class: "eyebrow" }, "確認済みの交絡候補"),
    h(
      "div",
      { class: "stack" },
      CONFOUNDERS.map((c) =>
        h(
          "label",
          { class: "check" },
          h("input", {
            type: "checkbox",
            checked: st.checked.includes(c),
            onchange: (e) => {
              st.checked = e.target.checked ? [...st.checked, c] : st.checked.filter((x) => x !== c);
              draw();
            },
          }),
          c
        )
      )
    ),
    out
  );
}

function viewCalc() {
  const P = ui.practice;
  const tabs = [
    ["price", "価格の倍率"],
    ["series", "欠測と平均"],
    ["ba", "前後比較"],
  ];
  const body = { price: () => pricingTool(calcState.price), series: () => seriesTool(calcState.series), ba: () => beforeAfterTool(calcState.ba) }[P.calc]();
  return [
    h("button", { class: "linkish small", onclick: () => go("practice", { view: "menu" }) }, "‹ 練習メニュー"),
    h(
      "section",
      { class: "panel raised" },
      h("h1", null, "計算ツール"),
      h(
        "div",
        { class: "tabs", role: "tablist" },
        tabs.map(([k, t]) =>
          h(
            "button",
            {
              role: "tab",
              "aria-selected": P.calc === k ? "true" : "false",
              onclick: () => {
                P.calc = k;
                render();
              },
            },
            t
          )
        )
      ),
      body
    ),
  ];
}

// ---------------------------------------------------------------- 伴走
function currentSession() {
  if (ui.tab !== "consult" || ui.consult.view !== "session") return null;
  return store.sessions.find((s) => s.id === ui.consult.sessionId) || null;
}
function touch(s) {
  s.updatedAt = new Date().toISOString();
  saveSoon();
  refreshDerived();
}
function textField(s, obj, key, label, opts = {}) {
  const tag = opts.multi ? "textarea" : "input";
  return h(
    "label",
    { class: "field" },
    label,
    opts.hint ? h("span", { class: "hint" }, opts.hint) : null,
    h(tag, {
      type: opts.multi ? null : "text",
      id: opts.id || null,
      rows: opts.multi ? String(opts.rows || 2) : null,
      placeholder: opts.placeholder || null,
      value: obj[key] ?? "",
      oninput: (e) => {
        obj[key] = e.target.value;
        touch(s);
        if (opts.onInput) opts.onInput();
      },
    })
  );
}

function viewConsult() {
  const C = ui.consult;
  const s = currentSession();
  if (C.view === "session" && s) return viewSession(s);

  const open = (sess) => {
    ui.consult.sessionId = sess.id;
    go("consult", { view: "session" });
  };
  return [
    h(
      "section",
      { class: "panel raised" },
      h("h1", null, "相談を整理する"),
      h("p", { class: "muted small" }, "1画面1目的で、相談の開始→問題の整理→計画の比較→行動計画→振り返り→出力まで進める。入力はこのブラウザだけに保存され、外部へは送信しない。"),
      h("p", { class: "small", style: "color:var(--unknown)" }, "試作品のため、実在の顧客情報は入力せず架空のデータで試してください。"),
      h(
        "div",
        { class: "row" },
        h(
          "button",
          {
            class: "btn primary",
            onclick: () => {
              const sess = newSession();
              store.sessions.unshift(sess);
              save();
              open(sess);
            },
          },
          "新しい相談"
        ),
        h(
          "button",
          {
            class: "btn",
            onclick: () => {
              const sess = sampleSession();
              store.sessions.unshift(sess);
              save();
              open(sess);
            },
          },
          "サンプル（架空）を開く"
        )
      )
    ),
    store.sessions.length
      ? h(
          "section",
          { class: "stack" },
          store.sessions.map((sess) => {
            const miss = missingInfo(sess).length;
            const confirming = C.confirmDelete === sess.id;
            return h(
              "div",
              { class: "panel" },
              h(
                "div",
                { class: "row between" },
                h("button", { class: "linkish", style: "font-size:1rem", onclick: () => open(sess) }, sess.title || "無題の相談"),
                sess.isSample ? h("span", { class: "badge sample" }, "サンプル") : null
              ),
              h(
                "div",
                { class: "row small muted" },
                `${STEPS[sess.step].label}まで`,
                "・",
                `更新 ${sess.updatedAt.slice(0, 10)}`,
                "・",
                miss ? h("span", { class: "tbd" }, `不足・未合意 ${miss}件`) : h("span", { style: "color:var(--ok)" }, "不足なし")
              ),
              confirming
                ? h(
                    "div",
                    { class: "inline-confirm" },
                    "この相談を削除します。元に戻せません。",
                    h(
                      "button",
                      {
                        class: "btn small danger",
                        onclick: () => {
                          store.sessions = store.sessions.filter((x) => x.id !== sess.id);
                          C.confirmDelete = null;
                          save();
                          toast("削除しました");
                          render();
                        },
                      },
                      "削除する"
                    ),
                    h(
                      "button",
                      {
                        class: "btn small",
                        onclick: () => {
                          C.confirmDelete = null;
                          render();
                        },
                      },
                      "やめる"
                    )
                  )
                : h(
                    "div",
                    { class: "row" },
                    h("button", { class: "btn small", onclick: () => open(sess) }, "開く"),
                    h(
                      "button",
                      {
                        class: "btn small ghost",
                        onclick: () => {
                          C.confirmDelete = sess.id;
                          render();
                        },
                      },
                      "削除"
                    )
                  )
            );
          })
        )
      : h("p", { class: "muted small" }, "まだ相談はありません。まずサンプルを開いて操作を確かめてください。"),
  ];
}

function missingPanel(s) {
  const box = h("details", { class: "missing" });
  const draw = () => {
    const m = missingInfo(s);
    const open = box.open;
    box.replaceChildren(
      h("summary", null, m.length ? `不足・未合意 ${m.length}件` : "不足・未合意はありません"),
      m.length
        ? h(
            "ul",
            null,
            m.map((x) =>
              h(
                "li",
                null,
                h(
                  "button",
                  {
                    class: "linkish small",
                    onclick: () => {
                      s.step = x.step;
                      touch(s);
                      render();
                    },
                  },
                  `${STEPS[x.step].short}`
                ),
                "　",
                x.text
              )
            )
          )
        : null
    );
    box.open = open;
    box.style.borderColor = m.length ? "" : "var(--ok)";
  };
  draw();
  derived.push(draw);
  return box;
}

function smallestStepLive(s) {
  const box = h("div");
  const draw = () => {
    const st = smallestStep(s);
    box.replaceChildren(nextStepBox(st.text, st.suggested));
  };
  draw();
  derived.push(draw);
  return box;
}

function viewSession(s) {
  const stepper = h(
    "nav",
    { class: "stepper", "aria-label": "進行" },
    STEPS.map((st, i) =>
      h(
        "button",
        {
          class: i === s.step ? "current" : i < s.step ? "done" : "",
          "aria-current": i === s.step ? "step" : null,
          onclick: () => {
            s.step = i;
            touch(s);
            render();
            window.scrollTo(0, 0);
          },
        },
        h("i"),
        st.short
      )
    )
  );
  const body = [stepStart, stepSort, stepCompare, stepPlan, stepReview, stepExport][s.step](s);
  const move = (d) => {
    s.step = Math.max(0, Math.min(STEPS.length - 1, s.step + d));
    touch(s);
    render();
    window.scrollTo(0, 0);
  };
  return [
    h("button", { class: "linkish small", onclick: () => go("consult", { view: "list" }) }, "‹ 相談の一覧"),
    s.isSample ? h("div", { class: "sample-banner" }, h("b", null, "サンプル"), "　架空の相談データです。実在の顧客・実績・料金ではありません。") : null,
    h(
      "section",
      { class: "panel" },
      h("input", {
        type: "text",
        id: "session-title",
        "aria-label": "相談のタイトル",
        value: s.title,
        style: "font-weight:700;font-size:1.05rem",
        oninput: (e) => {
          s.title = e.target.value;
          touch(s);
        },
      }),
      stepper,
      missingPanel(s)
    ),
    h("section", { class: "panel raised" }, h("div", { class: "row between" }, h("h2", null, `${s.step + 1}. ${STEPS[s.step].label}`)), body),
    smallestStepLive(s),
    h(
      "div",
      { class: "navbtns" },
      h("button", { class: "btn", disabled: s.step === 0, onclick: () => move(-1) }, "‹ 戻る"),
      h("button", { class: "btn primary", disabled: s.step === STEPS.length - 1, onclick: () => move(1) }, s.step < STEPS.length - 1 ? `次へ：${STEPS[s.step + 1].label}` : "最後のステップ")
    ),
  ];
}

function stepStart(s) {
  const I = s.intake;
  return h(
    "div",
    { class: "stack", style: "gap:14px" },
    h("p", { class: "small muted" }, "最初は3問だけ。既に分かっていることは書き写して、聞き直さない。"),
    textField(s, I, "decideToday", "1. 今日は何が決まると、この時間を使ってよかったと思えますか？", { multi: true, id: "in-decide" }),
    textField(s, I, "current", "2. 最近困った具体的な場面を一つ（頻度・時間・件数があれば）", { multi: true, rows: 3, id: "in-current" }),
    textField(s, I, "deadline", "3. いつまでに決めたい・変えたいですか？", { id: "in-deadline", placeholder: "例：来月末" }),
    h(
      "details",
      { open: I.constraints || I.desired || I.decider || I.client ? true : null },
      h("summary", { style: "cursor:pointer;font-weight:700" }, "もう少し詳しく（任意）"),
      h(
        "div",
        { class: "stack", style: "margin-top:10px;gap:12px" },
        textField(s, I, "client", "相談者（架空名で）", { placeholder: "例：飲食店オーナーAさん" }),
        textField(s, I, "constraints", "守る制約", { multi: true, hint: "予算・既存ツール・扱えない情報など" }),
        textField(s, I, "desired", "望む成果", { multi: true }),
        textField(s, I, "decider", "誰が決めるか（意思決定者）"),
        h(
          "fieldset",
          { class: "stack", style: "border:0;padding:0;margin:0" },
          h("legend", { class: "small", style: "font-weight:700;color:var(--ink-2)" }, "支援の形（途中で変えるときは相手に説明する）"),
          Object.entries(SUPPORT_MODES).map(([k, v]) =>
            h(
              "label",
              { class: "check" },
              h("input", {
                type: "radio",
                name: "mode",
                checked: I.mode === k,
                onchange: () => {
                  I.mode = k;
                  touch(s);
                },
              }),
              v
            )
          )
        )
      )
    )
  );
}

function kindTag(kind) {
  return h("span", { class: `kind ${kind}` }, ITEM_KINDS[kind]?.label || kind);
}

function stepSort(s) {
  const draft = { kind: "fact", text: "", source: "" };
  const listMount = h("div", { class: "stack" });
  const drawList = () => {
    listMount.replaceChildren(
      ...Object.keys(ITEM_KINDS).map((kind) => {
        const xs = s.items.filter((i) => i.kind === kind);
        return h(
          "div",
          { class: "stack", style: "gap:6px" },
          h("div", { class: "row" }, kindTag(kind), h("span", { class: "tiny muted" }, ITEM_KINDS[kind].hint)),
          xs.length
            ? xs.map((it) =>
                h(
                  "div",
                  { class: `item ${kind}` },
                  h("textarea", {
                    rows: "2",
                    "aria-label": `${ITEM_KINDS[kind].label}の内容`,
                    value: it.text,
                    oninput: (e) => {
                      it.text = e.target.value;
                      touch(s);
                    },
                  }),
                  kind === "fact"
                    ? h("input", {
                        type: "text",
                        placeholder: "出典・日時（例：送付履歴 10/1〜10/31）",
                        "aria-label": "出典・日時",
                        value: it.source || "",
                        oninput: (e) => {
                          it.source = e.target.value;
                          touch(s);
                        },
                      })
                    : null,
                  h(
                    "div",
                    { class: "row" },
                    h(
                      "select",
                      {
                        "aria-label": "区分を変える",
                        style: "width:auto",
                        onchange: (e) => {
                          it.kind = e.target.value;
                          touch(s);
                          drawList();
                        },
                      },
                      Object.entries(ITEM_KINDS).map(([k, v]) => h("option", { value: k, selected: k === kind ? "selected" : null }, v.label))
                    ),
                    h(
                      "button",
                      {
                        class: "btn small ghost",
                        onclick: () => {
                          s.items = s.items.filter((x) => x.id !== it.id);
                          touch(s);
                          drawList();
                        },
                      },
                      "削除"
                    )
                  )
                )
              )
            : h("p", { class: "tiny muted" }, "（まだありません）")
        );
      })
    );
  };
  drawList();

  const kindSeg = h("div", { class: "seg", role: "radiogroup", "aria-label": "区分" });
  const drawSeg = () =>
    kindSeg.replaceChildren(
      ...Object.entries(ITEM_KINDS).map(([k, v]) =>
        h(
          "button",
          {
            class: "chip",
            role: "radio",
            "aria-checked": draft.kind === k ? "true" : "false",
            "aria-pressed": draft.kind === k ? "true" : "false",
            onclick: () => {
              draft.kind = k;
              drawSeg();
              srcInput.hidden = k !== "fact";
            },
          },
          v.label
        )
      )
    );
  const textInput = h("textarea", { id: "new-item", rows: "2", placeholder: "1件ずつ書く", oninput: (e) => (draft.text = e.target.value) });
  const srcInput = h("input", { type: "text", placeholder: "出典・日時（事実のとき）", oninput: (e) => (draft.source = e.target.value) });
  drawSeg();

  const issuePreview = h("p", { class: "issue-preview" });
  const drawIssue = () => (issuePreview.textContent = issueSentence(s.issue));
  drawIssue();
  derived.push(drawIssue);
  const iss = s.issue;

  return h(
    "div",
    { class: "stack", style: "gap:16px" },
    h("p", { class: "small muted" }, "事実・解釈・仮説・条件・未確認を分ける。仮説は2つ以上（代替説明）を置く。未測定の値は0にせず「未確認」に。"),
    h(
      "div",
      { class: "panel", style: "background:var(--paper)" },
      h("span", { class: "eyebrow" }, "追加する"),
      kindSeg,
      textInput,
      srcInput,
      h(
        "div",
        { class: "row", style: "justify-content:flex-end" },
        h(
          "button",
          {
            class: "btn primary small",
            onclick: () => {
              if (!draft.text.trim()) {
                toast("内容を書いてから追加してください");
                return;
              }
              s.items.push({ id: uid("i"), kind: draft.kind, text: draft.text.trim(), source: draft.kind === "fact" ? draft.source.trim() : "" });
              draft.text = "";
              draft.source = "";
              textInput.value = "";
              srcInput.value = "";
              touch(s);
              drawList();
            },
          },
          "追加"
        )
      )
    ),
    listMount,
    h("div", { class: "section-title" }, "課題の一文"),
    issuePreview,
    h(
      "div",
      { class: "grid2" },
      textField(s, iss, "target", "対象", { placeholder: "例：Bさんの見積書作成" }),
      textField(s, iss, "deadline", "期限"),
      textField(s, iss, "metric", "指標", { placeholder: "例：1件あたりの作成時間" }),
      textField(s, iss, "goal", "目標", { hint: "未定なら空欄（まず測定）" }),
      textField(s, iss, "constraint", "制約"),
      textField(s, iss, "decision", "何を決めるか")
    )
  );
}

function stepCompare(s) {
  s.pricing = s.pricing || { low: "", mid: "", high: "", benefitPeriod: "year", price: "", pricePeriod: "year", cost: "", marginCost: "", margin: "" };
  const R = s.recommend;
  const listMount = h("div", { class: "stack" });
  const drawOptions = () => {
    listMount.replaceChildren(
      ...s.options.map((o) =>
        h(
          "div",
          { class: `optcard${R.optionId === o.id ? " rec" : ""}` },
          h(
            "div",
            { class: "row between" },
            h("input", {
              type: "text",
              "aria-label": "案の名前",
              value: o.name,
              style: "font-weight:700;flex:1;min-width:0",
              oninput: (e) => {
                o.name = e.target.value;
                touch(s);
              },
            }),
            o.isStatusQuo ? h("span", { class: "badge general" }, "比較の基準") : null
          ),
          h(
            "label",
            { class: "check" },
            h("input", {
              type: "radio",
              name: "recommend",
              checked: R.optionId === o.id,
              onchange: () => {
                R.optionId = o.id;
                touch(s);
                drawOptions();
              },
            }),
            "この案を推奨する"
          ),
          h(
            "div",
            { class: "grid2" },
            textField(s, o, "desc", "内容", { multi: true }),
            textField(s, o, "cost", "費用", { hint: "未見積なら空欄" }),
            textField(s, o, "burden", "負担（顧客・現場）"),
            textField(s, o, "effect", "期待効果", { hint: "推定・目標と書き分ける" }),
            textField(s, o, "risk", "リスク"),
            textField(s, o, "check", "検証すること")
          ),
          o.isStatusQuo
            ? null
            : h(
                "div",
                { class: "row", style: "justify-content:flex-end" },
                h(
                  "button",
                  {
                    class: "btn small ghost",
                    onclick: () => {
                      s.options = s.options.filter((x) => x.id !== o.id);
                      if (R.optionId === o.id) R.optionId = "";
                      touch(s);
                      drawOptions();
                    },
                  },
                  "この案を削除"
                )
              )
        )
      )
    );
  };
  drawOptions();
  return h(
    "div",
    { class: "stack", style: "gap:16px" },
    h("p", { class: "small muted" }, "現状維持と比べる。重要な判断では仕組みの違う案（運用改善・既存ツール・個別開発など）を並べる。点数の根拠が薄ければ順位を精密に見せない。"),
    listMount,
    h(
      "button",
      {
        class: "btn",
        onclick: () => {
          const letter = "ABCDEFG"[s.options.filter((o) => !o.isStatusQuo).length] || "X";
          s.options.push({ id: uid("o"), name: `${letter} 新しい案`, desc: "", cost: "", burden: "", effect: "", risk: "", check: "", isStatusQuo: false });
          touch(s);
          drawOptions();
        },
      },
      "＋ 案を追加"
    ),
    h("div", { class: "section-title" }, "推奨の理由と見直し条件"),
    textField(s, R, "reason", "推奨理由", { multi: true, hint: "影響・実現性・費用・時間・安全性・運用負担から" }),
    textField(s, R, "revisit", "見直し・撤退の条件", { multi: true, hint: "例：2週間で時間が変わらなければ別案へ" }),
    h(
      "details",
      null,
      h("summary", { style: "cursor:pointer;font-weight:700" }, "価格の倍率を確かめる（V/P と P/C）"),
      h("div", { style: "margin-top:10px" }, pricingTool(s.pricing, () => touch(s)))
    )
  );
}

function stepPlan(s) {
  const listMount = h("div", { class: "stack" });
  const drawActions = () => {
    listMount.replaceChildren(
      ...(s.actions.length ? [] : [h("p", { class: "tiny muted" }, "（まだ行動がありません）")]),
      ...s.actions.map((a) => {
        const status = h("div", { class: "status-line" });
        const drawStatus = () => {
          status.replaceChildren(
            "担当：",
            h("span", { class: a.owner && a.agreed ? "" : a.owner ? "draft" : "tbd" }, ownerLabel(a)),
            "　期限：",
            h("span", { class: a.due && a.agreed ? "" : a.due ? "draft" : "tbd" }, dueLabel(a))
          );
        };
        drawStatus();
        derived.push(drawStatus);
        return h(
          "div",
          { class: "actcard" },
          textField(s, a, "what", "何をするか", { multi: true }),
          status,
          h("div", { class: "grid2" }, textField(s, a, "owner", "担当"), textField(s, a, "due", "期限", { placeholder: "例：10/24（金）" })),
          h(
            "label",
            { class: "check" },
            h("input", {
              type: "checkbox",
              checked: a.agreed,
              onchange: (e) => {
                a.agreed = e.target.checked;
                touch(s);
              },
            }),
            "担当・期限を相手と合意済み（未チェックは「案」と表示）"
          ),
          h("div", { class: "grid2" }, textField(s, a, "done", "完了条件", { hint: "「いい感じに」は不可" }), textField(s, a, "measure", "確かめ方")),
          h(
            "div",
            { class: "row between" },
            h(
              "select",
              {
                "aria-label": "状態",
                style: "width:auto",
                onchange: (e) => {
                  a.status = e.target.value;
                  touch(s);
                },
              },
              [
                ["todo", "未着手"],
                ["doing", "進行中"],
                ["done", "完了"],
              ].map(([k, v]) => h("option", { value: k, selected: a.status === k ? "selected" : null }, v))
            ),
            h(
              "button",
              {
                class: "btn small ghost",
                onclick: () => {
                  s.actions = s.actions.filter((x) => x.id !== a.id);
                  touch(s);
                  render();
                },
              },
              "削除"
            )
          )
        );
      })
    );
  };
  drawActions();
  return h(
    "div",
    { class: "stack", style: "gap:16px" },
    h("p", { class: "small muted" }, "誰が・いつまでに・何を・どう確かめるか。合意していない担当・期限は「案」、空は「未定」と表示する。"),
    listMount,
    h(
      "button",
      {
        class: "btn",
        onclick: () => {
          s.actions.push({ id: uid("a"), what: "", owner: "", due: "", done: "", measure: "", agreed: false, status: "todo" });
          touch(s);
          render();
        },
      },
      "＋ 行動を追加"
    ),
    h("div", { class: "section-title" }, "今日できる最小の一手"),
    textField(s, s, "nextStep", "今日、5〜15分でできること", { multi: true, hint: "必ず書く。空欄なら下に提案が出る", id: "in-next" })
  );
}

function stepReview(s) {
  const listMount = h("div", { class: "stack" });
  const drawRows = () => {
    listMount.replaceChildren(
      ...(s.review.length ? [] : [h("p", { class: "tiny muted" }, "（まだ指標がありません）")]),
      ...s.review.map((r) => {
        const verdict = h("div", { class: "verdict" });
        const drawVerdict = () => {
          const g = growthRate(r.before, r.after);
          const c = compareBeforeAfter({ before: r.before, after: r.after });
          verdict.replaceChildren(
            h("span", { class: "kind goal" }, "計画・仮説"),
            " ",
            r.plan || "未記入",
            h("br"),
            h("span", { class: "kind actual" }, "実績"),
            ` 前 ${r.before === "" ? "未取得" : r.before} → 後 ${r.after === "" ? "未取得" : r.after}`,
            g.diff !== null ? `（差 ${fmtNum(g.diff, 2)}${g.rate !== null ? `、${fmtPct(g.rate)}` : ""}）` : "",
            h("br"),
            h("b", { class: "small" }, c.label)
          );
        };
        drawVerdict();
        derived.push(drawVerdict);
        return h(
          "div",
          { class: "revcard" },
          textField(s, r, "metric", "指標", { placeholder: "例：見積1件あたりの作成時間（分）" }),
          textField(s, r, "plan", "計画・仮説（何が起きるはずか）", { multi: true }),
          h("div", { class: "grid2" }, textField(s, r, "before", "導入前（実績）", { hint: "未取得なら空欄" }), textField(s, r, "after", "導入後（実績）", { hint: "未取得なら空欄。0にしない" })),
          verdict,
          h(
            "div",
            { class: "row" },
            h("span", { class: "small", style: "font-weight:700" }, "仮説の判断"),
            ["支持", "棄却", "保留"].map((j) =>
              h(
                "label",
                { class: "check small" },
                h("input", {
                  type: "radio",
                  name: `judge-${r.id}`,
                  checked: (r.judge || "保留") === j,
                  onchange: () => {
                    r.judge = j;
                    touch(s);
                  },
                }),
                j
              )
            )
          ),
          textField(s, r, "note", "メモ（同時に変わった要因・不利な結果も）", { multi: true }),
          h(
            "div",
            { class: "row", style: "justify-content:flex-end" },
            h(
              "button",
              {
                class: "btn small ghost",
                onclick: () => {
                  s.review = s.review.filter((x) => x.id !== r.id);
                  touch(s);
                  render();
                },
              },
              "削除"
            )
          )
        );
      })
    );
  };
  drawRows();
  return h(
    "div",
    { class: "stack", style: "gap:16px" },
    h("p", { class: "small muted" }, "計画（仮説）と実績を並べ、実行の問題か仮説の問題かを分ける。前後の差は「関連」の段階で、比較群と交絡を確かめるまで効果と断定しない。"),
    listMount,
    h(
      "button",
      {
        class: "btn",
        onclick: () => {
          s.review.push({ id: uid("r"), metric: "", plan: "", before: "", after: "", judge: "", note: "" });
          touch(s);
          render();
        },
      },
      "＋ 指標を追加"
    ),
    textField(s, s, "reviewNext", "次の一手（継続・修正・中止のどれか）", { multi: true }),
    textField(s, s, "clarified", "明確になったこと（一文）", { multi: true, hint: "相談の最後に、相手の言葉で言えるか確かめる" })
  );
}

function stepExport(s) {
  const C = ui.consult;
  const outs = {
    memo: ["面談メモ", () => memoMarkdown(s), "mendan-memo"],
    proposal: ["提案の骨子", () => proposalMarkdown(s), "teian-kosshi"],
    plan: ["行動計画", () => planMarkdown(s), "koudou-keikaku"],
    all: ["まとめて", () => allMarkdown(s), "soudan-matome"],
    prompt: ["AI用プロンプト", () => diagnosisPrompt(s), "ai-prompt"],
  };
  if (!outs[C.outTab]) C.outTab = "memo";
  const [, make, base] = outs[C.outTab];
  const text = make();
  const pre = h("pre", { class: "md-out", tabindex: "0" }, text);
  return h(
    "div",
    { class: "stack", style: "gap:12px" },
    h(
      "div",
      { class: "tabs", role: "tablist" },
      Object.entries(outs).map(([k, [t]]) =>
        h(
          "button",
          {
            role: "tab",
            "aria-selected": C.outTab === k ? "true" : "false",
            onclick: () => {
              C.outTab = k;
              render();
            },
          },
          t
        )
      )
    ),
    C.outTab === "prompt"
      ? h(
          "p",
          { class: "small", style: "color:var(--unknown)" },
          "このツールはAIに接続していません。外部AIに貼る場合は、個人情報・機密を除き、利用条件を確認してから自分で貼ってください。AIの回答は草案として検証します。"
        )
      : h("p", { class: "small muted" }, "Markdown形式。未合意は「案」、空欄は「未定」「未記入」と出る。"),
    pre,
    h(
      "div",
      { class: "row" },
      h("button", { class: "btn primary", onclick: () => copyText(text, pre) }, "コピー"),
      h("button", { class: "btn", onclick: () => downloadText(`${base}-${new Date().toISOString().slice(0, 10)}.md`, text) }, "Markdownで保存"),
      h("span", { class: "tiny muted" }, "保存はローカル版で使える。Artifact表示ではコピーを使う")
    )
  );
}

// ---------------------------------------------------------------- 資料
function escHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}
function mdInline(s) {
  let t = escHtml(s);
  t = t.replace(/`([^`]+)`/g, "<code>$1</code>");
  t = t.replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>");
  t = t.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (m, label, href) => {
    if (/^https?:\/\//.test(href)) return `<a href="${href}" target="_blank" rel="noopener noreferrer">${label}</a>`;
    const doc = href.replace(/^references\//, "").replace(/\.md$/, "");
    return `<button class="linkish" data-doc="${escHtml(doc)}">${label}</button>`;
  });
  t = t.replace(/(^|[\s（(])(https?:\/\/[^\s）)<]+)/g, '$1<a href="$2" target="_blank" rel="noopener noreferrer">$2</a>');
  return t;
}
function mdToHtml(md) {
  const lines = md.replace(/^---\n[\s\S]*?\n---\n/, "").split("\n");
  const out = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      i++;
      continue;
    }
    const hm = line.match(/^(#{1,4})\s+(.*)$/);
    if (hm) {
      const lv = Math.min(4, hm[1].length);
      out.push(`<h${lv}>${mdInline(hm[2])}</h${lv}>`);
      i++;
      continue;
    }
    if (line.startsWith("```")) {
      const buf = [];
      i++;
      while (i < lines.length && !lines[i].startsWith("```")) buf.push(lines[i++]);
      i++;
      out.push(`<pre class="md-out">${escHtml(buf.join("\n"))}</pre>`);
      continue;
    }
    if (line.trim().startsWith("|")) {
      const rows = [];
      while (i < lines.length && lines[i].trim().startsWith("|")) rows.push(lines[i++].trim());
      const cells = (r) => r.replace(/^\||\|$/g, "").split("|").map((c) => c.trim());
      const head = cells(rows[0]);
      const body = rows.slice(rows[1] && /^\|?\s*:?-{2,}/.test(rows[1]) ? 2 : 1);
      out.push(
        `<div class="table-wrap"><table><thead><tr>${head.map((c) => `<th>${mdInline(c)}</th>`).join("")}</tr></thead><tbody>${body
          .map((r) => `<tr>${cells(r).map((c) => `<td>${mdInline(c)}</td>`).join("")}</tr>`)
          .join("")}</tbody></table></div>`
      );
      continue;
    }
    if (/^\s*([-*]|\d+\.)\s+/.test(line)) {
      const ordered = /^\s*\d+\./.test(line);
      const items = [];
      while (i < lines.length && /^\s*([-*]|\d+\.)\s+/.test(lines[i])) items.push(lines[i++].replace(/^\s*([-*]|\d+\.)\s+/, ""));
      out.push(`<${ordered ? "ol" : "ul"}>${items.map((x) => `<li>${mdInline(x)}</li>`).join("")}</${ordered ? "ol" : "ul"}>`);
      continue;
    }
    if (line.startsWith(">")) {
      const buf = [];
      while (i < lines.length && lines[i].startsWith(">")) buf.push(lines[i++].replace(/^>\s?/, ""));
      out.push(`<blockquote>${mdInline(buf.join(" "))}</blockquote>`);
      continue;
    }
    const buf = [];
    while (i < lines.length && lines[i].trim() && !/^(#{1,4}\s|\||>|```|\s*([-*]|\d+\.)\s)/.test(lines[i])) buf.push(lines[i++]);
    out.push(`<p>${mdInline(buf.join(" "))}</p>`);
  }
  return out.join("\n");
}

const RULES = [
  ["価格", "顧客便益÷料金（V/P）と料金÷提供原価（P/C）を区別する。一律の価格下限を強制しない"],
  ["売上", "売上＝客数×平均客単価。期間・税・値引き・分母をそろえる"],
  ["欠測", "未取得データをゼロにしない。観測できた期間と全期間を区別する"],
  ["因果", "導入前後の変化だけで原因や効果を断定しない"],
  ["質問", "自由回答で探索し、仮説を確認質問で検証する。誘導質問だけにしない"],
  ["AI", "AIが作った文章・数値・引用を自動的に正しいものと扱わない"],
  ["誠実さ", "作業時間の偽装、不要な納品遅延、顧客への不安の煽りをしない"],
  ["NLP", "対話・学習の補助。治療・成果・人格変容を保証しない"],
  ["専門領域", "法律・税務・医療などは確認事項を整理し、専門家の確認につなぐ"],
];

function viewLibrary() {
  const Lb = ui.library;
  const back = h("button", { class: "linkish small", onclick: () => go("library", { view: "menu" }) }, "‹ 資料の一覧");
  if (Lb.view === "doc") {
    const md = DATA.docs[Lb.doc];
    const meta = DOCS.find((d) => d.key === Lb.doc);
    const el = h("div", { class: "doc", html: md ? mdToHtml(md) : "<p>資料が見つかりません。</p>" });
    el.addEventListener("click", (e) => {
      const b = e.target.closest("[data-doc]");
      if (b && DATA.docs[b.dataset.doc]) go("library", { view: "doc", doc: b.dataset.doc });
    });
    return [back, h("p", { class: "tiny muted" }, meta ? meta.title : Lb.doc, "　RE:MAKEスキル資料（ユーザー提供）"), h("article", { class: "panel" }, el)];
  }
  if (Lb.view === "sources") {
    const src = DATA.sources;
    return [
      back,
      h("section", { class: "panel" }, h("h1", null, "出典台帳108件"), h("p", { class: "small muted" }, src.note), h("p", { class: "small muted" }, `原#${src.missingVideo.sourceId}：${src.missingVideo.note}`)),
      ...src.groups.map((g) =>
        h(
          "section",
          { class: "panel" },
          h("h2", null, `${g.id}. ${g.title}`),
          h(
            "div",
            { class: "src-list" },
            src.sources
              .filter((s) => s.group === g.id)
              .map((s) =>
                h(
                  "div",
                  { class: "src" },
                  h("span", { class: "n" }, `#${s.id}`),
                  h("span", null, h("a", { href: s.url, target: "_blank", rel: "noopener noreferrer" }, s.label), s.videoTitle ? h("span", { class: "tiny muted" }, `　${s.videoTitle}`) : null)
                )
              )
          )
        )
      ),
      h(
        "section",
        { class: "panel" },
        h("h2", null, "スキル作成時に監査された一次資料"),
        h("p", { class: "small muted" }, "corrections.md に記載。このツールで内容を再確認したものではない。"),
        h("div", { class: "src-list" }, src.primary.map((p) => h("div", { class: "src" }, h("span", { class: "n" }, `${p.no}`), h("span", null, h("a", { href: p.url, target: "_blank", rel: "noopener noreferrer" }, p.label), h("span", { class: "tiny muted" }, `　${p.note}`)))))
      ),
    ];
  }
  if (Lb.view === "about") {
    const skill = CARDS.filter((c) => c.basis === "skill").length;
    return [
      back,
      h(
        "article",
        { class: "panel doc" },
        h("h1", null, "このツールについて"),
        h("p", null, "RE:MAKEのAI導入支援・業務改善・店舗支援・NLP教育で、支援者が「誰が・いつまでに・何をするか、どう確かめるか」を明確にできるようになるための学習と実務の道具。"),
        h("h2", null, "知識333の作り方と根拠"),
        h(
          "ul",
          null,
          h("li", null, `目次（13章×4段階）はRE:MAKEスキルの領域と一般的なコンサルティングの基礎〜応用を網羅するように設計した。`),
          h("li", null, h("b", null, `RE:MAKE資料ベース（${skill}件）`), "：ユーザー提供の108資料の要約・35動画のNotebookLM要約・一次資料監査を統合したスキルに基づく。元資料の全文・動画全編は未確認。"),
          h("li", null, h("b", null, `一般知識・原典未照合（${CARDS.length - skill}件）`), "：一般的なコンサル知識としてClaudeが書いた。参考書籍は読み進める手がかりで、該当箇所や引用は確認していない。重要な判断の前に原典で確かめる。"),
          h("li", null, "クイズ・架空例・誤り探しはこのツール用に新しく作った練習材料。架空例の数値は説明用で、実績・相場・効果ではない。")
        ),
        h("h2", null, "AI接続"),
        h("p", null, "このツールはAIに接続していない。表示されるサンプルは架空データで、AIの回答ではない。AI用プロンプトはコピーのみで、送信はしない。")
      ),
    ];
  }
  if (Lb.view === "rules") {
    return [
      back,
      h(
        "section",
        { class: "panel" },
        h("h1", null, "内容上の重要ルール"),
        h("p", { class: "small muted" }, "依頼書（HANDOFF）とスキルの品質条件から。知識カード・伴走・計算ツールはこのルールに合わせて作っている。"),
        h("div", { class: "table-wrap" }, h("table", null, h("tbody", null, RULES.map(([k, v]) => h("tr", null, h("th", null, k), h("td", null, v))))))
      ),
    ];
  }
  if (Lb.view === "data") {
    const bytes = (() => {
      try {
        return (localStorage.getItem(KEY) || "").length;
      } catch {
        return 0;
      }
    })();
    return [
      back,
      h(
        "section",
        { class: "panel" },
        h("h1", null, "データと保存"),
        h(
          "ul",
          { class: "points" },
          h("li", null, "学習の進捗と相談データは、このブラウザの localStorage にだけ保存する。サーバーやAIには送らない。"),
          h("li", null, "ブラウザ保存は安全性を保証しない。共有端末では使わず、実在の顧客情報は入れない。"),
          h("li", null, "プライベートウィンドウやサイトデータの削除で消える。別の端末・ブラウザとは共有されない。"),
          h("li", null, "必要な相談は「出力」からMarkdownをコピーして、自分の管理する場所に保管する。")
        ),
        h("p", { class: "small" }, `保存状態：${storageOk ? "利用可" : "利用できない（このページを閉じると消える）"}／保存量 約${fmtNum(bytes / 1024, 1)}KB／相談 ${store.sessions.length}件`),
        Lb.confirmWipe
          ? h(
              "div",
              { class: "inline-confirm" },
              "進捗と相談をすべて削除します。元に戻せません。",
              h(
                "button",
                {
                  class: "btn small danger",
                  onclick: () => {
                    store = { progress: {}, sessions: [], prefs: {} };
                    try {
                      localStorage.removeItem(KEY);
                    } catch {
                      /* 何もしない */
                    }
                    Lb.confirmWipe = false;
                    toast("すべて削除しました");
                    render();
                  },
                },
                "すべて削除する"
              ),
              h(
                "button",
                {
                  class: "btn small",
                  onclick: () => {
                    Lb.confirmWipe = false;
                    render();
                  },
                },
                "やめる"
              )
            )
          : h(
              "button",
              {
                class: "btn danger",
                onclick: () => {
                  Lb.confirmWipe = true;
                  render();
                },
              },
              "このブラウザのデータを削除"
            )
      ),
    ];
  }
  const tile = (title, desc, onclick) => h("button", { class: "chapter-tile", onclick }, h("h3", null, title), h("p", null, desc));
  return [
    h("section", { class: "panel flat" }, h("h1", null, "資料")),
    h(
      "section",
      { class: "grid2" },
      tile("このツールについて", "目的・知識333の根拠区分・AI接続の有無", () => go("library", { view: "about" })),
      tile("内容上の重要ルール", "価格・売上・欠測・因果・質問・AI・NLP・専門領域", () => go("library", { view: "rules" })),
      tile("出典台帳108件", "元資料のリンクと確認状態", () => go("library", { view: "sources" })),
      tile("データと保存", "保存場所・削除の方法", () => go("library", { view: "data" }))
    ),
    h("h2", null, "RE:MAKEスキル資料"),
    h(
      "section",
      { class: "grid2" },
      DOCS.filter((d) => DATA.docs[d.key]).map((d) => tile(d.title, d.desc, () => go("library", { view: "doc", doc: d.key })))
    ),
  ];
}

// ---------------------------------------------------------------- 起動
function boot() {
  const nav = document.getElementById("tabbar");
  for (const [k, label] of TABS) {
    // 表示中のタブをもう一度押したら、そのタブの最初の画面へ戻る
    const roots = { learn: { view: "home", chapter: null }, practice: { view: "menu" }, consult: { view: "list" }, library: { view: "menu" } };
    const b = h(
      "button",
      { "data-tab": k, onclick: () => go(k, ui.tab === k ? roots[k] : null) },
      h("span", { html: ICONS[k], "aria-hidden": "true", style: "display:grid" }),
      label
    );
    nav.append(b);
  }
  const hash = (location.hash || "").slice(1);
  if (TABS.some(([k]) => k === hash)) ui.tab = hash;
  render();
}
boot();
