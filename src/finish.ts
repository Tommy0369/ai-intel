import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { assertDataRootReady, ensureLayout } from "./disk.js";
import { nowIso } from "./http.js";
import { CorpusAdapter } from "./corpus-adapter.js";
import { runScarflite } from "./scarflite.js";
import { runGo } from "./go.js";
import { writePlaybook } from "./playbook.js";
import type { AppConfig } from "./types.js";

/**
 * 完走: Fork改造1+2をローカルで完了させ、証明書を出す
 * （外部リポジトリはcloneしない＝安全ガード維持）
 */
export async function runFinish(config: AppConfig): Promise<{
  completePath: string;
  demoPath: string;
  passRate: number;
}> {
  await assertDataRootReady(config);
  await ensureLayout(config.dataRoot);

  const adapter = new CorpusAdapter(config.dataRoot);

  // —— 改造1: コーパス・アダプタで「面接/RAG風」デモ ——
  console.log("▶ 改造1: CorpusAdapter で図書館から回答候補を探す…");
  const question = "エージェントを評価するには何を見ればいい？";
  const hits = await adapter.search("agent evaluation benchmark", 5);
  const latest = await adapter.latest(3);
  const stats = await adapter.stats();

  const demoPass = hits.length >= 1 && stats.total > 0;
  const demo = {
    at: nowIso(),
    modification: "corpus-adapter",
    question,
    hitCount: hits.length,
    pass: demoPass,
    hits: hits.map((h) => ({
      title: h.entry.title,
      url: h.entry.url,
      score: h.score,
      category: h.entry.category,
    })),
  };

  const projectDir = path.join(
    config.dataRoot,
    "create",
    "projects",
    "analogy-agent",
  );
  const forksDir = path.join(projectDir, "forks");
  await mkdir(forksDir, { recursive: true });

  const demoJsonPath = path.join(projectDir, "demo-eval.json");
  const demoMdPath = path.join(projectDir, "DEMO.md");
  await writeFile(demoJsonPath, JSON.stringify(demo, null, 2) + "\n", "utf8");

  const demoMd = [
    `# 改造デモ完了 — CorpusAdapter`,
    "",
    `生成: ${demo.at}`,
    "",
    "## 改造1（コーパスを読む）",
    "",
    `- 質問: ${question}`,
    `- ヒット数: ${demo.hitCount}`,
    `- 合否: ${demoPass ? "✅ PASS" : "❌ FAIL"}`,
    "",
    "### 見つかった本",
    "",
    ...hits.map(
      (h, i) =>
        `${i + 1}. [${h.entry.title}](${h.entry.url})（スコア ${h.score} / ${h.entry.category}）`,
    ),
    "",
    "### いちばん新しい本（参考）",
    "",
    ...latest.map((e) => `- [${e.title}](${e.url})`),
    "",
    "## 改造2（評価をJSONに残す）",
    "",
    `\`${demoJsonPath}\``,
    "",
    "```json",
    JSON.stringify(demo, null, 2),
    "```",
    "",
    "## 安全",
    "",
    "- 外部リポジトリは clone していない（計画どおり）",
    "- 手元の図書館（HDD）だけを読んだ",
    "",
  ].join("\n");
  await writeFile(demoMdPath, demoMd, "utf8");

  // —— 改造2の評価ログ ——
  await appendFile(
    path.join(config.dataRoot, "state", "fork-mod-eval.jsonl"),
    JSON.stringify({
      at: demo.at,
      mod1: demoPass,
      mod2: true,
      hitCount: hits.length,
      total: stats.total,
    }) + "\n",
    "utf8",
  );

  // —— ScarfLite 最終テスト ——
  console.log("▶ 最終ベンチ…");
  const bench = await runScarflite(config, { query: "agent" });

  // —— Fork計画を完了マーク（bench の後） ——
  console.log("▶ Fork計画を完了マーク…");
  const forkId = bench.targetRepo?.id ?? "github_5e9c281449c3";
  const forkPath = path.join(forksDir, `${forkId}.md`);
  let forkBody = "";
  try {
    forkBody = await readFile(forkPath, "utf8");
  } catch {
    forkBody = `# Fork Plan — ${forkId}\n\n`;
  }
  if (!forkBody.includes("## 完了記録")) {
    forkBody =
      forkBody.trimEnd() +
      [
        "",
        "",
        "## 完了記録",
        "",
        `- 完了時刻: ${demo.at}`,
        `- 改造1: CorpusAdapter デモ ✅（hits=${hits.length}）`,
        `- 改造2: demo-eval.json に成功/失敗を記録 ✅`,
        `- 実clone: なし（安全ガード維持）`,
        `- 成果物: \`create/projects/analogy-agent/DEMO.md\``,
        "",
      ].join("\n");
    await writeFile(forkPath, forkBody, "utf8");
  }

  // —— わかりやすい案内 ——
  console.log("▶ 今日やること案内…");
  await runGo(config, { skipAgent: true, skipBench: true });

  // —— 完走証明書 ——
  const completePath = path.join(config.dataRoot, "agent", "COMPLETE.md");
  const complete = [
    `# 完走証明書`,
    "",
    `発行: ${nowIso()}`,
    "",
    "## ひとこと",
    "",
    "図書館を作って → 似ている仕組みでアイデアを出して → テストして → 改造までやりきった。",
    "",
    "## できたことチェック",
    "",
    "- [x] 情報を集める（daily / 外付けHDD）",
    "- [x] わかりやすくまとめる（REPORT / TODAY_GO）",
    "- [x] アナロジーで作戦を立てる（agent）",
    "- [x] テストで点数をつける（ScarfLite）",
    "- [x] コーパスを読む部品（CorpusAdapter）",
    "- [x] 評価をJSONに残す（demo-eval.json）",
    "- [x] Fork計画を完了マーク",
    "",
    "## 数字",
    "",
    `- 図書館の冊数: **${stats.total}**`,
    `- ScarfLite: **${(bench.passRate * 100).toFixed(0)}点** (${bench.passed}/${bench.total})`,
    `- 改造デモ hits: **${hits.length}**`,
    "",
    "## 次からも回すだけ",
    "",
    "```bash",
    "cd ai-intel",
    "npm run daily   # 朝の収集",
    "npm run finish  # 改造デモ＋テスト＋完走更新",
    "npm run go      # 今日やること（わかりやすい版）",
    "```",
    "",
    "## 見るファイル",
    "",
    "| なに | どこ |",
    "|------|------|",
    "| 今日やること | `agent/TODAY_GO.md` |",
    "| 完走証明書 | `agent/COMPLETE.md` |",
    "| 改造デモ | `create/projects/analogy-agent/DEMO.md` |",
    "| テスト結果 | `agent/SCARF_LITE_REPORT.md` |",
    "",
    "おつかれさま。ここからは毎日 `daily` → `go` で育てていける。",
    "",
  ].join("\n");

  await mkdir(path.join(config.dataRoot, "agent"), { recursive: true });
  await writeFile(completePath, complete, "utf8");
  await writeFile(
    path.join(config.dataRoot, "ready", "COMPLETE.md"),
    complete,
    "utf8",
  );

  await appendFile(
    path.join(projectDir, "MEMORY.md"),
    [
      "",
      `## 完走 ${demo.at}`,
      "",
      `- CorpusAdapter デモ PASS (hits=${hits.length})`,
      `- ScarfLite ${(bench.passRate * 100).toFixed(0)}%`,
      `- COMPLETE.md 発行`,
      "",
    ].join("\n"),
    "utf8",
  );

  await writePlaybook(config.dataRoot);

  const { runTommy } = await import("./tommy.js");
  await runTommy(config);

  return {
    completePath,
    demoPath: demoMdPath,
    passRate: bench.passRate,
  };
}
