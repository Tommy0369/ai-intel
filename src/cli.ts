#!/usr/bin/env npx tsx
import { loadConfig, loadSources } from "./config.js";
import { sleep } from "./http.js";
import {
  runCollect,
  runRebuildIndex,
  runStatus,
} from "./orchestrator.js";
import { runLearn } from "./learn.js";
import { runReviewsDigest } from "./reviews.js";
import { runForge } from "./forge.js";
import { runPrepare } from "./prepare.js";
import { runSearch } from "./search.js";
import { runDaily } from "./daily.js";
import { runAgent } from "./agent.js";
import { runScarflite } from "./scarflite.js";
import { runGo } from "./go.js";
import { runFinish } from "./finish.js";
import { runDashboard } from "./dashboard.js";
import { runPhone } from "./phone.js";
import { runShip, runShipByCategory } from "./ship.js";
import { runNotebook, runNotebookOne, analyzeCorpus } from "./notebook.js";
import {
  detectGoogleDriveMyDrive,
  runNotebookDrive,
} from "./notebook-drive.js";
import { enrichByIds, enrichCluster, enrichEntries } from "./enrich.js";
import { loadCatalog, sortByRecency } from "./corpus.js";
import type { ClusterOptions } from "./cluster.js";
import { runVet } from "./vet.js";
import { writePlaybook } from "./playbook.js";
import { assertDataRootReady, ensureLayout } from "./disk.js";
import { runLinksHtml } from "./links-html.js";
import { runNotebookHtml } from "./notebook-html.js";
import { printFleetStatus } from "./fleet/index.js";
import { runTommy, runTommyBrief } from "./tommy.js";
import { runIntelligence } from "./pipeline.js";
import { runEventEngine } from "./events/event-engine.js";
import { runTrendEngine } from "./trends/trend-engine.js";
import {
  formatEventStatus,
  loadEventState,
  loadEvents,
  summarizeEvents,
} from "./events/event-store.js";
import { runCrossIntelligence } from "./cross/cross-intelligence.js";
import { runIdeaEngine } from "./content/idea-engine.js";
import { runSourceHealth } from "./source-health/source-health.js";
import {
  learnPreferences,
  loadFeedback,
  normalizeFeedbackAction,
  recordFeedback,
} from "./feedback/feedback-store.js";
import { runPersistentNotebook } from "./notebook-persistent.js";
import {
  runDupApply,
  runDupStatus,
  runDupWatch,
} from "./dup-watch.js";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

interface NotebookFlags extends ClusterOptions {
  json: boolean;
  /** 1始まりの話題番号（単体書き出し用） */
  index?: number;
  enrich?: boolean;
  forceEnrich?: boolean;
  ids?: string[];
  limit?: number;
}

function parseNotebookFlags(args: string[]): NotebookFlags {
  const flags: NotebookFlags = { json: false, enrich: true };
  for (const a of args) {
    if (a === "--json") {
      flags.json = true;
      continue;
    }
    if (a === "--enrich" || a === "--with-enrich") {
      flags.enrich = true;
      continue;
    }
    if (a === "--no-enrich") {
      flags.enrich = false;
      continue;
    }
    if (a === "--force" || a === "--force-enrich") {
      flags.forceEnrich = true;
      continue;
    }
    const m = a.match(/^--([a-zA-Z]+)=(.+)$/);
    if (!m) continue;
    const [, key, raw] = m;
    if (key === "id" || key === "ids") {
      flags.ids = raw.split(",").map((s) => s.trim()).filter(Boolean);
      continue;
    }
    const num = Number(raw);
    if (!Number.isFinite(num)) continue;
    if (key === "similarity" || key === "sim") flags.similarity = num;
    else if (key === "min" || key === "minSize") flags.minSize = num;
    else if (key === "max" || key === "maxGroups") flags.maxGroups = num;
    else if (key === "maxSize" || key === "size") flags.maxSize = num;
    else if (key === "index" || key === "i" || key === "cluster") {
      flags.index = Math.round(num);
    } else if (key === "limit" || key === "n") {
      flags.limit = Math.round(num);
    }
  }
  return flags;
}

interface CollectFlags {
  json: boolean;
  keywords?: string[];
  from?: string;
  to?: string;
  keywordOnly?: boolean;
  profile?: "patrol" | "burst";
  burst?: boolean;
  maxMissions?: number;
  concurrency?: number;
}

function parseCollectFlags(args: string[]): CollectFlags {
  const flags: CollectFlags = { json: false };
  for (const a of args) {
    if (a === "--json") {
      flags.json = true;
      continue;
    }
    if (a === "--full") {
      flags.keywordOnly = false;
      continue;
    }
    if (a === "--keyword-only") {
      flags.keywordOnly = true;
      continue;
    }
    if (a === "--burst") {
      flags.burst = true;
      flags.profile = flags.profile ?? "burst";
      continue;
    }
    if (a === "--no-burst") {
      flags.burst = false;
      continue;
    }
    const m = a.match(/^--([a-zA-Z-]+)=(.*)$/);
    if (!m) continue;
    const [, key, raw] = m;
    if (key === "keyword" || key === "q" || key === "query") {
      const parts = raw
        .split(/[|,]/)
        .map((s) => s.trim())
        .filter(Boolean);
      flags.keywords = parts.length ? parts : raw.trim() ? [raw.trim()] : [];
      continue;
    }
    if (key === "profile" && (raw === "patrol" || raw === "burst")) {
      flags.profile = raw;
      continue;
    }
    if (key === "max-missions" || key === "missions") {
      const n = Number(raw);
      if (Number.isFinite(n) && n > 0) flags.maxMissions = Math.round(n);
      continue;
    }
    if (key === "concurrency" || key === "workers") {
      const n = Number(raw);
      if (Number.isFinite(n) && n > 0) flags.concurrency = Math.round(n);
      continue;
    }
    if (
      (key === "from" || key === "since" || key === "to" || key === "until") &&
      /^\d{4}-\d{2}-\d{2}$/.test(raw.trim())
    ) {
      if (key === "from" || key === "since") flags.from = raw.trim();
      else flags.to = raw.trim();
    }
  }
  return flags;
}

