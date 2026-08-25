import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { assertDataRootReady, ensureLayout } from "./disk.js";
import { nowIso } from "./http.js";
import { CorpusAdapter } from "./corpus-adapter.js";
import type { AppConfig } from "./types.js";
import { runDashboard } from "./dashboard.js";
import { glanceOf, rebuildTitleJaMap } from "./title-ja.js";
import { loadCatalog, sortByRecency } from "./corpus.js";

function todayStamp(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

async function readMaybe(...parts: string[]): Promise<string | null> {
  try {
    return await readFile(path.join(...parts), "utf8");
  } catch {
    return null;
  }
}

async function latestAutoLogSummary(dataRoot: string): Promise<{
  file: string | null;
  ok: boolean | null;
  excerpt: string;
}> {
  const logDir = path.join(dataRoot, "daily", "logs");
  try {
    const files = (await readdir(logDir))
      .filter((f) => f.startsWith("auto-") && f.endsWith(".log"))
      .sort()
      .reverse();
    if (!files.length) {
      return { file: null, ok: null, excerpt: "（まだ auto ログなし）" };
    }
    const file = path.join(logDir, files[0]);
    const raw = await readFile(file, "utf8");
    const lines = raw.trim().split("\n");
    const tail = lines.slice(-12).join("\n");
    const ok =
      /auto \(.*\) end/.test(raw) &&
      !/ERROR:/.test(raw.split("====").pop() ?? "");
    return {
      file: `daily/logs/${files[0]}`,
      ok,
      excerpt: tail.slice(0, 800),
    };
  } catch {
    return { file: null, ok: null, excerpt: "（ログフォルダを読めなかった）" };
  }
}

function extractPassRate(scarf: string | null): string {
  if (!scarf) return "まだ";
  const m = scarf.match(/\*\*score\*\*:\s*\*\*([0-9]+%)\*\*/i) ||
    scarf.match(/score:\s*\*\*([0-9]+%)\*\*/i) ||
    scarf.match(/([0-9]+%)\s*\([0-9]+\/[0-9]+\)/);
  if (m) return m[1];
  if (/✅ PASS/.test(scarf)) return "合格";
  if (/❌ FAIL/.test(scarf)) return "要チェック";
  return "確認中";
}

function extractChampionOneLiner(champion: string | null): string {
  if (!champion) return "まだチャンピオン案がないよ。`npm run agent` で作れる。";
  const src = champion.match(/【源】(.+)/)?.[1]?.trim();
  const move = champion.match(/エージェントの次手:\s*(.+)/)?.[1]?.trim();
  if (src && move) return `「${src.slice(0, 40)}…」の考え方を使って、${move}`;
  if (move) return move;
  return "MISSION / CHAMPION_PROMPT を開いて、いちばん上の案を1つ選ぼう。";
}

/**
 * とみー専用：次の行動がすぐ取れる目配りレポート
 */
export async function runTommy(
  config: AppConfig,
  opts?: { dashboard?: boolean },
): Promise<{ path: string }> {
  await assertDataRootReady(config);
  await ensureLayout(config.dataRoot);

  const root = config.dataRoot;
  const stamp = todayStamp();
  const adapter = new CorpusAdapter(root);
  const stats = await adapter.stats();
  const latest = await adapter.latest(3);
  const catalog = await loadCatalog(root);
  const titles = await rebuildTitleJaMap(root, catalog);
  const logInfo = await latestAutoLogSummary(root);

  const brief = await readMaybe(root, "daily", "TODAY.md");
  const scarf = await adapter.readAgentFile("SCARF_LITE_REPORT.md");
  const complete = await adapter.readAgentFile("COMPLETE.md");
  const champion = await adapter.readAgentFile("CHAMPION_PROMPT.md");
  const todayGo = await adapter.readAgentFile("TODAY_GO.md");
  const imagination = await readMaybe(root, "daily", "LATEST_IMAGINATION.md");

  const newCount =
    brief?.match(/新規取得:\s*\*\*(\d+)\*\*/)?.[1] ??
    brief?.match(/新規件数:\s*(\d+)/)?.[1] ??
    "？";
  const passLabel = extractPassRate(scarf);
  const autoOk =
    logInfo.ok === true
      ? "うまくいった"
      : logInfo.ok === false
        ? "途中で止まったかも"
        : complete && todayGo
          ? "前回まで完走済み（案内は最新）"
          : "まだ／不明";

  const hour = new Date().getHours();
  const greeting =
    hour < 11
      ? "おはよう、とみー。情報収集班、朝のブリーフィングだよ。"
      : hour < 18
        ? "こんにちは、とみー。班の続き、いこう。"
        : "お疲れ、とみー。帰る前に今日の任務だけ確認しよう。";

  const careNote =
    logInfo.ok === false
      ? "班は無事。下の『困ったとき』から再開できるよ。"
      : passLabel.includes("要") || passLabel === "まだ"
        ? "テストは後回しでOK。まずは新着を1件見るだけで任務クリア寄り。"
        : "調子いい。今日の任務は小さく1つで十分。";

  const nextActions = [
    {
      n: "①",
      title: "船隊で集める（またはリンクを見る）",
      why: "班の本丸は『集めて分ける』。キーワードならバースト船隊",
      do: "アプリ『収集』でキーワード収集 → 終わったら『リンク』で動画/Webを確認",
    },
    {
      n: "②",
      title: "知識の書を HTML でひらく",
      why: "近い話題を束ねたパックが、考える材料になる",
      do: latest[0]
        ? `アプリ『ノート』→ HTMLで出す → NOTEBOOK.html。気になる話題を1つ開く（例: ${glanceOf(latest[0], titles)}）`
        : "アプリ『ノート』でクラスタを解析し、『HTMLで出す』を押す",
    },
    {
      n: "③",
      title: "小さな一手だけ進める",
      why: "長い作戦文は後でいい。次の一手だけ",
      do: extractChampionOneLiner(champion),
    },
  ];

  const lv = Math.max(1, Math.floor(Math.sqrt(stats.total / 8)) + 1);

  const lines = [
    `# 情報収集班 — とみーの今日`,
    "",
    `${greeting}`,
    "",
    `更新: ${nowIso()}（${stamp}）`,
    "",
    `> ${careNote}`,
    "",
    "---",
    "",
    "## 今日のひとこと",
    "",
    complete
      ? "班の仕組みはもうある。あとは毎日ちょっと触るだけ。"
      : "まず自動収集を1回通そう。通ったら、あとは育てる番。",
    "",
    "## 班のステータス",
    "",
    `| 項目 | いま |`,
    `|------|------|`,
    `| 班レベル | **Lv ${lv}**（収集経験） |`,
    `| 収集ストック | **${stats.total}** |`,
    `| きょうの新規 | **${newCount}** |`,
    `| テスト | **${passLabel}** |`,
    `| 自動収集 | **${autoOk}** |`,
    "",
    "## 今日の任務（この3つだけ）",
    "",
  ];

  for (const a of nextActions) {
    lines.push(`### ${a.n} ${a.title}`);
    lines.push("");
    lines.push(`- ねらい: ${a.why}`);
    lines.push(`- やること: ${a.do}`);
    lines.push("");
  }

  lines.push("---", "", "## よく見る場所", "");
  lines.push("| 順 | ファイル | なにがわかる |");
  lines.push("|----|----------|--------------|");
  lines.push("| 1 | `ready/DASHBOARD.html` | **班の画面**（棚・新着・任務） |");
  lines.push("| 2 | `ready/LINKS.html` | **リンク一覧**（動画 / Web / 論文） |");
  lines.push("| 3 | `ready/NOTEBOOK.html` | **知識の書 HTML**（話題パック） |");
  lines.push("| 4 | iCloud `intel-bridge/mobile/` | **スマホ用画面**（Filesアプリ） |");
  lines.push("| 5 | `agent/TOMMY.md` | **いまのこれ**（任務メモ） |");
  lines.push("| 6 | `agent/TODAY_GO.md` | もう少し詳しい手順 |");
  lines.push("| 7 | `agent/CHAMPION_PROMPT.md` | 今日いちばん強い一手 |");
  lines.push("| 8 | iCloud `intel-bridge/LATEST/` | SNS側へ渡す理解パック |");
  lines.push("");
  lines.push("アプリの流れ: **収集（船隊）→ リンク一覧 → 知識の書 HTML → 今日の任務**");
  lines.push("スマホ: `npm run phone:sync` のあと、iPhoneの**ファイル**→ iCloud `intel-bridge/mobile/DASHBOARD.html`");
  lines.push("同じWi-Fiなら `npm run phone` でURL配信もできる。");
  lines.push("");

  lines.push("## SNS側へ渡すもの", "");
  lines.push("収集班は投稿文を完成させない。");
  lines.push("**因数分解・アナロジー・メタファー済みの理解パック**を iCloud に置く。");
  lines.push("");
  lines.push("`iCloud Drive/99_システム/AI共有OS/AI活動OS/intel-bridge/LATEST/`");
  lines.push("");

  lines.push("## 班の重点部隊", "");
  lines.push("| 部隊 | 棚 | 担当 |");
  lines.push("|------|----|------|");
  lines.push("| ビジネス班 | `biz` | 経営・マーケ・集客・起業 |");
  lines.push("| 飲食チーム | `dining` | 外食・店舗・フードビジネス |");
  lines.push("| 先読み班 | `trends` | トレンド・新商品 |");
  lines.push("| 心理班 | `mind` | 心・行動経済 |");
  lines.push("| 身体班 | `body` | 運動・睡眠・栄養 |");
  lines.push("| レビュー班 | `reviews` | SR / メタアナリシス / レビュー論文 |");
  lines.push("| AI本体 | `agents` ほか | モデル・道具・研究 |");
  lines.push("");

  lines.push("## 新着ピック（3件）", "");
  lines.push("_日本語タイトルで一眼わかるようにしてあるよ（下に原文）_", "");
  if (!latest.length) {
    lines.push("_まだないよ。外付けをつないで `npm run auto` してね。_");
  } else {
    for (let i = 0; i < latest.length; i++) {
      const e = latest[i];
      lines.push(`${i + 1}. **${glanceOf(e, titles)}**`);
      lines.push(`   - 原文: ${e.title}`);
      lines.push(`   - ${e.category} / ${e.source}`);
      lines.push(`   - ${e.url}`);
      lines.push("");
    }
  }

  // 重点部隊の「いま何が来てるか」も日本語で
  const focusCats = [
    "biz",
    "dining",
    "trends",
    "mind",
    "body",
    "reviews",
  ] as const;
  lines.push("## 重点部隊のいま（日本語）", "");
  for (const cat of focusCats) {
    const hit = sortByRecency(catalog.filter((e) => e.category === cat))[0];
    if (!hit) {
      lines.push(`- **${cat}**: （まだなし）`);
    } else {
      lines.push(`- **${cat}**: ${glanceOf(hit, titles)}`);
    }
  }
  lines.push("");

  if (imagination) {
    const tops = [...imagination.matchAll(/^## (.+)$/gm)]
      .map((m) => m[1])
      .filter((t) => !/使い方|原則|トップ/.test(t))
      .slice(0, 2);
    if (tops.length) {
      lines.push("## 融合メモ（チラ見）", "");
      for (const t of tops) lines.push(`- ${t}`);
      lines.push("");
    }
  }

  lines.push("---", "", "## 困ったとき", "");
  lines.push("| 症状 | やること |");
  lines.push("|------|----------|");
  lines.push("| 外付けが見えない | ケーブル確認 → `/Volumes/外付け320GB` |");
  lines.push("| 自動が不安 | 上の「自動収集」欄を見る |");
  lines.push("| 何するか迷う | 任務③だけ。無理なら新着1件で今日は勝ち |");
  lines.push("");

  lines.push("## コマンド", "");
  lines.push("```bash");
  lines.push("cd ai-intel");
  lines.push("npm run auto    # 収集フル");
  lines.push("npm run tommy   # この案内＋画面を更新");
  lines.push("```");
  lines.push("");

  lines.push("<details><summary>ログ末尾（必要なときだけ）</summary>");
  lines.push("");
  lines.push("```");
  lines.push(logInfo.excerpt);
  lines.push("```");
  lines.push("");
  lines.push("</details>");
  lines.push("");

  if (todayGo) {
    lines.push("---", "", "## くわしく知りたいとき", "");
    lines.push("`agent/TODAY_GO.md` があるよ。");
    lines.push("");
  }

  lines.push("---", "");
  lines.push("とみー、情報収集班として今日も一歩でいい。また更新するね。");
  lines.push("");

  const body = lines.join("\n");
  const agentDir = path.join(root, "agent");
  await mkdir(agentDir, { recursive: true });
  const outPath = path.join(agentDir, "TOMMY.md");
  await writeFile(outPath, body, "utf8");
  await writeFile(path.join(root, "daily", "TOMMY.md"), body, "utf8");
  await writeFile(path.join(root, "ready", "TOMMY.md"), body, "utf8");
  await writeFile(path.join(agentDir, `TOMMY-${stamp}.md`), body, "utf8");

  const dash =
    opts?.dashboard === false
      ? { path: path.join(root, "ready", "DASHBOARD.html") }
      : await runDashboard(config);

  // 入口ポインタ
  await writeFile(
    path.join(root, "START_HERE.md"),
    `# 情報収集班 — ここから

## いちばんかんたん

デスクトップの **「とみーの今日」** をダブルクリック  
→ 班の画面が開くよ

## ファイル

1. 画面 → [ready/DASHBOARD.html](ready/DASHBOARD.html)
2. リンク → [ready/LINKS.html](ready/LINKS.html)
3. 知識の書 → [ready/NOTEBOOK.html](ready/NOTEBOOK.html)
4. 任務メモ → [agent/TOMMY.md](agent/TOMMY.md) の ①②③

ボタンを置き直す: \`cd ai-intel && npm run desktop\`

最終生成: \`${dash.path}\`
`,
    "utf8",
  );

  return { path: outPath };
}

export interface TommyBrief {
  ok: true;
  path: string;
  greeting: string;
  careNote: string;
  level: number;
  catalogTotal: number;
  newCount: string;
  passLabel: string;
  autoOk: string;
  missions: Array<{ n: string; title: string; why: string; do: string }>;
  latest: Array<{ titleJa: string; title: string; url: string; category: string }>;
  workflow: Array<{ id: string; label: string; hint: string }>;
  generatedAt: string;
}

/** アプリ用の構造化ブリーフィング（MDも同時更新・画面再生成はスキップ） */
export async function runTommyBrief(config: AppConfig): Promise<TommyBrief> {
  const { path: outPath } = await runTommy(config, { dashboard: false });
  const root = config.dataRoot;
  const adapter = new CorpusAdapter(root);
  const stats = await adapter.stats();
  const latest = await adapter.latest(3);
  const catalog = await loadCatalog(root);
  const titles = await rebuildTitleJaMap(root, catalog);
  const scarf = await adapter.readAgentFile("SCARF_LITE_REPORT.md");
  const complete = await adapter.readAgentFile("COMPLETE.md");
  const champion = await adapter.readAgentFile("CHAMPION_PROMPT.md");
  const todayGo = await adapter.readAgentFile("TODAY_GO.md");
  const logInfo = await latestAutoLogSummary(root);
  const brief = await readMaybe(root, "daily", "TODAY.md");
  const newCount =
    brief?.match(/新規取得:\s*\*\*(\d+)\*\*/)?.[1] ??
    brief?.match(/新規件数:\s*(\d+)/)?.[1] ??
    "？";
  const passLabel = extractPassRate(scarf);
  const autoOk =
    logInfo.ok === true
      ? "うまくいった"
      : logInfo.ok === false
        ? "途中で止まったかも"
        : complete && todayGo
          ? "前回まで完走済み"
          : "まだ／不明";
  const hour = new Date().getHours();
  const greeting =
    hour < 11
      ? "おはよう。情報収集班、朝のブリーフィングだよ。"
      : hour < 18
        ? "こんにちは。班の続き、いこう。"
        : "お疲れ。帰る前に今日の任務だけ確認しよう。";
  const careNote =
    logInfo.ok === false
      ? "班は無事。下の任務から再開できるよ。"
      : passLabel.includes("要") || passLabel === "まだ"
        ? "テストは後回しでOK。まずはリンクかノートを1つ見るだけで任務クリア寄り。"
        : "調子いい。今日の任務は小さく1つで十分。";
  const lv = Math.max(1, Math.floor(Math.sqrt(stats.total / 8)) + 1);

  return {
    ok: true,
    path: outPath,
    greeting,
    careNote,
    level: lv,
    catalogTotal: stats.total,
    newCount,
    passLabel,
    autoOk,
    missions: [
      {
        n: "①",
        title: "船隊で集める（またはリンクを見る）",
        why: "班の本丸は『集めて分ける』",
        do: "アプリ『収集』→ 終わったら『リンク』で動画/Webを確認",
      },
      {
        n: "②",
        title: "知識の書を HTML でひらく",
        why: "近い話題を束ねたパックが考える材料になる",
        do: "アプリ『ノート』→ HTMLで出す → 話題を1つ開く",
      },
      {
        n: "③",
        title: "小さな一手だけ進める",
        why: "次の一手だけ",
        do: extractChampionOneLiner(champion),
      },
    ],
    latest: latest.map((e) => ({
      titleJa: glanceOf(e, titles),
      title: e.title,
      url: e.url,
      category: e.category,
    })),
    workflow: [
      { id: "saishuu", label: "収集", hint: "キーワードで船隊バースト、または常駐パトロール" },
      { id: "links", label: "リンク", hint: "動画 / Web / 論文に分けた一覧" },
      { id: "notebook", label: "ノート", hint: "話題を束ねて HTML 知識の書にする" },
      { id: "ninmu", label: "任務", hint: "今日の①②③と次の一手" },
    ],
    generatedAt: nowIso(),
  };
}