/** JSON出力モード: 進捗ログを stderr に退避して stdout を汚さない */
async function withJsonStdout<T>(fn: () => Promise<T>): Promise<T> {
  const origLog = console.log;
  console.log = (...a: unknown[]) => console.error(...a);
  try {
    return await fn();
  } finally {
    console.log = origLog;
  }
}

function printHelp(): void {
  console.log(`
AI Intel — 収集 → アナロジー → 最強エージェント（外付けHDD）

  npm run intelligence         【知能】Event化→急上昇→クロス→ネタ→カード
  npm run events / trends / ideas / content / source:health
  npm run content:today        【今日】SNSネタ ready/content/TODAY.md
  npm run notebook:persistent  【NotebookLM】永続ソース更新
  npm run auto                 【自動】daily → finish → go → tommy → intelligence → ship
  npm run ship                 【iCloud】因数分解パックを別Mac AIへ渡す
  npm run ship:categories      【テスト】各カテゴリ3件を by-category/ へ渡す
  npm run notebook             【まとめ】全話題 enrich→bodies/ 付き NotebookLM フォルダ一括生成
  npm run notebook -- --no-enrich
                               【まとめ】本文取得なしでフォルダだけ再生成
  npm run notebook:one -- --index=2
                               【まとめ】選択話題の向こう側取得→詳細CONTEXT+bodies生成
  npm run notebook:drive       【Drive】NotebookLM用に CONTEXT+bodies を Google Drive へ公開
  bash scripts/setup-notebook-drive.sh
                               【Drive】Google Drive 同期パスを config に設定
  npm run enrich:cluster -- --index=2
                               【向こう側】話題メンバーの本文/字幕だけ取得
  npm run enrich -- --limit=20 【向こう側】直近N件を本文/字幕取得
  npm run collect -- --keyword="AI agent" --from=2026-07-01 --to=2026-07-31
                               【キーワード収集】バースト船隊＋LINKS.html
  npm run collect -- --profile=patrol
                               【常駐船隊】枠配分でパトロール収集
  npm run fleet                【常駐船隊】collect --profile=patrol の別名
  npm run fleet:status         【船隊】直近の任務台帳
  npm run links                【リンク】ready/LINKS.html（動画/Web分け）再生成
  npm run notebook:html        【知識の書】NOTEBOOK.html（話題HTMLパック）再生成
  npm run dup:watch            【重複監視】同一URL・近似・同題を検出（ウォッチ期間）
  npm run dup:apply            【重複隔離】ウォッチ後に代表以外を quarantine
  npm run dup:status           【重複】台帳サマリ
  npm run vet                  【精査】鮮度・信憑性を採点（精査期間つき）
  npm run reviews              【レビュー文献】SR / メタ / レビュー論文を日本語で整理
  npm run tommy                【とみー用】次の行動レポート
  npm run phone                【スマホ】iCloud同期 + 同じWi-Fiで配信
  npm run phone:sync           【スマホ】iCloudへ画面だけ置く
  npm run go / finish / daily
  npm run schedule:install     毎朝9時 + 起床/接続 + 30分常駐収集
  npm run desktop              デスクトップボタン

とみー: Desktop「とみーの今日」or agent/TOMMY.md
スマホ: iCloud intel-bridge/mobile/DASHBOARD.html / LINKS.html
受け手AI: iCloud AI共有OS/AI活動OS/intel-bridge/LATEST/
分野一覧: FIELDS.md / 船隊: FLEET.md / 精査知識: HDD vet/KNOWLEDGE.md
`);
}

async function main(): Promise<void> {
  const [, , cmd, ...args] = process.argv;

  if (!cmd || cmd === "--help" || cmd === "-h" || cmd === "help") {
    printHelp();
    return;
  }

  const config = await loadConfig();

  if (
    cmd === "intelligence" ||
    cmd === "events" ||
    cmd === "events:status" ||
    cmd === "trends" ||
    cmd === "cross" ||
    cmd === "ideas" ||
    cmd === "content" ||
    cmd === "content:today" ||
    cmd === "source:health" ||
    cmd === "source-health" ||
    cmd === "notebook:persistent" ||
    cmd === "knowledge"
  ) {
    if (cmd === "intelligence" || cmd === "content" || cmd === "content:today") {
      const asJson = args.includes("--json");
      const topArg = args.find((a) => a.startsWith("--top="));
      const top = topArg ? parseInt(topArg.split("=")[1] ?? "10", 10) : 10;
      const result = await runIntelligence(config);
      if (asJson) {
        console.log(JSON.stringify(result, null, 2));
        return;
      }
      console.log("\n✓ intelligence");
      console.log(`  events=${result.events} ideas=${result.ideas} cards=${result.cards}`);
      console.log(`  top priority (showing up to ${top}) — run with --json for full`);
      console.log(`  ${result.todayPath}`);
      return;
    }
    if (cmd === "events") {
      const rebuild = args.includes("--rebuild");
      const asJson = args.includes("--json");
      const catalog = await loadCatalog(config.dataRoot);
      const events = await runEventEngine(config, catalog, {
        rebuild,
        linkCatalog: true,
      });
      const state = summarizeEvents(events, catalog.length);
      if (asJson) {
        console.log(JSON.stringify({ state, events: events.slice(0, 50) }, null, 2));
        return;
      }
      console.log(formatEventStatus(state));
      console.log(`\n✓ events ${events.length}`);
      return;
    }
    if (cmd === "events:status") {
      const asJson = args.includes("--json");
      let state = await loadEventState(config.dataRoot);
      if (!state) {
        const events = await loadEvents(config.dataRoot);
        state = summarizeEvents(events);
      }
      if (asJson) {
        console.log(JSON.stringify(state, null, 2));
        return;
      }
      console.log(formatEventStatus(state));
      return;
    }
    if (cmd === "trends") {
      const events = await loadEvents(config.dataRoot);
      const next = await runTrendEngine(config.dataRoot, events);
      const asJson = args.includes("--json");
      const hotOnly = args.includes("--hot");
      const risingOnly = args.includes("--rising");
      let show = next;
      if (hotOnly) show = next.filter((e) => e.trendStatus === "hot");
      else if (risingOnly) {
        show = next.filter((e) => e.trendStatus === "rising" || e.trendStatus === "emerging");
      }
      show = [...show].sort((a, b) => b.velocity - a.velocity).slice(0, 20);
      if (asJson) {
        console.log(JSON.stringify({ count: show.length, trends: show }, null, 2));
        return;
      }
      for (const e of show) {
        console.log(
          `${(e.trendStatus ?? "stable").padEnd(10)} ${String(e.velocity).padStart(3)}  ${e.titleJa || e.title}`,
        );
      }
      console.log(`\n✓ trends ${show.length}`);
      return;
    }
    if (cmd === "cross") {
      const events = await loadEvents(config.dataRoot);
      const ins = await runCrossIntelligence(config.dataRoot, events);
      const asJson = args.includes("--json");
      const typeArg = args.find((a) => a.startsWith("--type="))?.slice(7);
      const topArg = args.find((a) => a.startsWith("--top="));
      const top = topArg ? parseInt(topArg.split("=")[1] ?? "30", 10) : 30;
      let show = ins;
      if (typeArg) {
        show = ins.filter((x) => x.relationship === typeArg);
      }
      show = show.slice(0, top);
      if (asJson) {
        console.log(JSON.stringify({ count: show.length, insights: show }, null, 2));
        return;
      }
      for (const x of show) {
        console.log(
          `${x.relationship.padEnd(14)} opp=${String(x.opportunityScore).padStart(3)}  ${x.title}`,
        );
      }
      console.log(`\n✓ cross ${show.length}/${ins.length}`);
      return;
    }
    if (cmd === "ideas") {
      const events = await loadEvents(config.dataRoot);
      const ideas = await runIdeaEngine(config.dataRoot, events);
      console.log(`\n✓ ideas ${ideas.length}`);
      return;
    }
    if (cmd === "source:health" || cmd === "source-health") {
      const rows = await runSourceHealth(config);
      const asJson = args.includes("--json");
      if (asJson) {
        console.log(JSON.stringify({ updatedAt: new Date().toISOString(), rows }, null, 2));
        return;
      }
      const { formatSourceHealthTable } = await import(
        "./source-health/source-health.js"
      );
      const healthy = rows.filter((r) => r.status === "healthy").length;
      const warning = rows.filter((r) => r.status === "warning").length;
      const dead = rows.filter((r) => r.status === "dead").length;
      console.log(formatSourceHealthTable(rows));
      console.log(
        `\n✓ source-health ${rows.length}（healthy ${healthy} / warning ${warning} / dead ${dead}）`,
      );
      return;
    }
    if (cmd === "knowledge") {
      const { runKnowledgeEngine } = await import("./knowledge/knowledge-engine.js");
      const events = await loadEvents(config.dataRoot);
      const asJson = args.includes("--json");
      const r = await runKnowledgeEngine(config.dataRoot, events);
      if (asJson) {
        console.log(JSON.stringify(r, null, 2));
        return;
      }
      console.log(
        `\n✓ knowledge entities=${r.entities} concepts=${r.concepts} claims=${r.claims} relations=${r.relations}`,
      );
      console.log(`  ${r.path}`);
      return;
    }
    if (cmd === "notebook:persistent") {
      const r = await runPersistentNotebook(config);
      console.log(`\n✓ persistent notebook ${r.dir} (${r.files.length} files)`);
      return;
    }
  }

  if (cmd === "feedback") {
    const targetId = args.find((a) => a.startsWith("--id="))?.slice(5);
    const label = args.find((a) => a.startsWith("--label="))?.slice(8);
    if (!targetId || !label) {
      console.error(
        "usage: tsx src/cli.ts feedback --id=evt_xxx --label=important|business|sns|...",
      );
      process.exit(1);
    }
    const action = normalizeFeedbackAction(label) || label;
    await recordFeedback(config.dataRoot, {
      at: new Date().toISOString(),
      targetType: "event",
      targetId,
      labels: [action],
    });
    console.log(`✓ feedback saved (${action})`);
    return;
  }

  if (cmd === "feedback:status") {
    const rows = await loadFeedback(config.dataRoot);
    const asJson = args.includes("--json");
    if (asJson) {
      console.log(JSON.stringify({ count: rows.length, rows: rows.slice(-50) }, null, 2));
      return;
    }
    console.log(`feedback records: ${rows.length}`);
    for (const r of rows.slice(-20)) {
      console.log(`  ${r.at.slice(0, 19)}  ${r.targetType}:${r.targetId}  ${r.labels.join(",")}`);
    }
    return;
  }

  if (cmd === "preferences" || cmd === "feedback:learn") {
    const state = await learnPreferences(config.dataRoot);
    if (args.includes("--json")) {
      console.log(JSON.stringify(state, null, 2));
      return;
    }
    console.log("recommended weight deltas (not auto-applied):");
    for (const [k, v] of Object.entries(state.recommended_weight_deltas)) {
      console.log(`  ${k}: ${v > 0 ? "+" : ""}${v}`);
    }
    for (const r of state.reasons) console.log(`  · ${r}`);
    console.log(`\n✓ preferences ${state.updated_at}`);
    return;
  }

  if (cmd === "ingest" || cmd === "ingest:status") {
    const { ingestFile, ingestFolder, personalStatus } = await import(
      "./personal/ingest.js"
    );
    if (cmd === "ingest:status") {
      const st = await personalStatus(config.dataRoot);
      if (args.includes("--json")) {
        console.log(JSON.stringify(st, null, 2));
        return;
      }
      console.log(`personal documents: ${st.documents}`);
      for (const [k, v] of Object.entries(st.byType)) console.log(`  ${k}: ${v}`);
      return;
    }
    const fileArg = args.find((a) => a.startsWith("--file="))?.slice(7);
    const folderArg = args.find((a) => a.startsWith("--folder="))?.slice(9);
    if (!fileArg && !folderArg) {
      console.error('usage: npm run ingest -- --file="/path" | --folder="/path"');
      process.exit(1);
    }
    const results = fileArg
      ? [await ingestFile(config.dataRoot, fileArg)]
      : await ingestFolder(config.dataRoot, folderArg!);
    for (const r of results) {
      console.log(`${r.status.padEnd(12)} ${r.path}${r.error ? `  (${r.error})` : ""}`);
    }
    const ok = results.filter((r) => r.status === "success").length;
    console.log(`\n✓ ingest success ${ok}/${results.length}`);
    return;
  }

  if (cmd === "status") {
    await runStatus(config);
    return;
  }

  if (cmd === "search") {
    await runSearch(config, args.join(" "));
    return;
  }

  if (cmd === "schedule:install" || cmd === "schedule:uninstall") {
    const script =
      cmd === "schedule:install"
        ? path.join(rootDir, "scripts", "install-schedule.sh")
        : path.join(rootDir, "scripts", "uninstall-schedule.sh");
    const r = spawnSync("bash", [script], { stdio: "inherit" });
    process.exit(r.status ?? 1);
  }

  if (cmd === "rebuild-index") {
    const total = await runRebuildIndex(config);
    await assertDataRootReady(config);
    await ensureLayout(config.dataRoot);
    await writePlaybook(config.dataRoot);
    console.log(`rebuilt catalog: ${total} entries`);
    return;
  }

  if (cmd === "learn") {
    const result = await runLearn(config);
    await writePlaybook(config.dataRoot);
    console.log(`✓ learn (${result.total} entries)`);
    console.log(`  ${result.curriculumPath}`);
    console.log(`  ${result.digestPath}`);
    return;
  }

  if (cmd === "reviews") {
    const result = await runReviewsDigest(config);
    console.log("\n✓ reviews digest");
    console.log(`  total: ${result.total}`);
    console.log(
      `  SR=${result.byKind["systematic-review"]} MA=${result.byKind["meta-analysis"]} Rev=${result.byKind["review-paper"]}`,
    );
    console.log(`  ${result.digestPath}`);
    console.log(`  ${result.briefPath}`);
    return;
  }

  if (cmd === "forge") {
    const result = await runForge(config);
    await writePlaybook(config.dataRoot);
    console.log(`✓ forge (${result.ideaCount} ideas)`);
    console.log(`  ${result.ideasPath}`);
    return;
  }

  if (cmd === "prepare") {
    const result = await runPrepare(config);
    console.log("\n✓ prepare done — 全件読込済みパック");
    console.log(`  readOk=${result.readOk}/${result.total} missing=${result.missing}`);
    console.log(`  bundles=${result.bundles}`);
    console.log(`  ${result.readyRoot}/PROMPT.md`);
    console.log(`  ${result.readyRoot}/OVERVIEW.md`);
    return;
  }

  if (cmd === "daily") {
    const result = await runDaily(config);
    await writePlaybook(config.dataRoot);
    console.log("\n✓ daily complete");
    console.log(`  date: ${result.stamp}`);
    console.log(`  new: ${result.newCount}`);
    console.log(`  imaginations: ${result.imaginationCount}`);
    console.log(`  ${result.dayDir}/BRIEF.md`);
    console.log(`  ${config.dataRoot}/daily/TODAY.md`);
    console.log(`  ${config.dataRoot}/daily/LATEST_IMAGINATION.md`);
    return;
  }

  if (cmd === "agent") {
    const goal = args.join(" ").trim() || undefined;
    const result = await runAgent(config, goal);
    await writePlaybook(config.dataRoot);
    console.log("\n✓ analogy agent complete");
    console.log(`  goal: ${result.goal}`);
    console.log(`  analogies: ${result.analogies} (deep ${result.deep})`);
    console.log(`  ${result.missionPath}`);
    console.log(`  ${result.analogiesPath}`);
    console.log(`  ${config.dataRoot}/agent/CHAMPION_PROMPT.md`);
    return;
  }

  if (cmd === "bench") {
    const query = args.join(" ").trim() || undefined;
    console.log(`ScarfLite bench${query ? ` query="${query}"` : ""}…`);
    const report = await runScarflite(config, { query });
    console.log("\n✓ ScarfLite complete");
    console.log(
      `  pass_rate: ${(report.passRate * 100).toFixed(0)}% (${report.passed}/${report.total}) ${report.passRate >= 0.75 ? "PASS" : "FAIL"}`,
    );
    console.log(`  target: ${report.targetRepo?.title ?? "(none)"}`);
    console.log(`  ${report.reportPath}`);
    if (report.forkPlanPath) console.log(`  fork: ${report.forkPlanPath}`);
    return;
  }

  if (cmd === "go") {
    console.log("今日やることガイドを生成します…");
    const result = await runGo(config);
    await writePlaybook(config.dataRoot);
    console.log("\n✓ go complete");
    console.log(`  ${result.guidePath}`);
    if (result.passRate != null) {
      console.log(`  bench: ${(result.passRate * 100).toFixed(0)}%`);
    }
    return;
  }

  if (cmd === "finish") {
    console.log("完走シーケンスを開始します…");
    const result = await runFinish(config);
    console.log("\n✓ 完走！");
    console.log(`  ${result.completePath}`);
    console.log(`  ${result.demoPath}`);
    console.log(`  bench: ${(result.passRate * 100).toFixed(0)}%`);
    return;
  }

  if (cmd === "auto") {
    console.log("自動フル儀式: daily → finish → go → tommy → intelligence → ship");
    const r = spawnSync(
      "bash",
      [path.join(rootDir, "scripts", "auto.sh"), "full"],
      { stdio: "inherit" },
    );
    process.exit(r.status ?? 1);
  }

  if (cmd === "tommy") {
    if (args.includes("--json")) {
      const brief = await withJsonStdout(() => runTommyBrief(config));
      process.stdout.write(JSON.stringify(brief));
      return;
    }
    const result = await runTommy(config);
    console.log("\n✓ とみー用レポート更新");
    console.log(`  ${result.path}`);
    console.log(`  dashboard: ${config.dataRoot}/ready/DASHBOARD.html`);
    return;
  }

  if (cmd === "dashboard") {
    const result = await runDashboard(config);
    console.log("\n✓ dashboard");
    console.log(`  ${result.path}`);
    console.log(`  スマホ用iCloud: ${result.mobilePath}/DASHBOARD.html`);
    return;
  }

  if (cmd === "phone" || cmd === "phone:sync") {
    const serve = cmd === "phone";
    if (!serve) {
      const result = await runPhone(config, { serve: false });
      console.log("\n✓ スマホ用画面を iCloud に置いたよ");
      console.log(`  ${result.mobilePath}/DASHBOARD.html`);
      console.log("  iPhone: ファイル → iCloud Drive → 99_システム → AI共有OS → AI活動OS → intel-bridge → mobile");
      return;
    }
    await runPhone(config, { serve: true });
    return;
  }

  if (cmd === "ship") {
    console.log("iCloud へ理解パックを出荷…");
    const result = await runShip(config);
    await writePlaybook(config.dataRoot);
    try {
      await runTommy(config);
    } catch {
      // tommy は補助
    }
    console.log("\n✓ ship complete");
    console.log(`  units: ${result.unitCount}`);
    console.log(`  ${result.outDir}`);
    console.log(`  ${result.latestDir}`);
    return;
  }

  if (cmd === "ship:categories" || cmd === "ship-categories") {
    console.log("テスト運用: 各カテゴリ3件 → intel-bridge/by-category …");
    const result = await runShipByCategory(config, { perCategory: 3 });
    console.log("\n✓ ship:categories complete");
    console.log(`  units: ${result.unitCount}`);
    console.log(`  ${result.rootDir}`);
    console.log(`  ${result.latestDir}`);
    for (const [cat, n] of Object.entries(result.perCategory)) {
      console.log(`  - ${cat}: ${n}`);
    }
    return;
  }

  if (cmd === "notebook:analyze") {
    const flags = parseNotebookFlags(args);
    const opts: ClusterOptions = {
      similarity: flags.similarity,
      minSize: flags.minSize,
      maxGroups: flags.maxGroups,
      maxSize: flags.maxSize,
    };
    if (flags.json) {
      const analysis = await withJsonStdout(() => analyzeCorpus(config, opts));
      process.stdout.write(JSON.stringify(analysis));
      return;
    }
    console.log("クラスタ解析中…");
    const analysis = await analyzeCorpus(config, opts);
    console.log("\n✓ analyze complete");
    console.log(`  total: ${analysis.totalItems}`);
    console.log(`  candidates: ${analysis.candidateCount}`);
    console.log(`  clusters: ${analysis.targetCount}`);
    return;
  }

  if (cmd === "enrich" || cmd === "enrich:cluster") {
    const flags = parseNotebookFlags(args);
    if (cmd === "enrich:cluster" || flags.index != null) {
      const index = flags.index;
      if (index == null) {
        console.error("使い方: npm run enrich:cluster -- --index=2");
        process.exitCode = 1;
        return;
      }
      const opts: ClusterOptions = {
        similarity: flags.similarity,
        minSize: flags.minSize,
        maxGroups: flags.maxGroups,
        maxSize: flags.maxSize,
      };
      if (flags.json) {
        const result = await withJsonStdout(() =>
          enrichCluster(config, index, opts, { force: flags.forceEnrich }),
        );
        process.stdout.write(JSON.stringify({ ok: true, ...result }));
        return;
      }
      const result = await enrichCluster(config, index, opts, {
        force: flags.forceEnrich,
      });
      console.log("\n✓ enrich:cluster complete");
      console.log(
        `  ok=${result.okCount} failed=${result.failedCount} skipped=${result.skippedCount}` +
          ` unique=${result.uniqueTotal}/${result.total}`,
      );
      return;
    }

    if (flags.ids?.length) {
      if (flags.json) {
        const result = await withJsonStdout(() =>
          enrichByIds(config, flags.ids!, { force: flags.forceEnrich }),
        );
        process.stdout.write(JSON.stringify({ ok: true, ...result }));
        return;
      }
      const result = await enrichByIds(config, flags.ids, {
        force: flags.forceEnrich,
      });
      console.log("\n✓ enrich complete");
      console.log(
        `  ok=${result.okCount} failed=${result.failedCount} skipped=${result.skippedCount}`,
      );
      return;
    }

    const limit = flags.limit ?? 20;
    const catalog = sortByRecency(await loadCatalog(config.dataRoot)).slice(
      0,
      limit,
    );
    if (flags.json) {
      const result = await withJsonStdout(() =>
        enrichEntries(config, catalog, { force: flags.forceEnrich }),
      );
      process.stdout.write(JSON.stringify({ ok: true, ...result }));
      return;
    }
    console.log(`enrich 直近 ${catalog.length} 件…`);
    const result = await enrichEntries(config, catalog, {
      force: flags.forceEnrich,
    });
    console.log("\n✓ enrich complete");
    console.log(
      `  ok=${result.okCount} failed=${result.failedCount} skipped=${result.skippedCount}` +
        ` unique=${result.uniqueTotal}/${result.total}`,
    );
    return;
  }

  if (cmd === "notebook:one" || cmd === "notebook:build-one") {
    const flags = parseNotebookFlags(args);
    const opts = {
      similarity: flags.similarity,
      minSize: flags.minSize,
      maxGroups: flags.maxGroups,
      maxSize: flags.maxSize,
      enrich: flags.enrich,
      forceEnrich: flags.forceEnrich,
    };
    const index = flags.index;
    if (index == null) {
      console.error("使い方: npm run notebook:one -- --index=2");
      process.exitCode = 1;
      return;
    }
    if (flags.json) {
      const result = await withJsonStdout(() =>
        runNotebookOne(config, index, opts),
      );
      process.stdout.write(JSON.stringify({ ok: true, ...result }));
      return;
    }
    console.log(`話題 #${String(index).padStart(2, "0")} の Notebook コンテキストを生成…`);
    const result = await runNotebookOne(config, index, opts);
    console.log("\n✓ notebook:one complete");
    console.log(`  title: ${result.titleJa}`);
    console.log(
      `  enrich: ok=${result.enrichOk ?? 0} failed=${result.enrichFailed ?? 0}` +
        ` unique=${result.uniqueTotal ?? "?"}`,
    );
    console.log(
      `  bodies: ${result.bodyFiles ?? 0} / coverage ${Math.round((result.coverage ?? 0) * 100)}%` +
        (result.coverageOk === false ? " ⚠" : " ✓"),
    );
    console.log(`  folder: ${result.folder}`);
    console.log(`  ${result.folderPath}`);
    return;
  }

  if (cmd === "notebook" || cmd === "cluster") {
    const flags = parseNotebookFlags(args);
    const opts = {
      similarity: flags.similarity,
      minSize: flags.minSize,
      maxGroups: flags.maxGroups,
      maxSize: flags.maxSize,
      enrich: flags.enrich,
      forceEnrich: flags.forceEnrich,
    };
    if (flags.json) {
      const result = await withJsonStdout(() => runNotebook(config, opts));
      process.stdout.write(JSON.stringify({ ok: true, ...result }));
      return;
    }
    console.log(
      flags.enrich === false
        ? "似た話題を束ねて Notebook フォルダを生成（enrich なし）…"
        : "似た話題を束ね、全話題の本文取得→bodies/ 付きで Notebook フォルダを生成…",
    );
    const result = await runNotebook(config, opts);
    console.log("\n✓ notebook complete");
    console.log(`  folders: ${result.clusterCount}`);
    console.log(`  clustered: ${result.clusteredItems}/${result.totalItems}`);
    if (flags.enrich !== false) {
      console.log(
        `  enrich: ok=${result.enrichOk ?? 0} failed=${result.enrichFailed ?? 0}` +
          ` unique=${result.uniqueTotal ?? 0}`,
      );
      console.log(
        `  bodies: ${result.bodyFiles ?? 0} files / coverageOK ${result.coverageOkCount ?? 0}/${result.clusterCount}`,
      );
    }
    console.log(`  ${result.outDir}`);
    console.log(`  index: ${result.indexPath}`);
    if (args.includes("--drive")) {
      console.log("\nDrive へ公開…");
      const drive = await runNotebookDrive(config);
      console.log(
        `✓ notebook:drive published=${drive.published} skipped=${drive.skipped} mode=${drive.mode}`,
      );
      console.log(`  ${drive.latestDir}`);
    }
    return;
  }

  if (cmd === "notebook:drive" || cmd === "drive") {
    const flags = parseNotebookFlags(args);
    if (flags.json) {
      const result = await withJsonStdout(() => runNotebookDrive(config));
      process.stdout.write(JSON.stringify({ ok: true, ...result }));
      return;
    }
    const detected = await detectGoogleDriveMyDrive();
    if (detected) {
      console.log(`Google Drive 検出: ${detected}`);
    } else {
      console.log(
        "Google Drive 未検出 → staging（HDD）へ書き、後で setup で Drive に接続可",
      );
    }
    console.log("NotebookLM 用パックを Drive / staging へ公開…");
    const result = await runNotebookDrive(config);
    console.log("\n✓ notebook:drive complete");
    console.log(`  mode: ${result.mode}`);
    console.log(`  published: ${result.published}（本文あり）`);
    console.log(`  skipped: ${result.skipped}（_skip/）`);
    console.log(`  inbox: ${result.inboxDir}`);
    console.log(`  LATEST: ${result.latestDir}`);
    if (result.mode === "staging") {
      console.log("");
      console.log("次の一手:");
      console.log("  1) Google Drive for desktop を入れてログイン");
      console.log("  2) npm run notebook:drive:setup");
      console.log("  3) npm run notebook:drive  （Drive の NotebookLM/ へ再公開）");
      console.log(`  控え: ${path.join(config.dataRoot, "notebook/drive-staging/LATEST")}`);
    }
    return;
  }

  if (cmd === "vet") {
    console.log("鮮度・信憑性の精査…");
    const result = await runVet(config);
    console.log("\n✓ vet complete");
    console.log(`  pass=${result.counts.pass} watch=${result.counts.watch} hold=${result.counts.hold} reject=${result.counts.reject}`);
    console.log(`  ${result.reportPath}`);
    return;
  }

  if (cmd === "dup:watch" || cmd === "dup") {
    const applyNow =
      args.includes("--apply") || args.includes("--now") || args.includes("--force");
    const hoursArg = args.find((a) => a.startsWith("--hours="));
    const watchHours = hoursArg
      ? Number(hoursArg.split("=")[1])
      : undefined;
    if (args.includes("--json")) {
      const result = await withJsonStdout(() =>
        runDupWatch(config, {
          applyNow,
          watchHours: Number.isFinite(watchHours) ? watchHours : undefined,
          refreshLinks: true,
        }),
      );
      const { groupsList: _g, ...rest } = result;
      process.stdout.write(JSON.stringify({ ok: true, ...rest }));
      return;
    }
    console.log("重複監視（同一URL / 近似URL / 同題 / 類似題）…");
    const result = await runDupWatch(config, {
      applyNow,
      watchHours: Number.isFinite(watchHours) ? watchHours : undefined,
      refreshLinks: true,
    });
    console.log("\n✓ dup:watch");
    console.log(`  scanned: ${result.scanned}`);
    console.log(`  groups: ${result.groups}`);
    console.log(`  dropCandidates: ${result.dropCandidates}`);
    console.log(`  byKind: ${JSON.stringify(result.byKind)}`);
    if (applyNow) console.log(`  applied now: ${result.applied}`);
    else console.log(`  holding: ${result.holding}（期間後に dup:apply）`);
    console.log(`  ${result.reportPath}`);
    return;
  }

  if (cmd === "dup:apply") {
    const force = args.includes("--now") || args.includes("--force");
    if (args.includes("--json")) {
      const result = await withJsonStdout(() =>
        runDupApply(config, { force, refreshLinks: true }),
      );
      process.stdout.write(JSON.stringify({ ok: true, ...result }));
      return;
    }
    console.log(
      force
        ? "重複隔離を即時適用…"
        : "ウォッチ期間が終わったグループを隔離…",
    );
    const result = await runDupApply(config, { force, refreshLinks: true });
    console.log("\n✓ dup:apply");
    console.log(`  applied: ${result.applied}`);
    console.log(`  skippedHolding: ${result.skippedHolding}`);
    console.log(`  movedFiles: ${result.movedFiles}`);
    console.log(`  catalog: ${result.catalogTotal}`);
    console.log(`  ${result.reportPath}`);
    return;
  }

  if (cmd === "dup:status") {
    if (args.includes("--json")) {
      const result = await withJsonStdout(() => runDupStatus(config));
      process.stdout.write(
        JSON.stringify({
          ok: true,
          ...result,
          latest: result.latest.map((g) => ({
            id: g.id,
            kind: g.kind,
            keepId: g.keepId,
            drops: g.dropIds.length,
            reason: g.reason,
            reviewUntil: g.reviewUntil,
            status: g.status,
          })),
        }),
      );
      return;
    }
    const result = await runDupStatus(config);
    console.log(`dup groups : ${result.groups}`);
    console.log(`holding    : ${result.holding}（drop待機 ${result.dropPending}）`);
    console.log(`applied    : ${result.applied}`);
    console.log(`report     : ${result.reportPath}`);
    return;
  }

  if (cmd === "fleet:status") {
    await assertDataRootReady(config);
    if (args.includes("--json")) {
      const { readFleetStatus } = await import("./fleet/index.js");
      const status = await readFleetStatus(config.dataRoot);
      process.stdout.write(JSON.stringify({ ok: true, ...status }));
      return;
    }
    await printFleetStatus(config.dataRoot);
    return;
  }

  if (cmd === "links") {
    if (args.includes("--json")) {
      const result = await withJsonStdout(() => runLinksHtml(config));
      process.stdout.write(JSON.stringify({ ok: true, ...result }));
      return;
    }
    console.log("LINKS.html を再生成…");
    const result = await runLinksHtml(config);
    console.log("\n✓ links");
    console.log(`  ${result.path}`);
    console.log(`  mobile: ${result.mobilePath}`);
    console.log(
      `  video=${result.counts.video} web=${result.counts.web} paper=${result.counts.paper}`,
    );
    if (result.packs) {
      console.log(
        `  カテゴリ別束: ${result.packs.packCount} · ${result.packs.dir}`,
      );
    }
    return;
  }

  if (cmd === "notebook:html") {
    const force = args.includes("--force") || args.includes("--reanalyze");
    console.log(
      force
        ? "知識の書 HTML を再解析して生成…"
        : "知識の書 HTML（NOTEBOOK.html）を生成…",
    );
    if (args.includes("--json")) {
      const result = await withJsonStdout(() =>
        runNotebookHtml(config, { forceAnalyze: force }),
      );
      process.stdout.write(JSON.stringify({ ok: true, ...result }));
      return;
    }
    const result = await runNotebookHtml(config, { forceAnalyze: force });
    console.log("\n✓ notebook:html");
    console.log(`  ${result.path}`);
    console.log(`  topics: ${result.topicCount}`);
    console.log(`  mobile: ${result.mobilePath}`);
    return;
  }

  if (cmd === "fleet" || cmd === "collect" || cmd === "cycle") {
    const sources = await loadSources();
    const flags = parseCollectFlags(args);
    const opts = {
      keywords: flags.keywords,
      from: flags.from,
      to: flags.to,
      keywordOnly: flags.keywordOnly,
      profile:
        cmd === "fleet"
          ? ("patrol" as const)
          : flags.profile ??
            (flags.keywords?.length ? ("burst" as const) : ("patrol" as const)),
      burst: flags.burst,
      maxMissions: flags.maxMissions,
      concurrency: flags.concurrency,
    };
    if (flags.json) {
      const result = await withJsonStdout(() =>
        runCollect(config, sources, opts),
      );
      process.stdout.write(JSON.stringify({ ok: true, ...result }));
      return;
    }
    console.log(`collect → ${config.dataRoot}`);
    console.log(`  profile: ${opts.profile}`);
    if (flags.keywords?.length) {
      console.log(`  keyword: ${flags.keywords.join(" / ")}`);
      if (flags.from || flags.to) {
        console.log(`  period : ${flags.from ?? "…"} 〜 ${flags.to ?? "…"}`);
      }
    }
    if (flags.maxMissions) console.log(`  maxMissions: ${flags.maxMissions}`);
    if (flags.concurrency) console.log(`  concurrency: ${flags.concurrency}`);
    const result = await runCollect(config, sources, opts);
    console.log("\n✓ collect done");
    console.log(`  fetched: ${result.fetched}`);
    console.log(`  written: ${result.written}`);
    console.log(`  skipped: ${result.skipped}`);
    console.log(`  bySource: ${JSON.stringify(result.bySource)}`);
    if (result.fleet) {
      console.log(
        `  fleet: ${result.fleet.profile} missions ${result.fleet.missionsDone}/${result.fleet.missionsTotal} (×${result.fleet.concurrency})`,
      );
    }
    if (result.linksHtml) console.log(`  links: ${result.linksHtml}`);
    if (result.errors.length) {
      console.log(`  errors: ${result.errors.length}`);
    }

    if (cmd === "cycle") {
      const prepared = await runPrepare(config);
      console.log(`\n✓ prepare → ${prepared.readyRoot}`);
      console.log(`  readOk=${prepared.readOk} bundles=${prepared.bundles}`);
    }
    return;
  }

  if (cmd === "collect:loop") {
    const sources = await loadSources();
    const intervalMs = Math.max(1, config.intervalMinutes) * 60_000;
    console.log(
      `collect:loop → ${config.dataRoot}（間隔 ${config.intervalMinutes} 分）`,
    );
    console.log("停止: Ctrl+C\n");

    for (;;) {
      const started = new Date().toISOString();
      console.log(`\n======== run ${started} ========`);
      try {
        const result = await runCollect(config, sources);
        console.log(
          `✓ written=${result.written} skipped=${result.skipped} fetched=${result.fetched}`,
        );
        const prepared = await runPrepare(config);
        console.log(
          `✓ prepare readOk=${prepared.readOk} bundles=${prepared.bundles}`,
        );
      } catch (err) {
        console.error(
          "run failed:",
          err instanceof Error ? err.message : err,
        );
      }
      console.log(`next in ${config.intervalMinutes} min…`);
      await sleep(intervalMs);
    }
  }

  console.error(`unknown command: ${cmd}`);
  printHelp();
  process.exit(1);
}

main().catch((err) => {
  console.error("\n❌", err instanceof Error ? err.message : err);
  process.exit(1);
});
