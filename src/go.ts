import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { assertDataRootReady, ensureLayout } from "./disk.js";
import { nowIso } from "./http.js";
import { CorpusAdapter } from "./corpus-adapter.js";
import { runScarflite } from "./scarflite.js";
import { runAgent } from "./agent.js";
import type { AppConfig } from "./types.js";

function todayStamp(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/**
 * 中学生にもわかる「今日やること」1枚を作る
 */
export async function runGo(
  config: AppConfig,
  opts?: { skipBench?: boolean; skipAgent?: boolean },
): Promise<{ guidePath: string; passRate?: number }> {
  await assertDataRootReady(config);
  await ensureLayout(config.dataRoot);

  const adapter = new CorpusAdapter(config.dataRoot);
  const stats = await adapter.stats();
  const latest = await adapter.latest(5);
  const agentHits = await adapter.search("agent", 3);

  if (!opts?.skipAgent) {
    console.log("▶ agent（アナロジー作戦）…");
    await runAgent(
      config,
      "今日の最強の一歩を中学生にもわかる言葉で進めろ",
    );
  }

  let passRate: number | undefined;
  if (!opts?.skipBench) {
    console.log("▶ bench（ScarfLite テスト）…");
    const bench = await runScarflite(config, { query: "agent" });
    passRate = bench.passRate;
  }

  const champion =
    (await adapter.readAgentFile("CHAMPION_PROMPT.md"))?.slice(0, 500) ??
    "（まだ無い → npm run agent を先に）";
  const scarfHead =
    (await adapter.readAgentFile("SCARF_LITE_REPORT.md"))?.split("\n").slice(0, 20).join("\n") ??
    "";

  const stamp = todayStamp();
  const lines = [
    `# 今日やること（わかりやすい版）— ${stamp}`,
    "",
    `つくった時刻: ${nowIso()}`,
    "",
    "## いまの図書館",
    "",
    `- 本の数（コーパス）: **${stats.total}** 冊`,
    `- よく出てくる言葉: ${stats.tags.map((t) => `${t.tag}(${t.count})`).join(" / ")}`,
    "",
    "## たとえ",
    "",
    "1. 図書館に新しい本が届く（daily）",
    "2. 「これとあれ、似た仕組みだ」と考える（agent / アナロジー）",
    "3. テストで点数をつける（bench）",
    "4. 合格したら、小さく作る",
    "",
    "## 今日の3ステップ",
    "",
    "### ステップ1（5分）読む",
    "",
    "いちばん新しい本:",
    "",
    ...latest.map(
      (e, i) => `${i + 1}. [${e.title}](${e.url}) （${e.category}）`,
    ),
    "",
    "### ステップ2（10分）テストを見る",
    "",
    passRate != null
      ? `- ScarfLite の点数: **${(passRate * 100).toFixed(0)}点**（75点以上で合格）`
      : "- まだテストしてない → `npm run bench`",
    "",
    "```",
    scarfHead,
    "```",
    "",
    "### ステップ3（30〜60分）小さく作る",
    "",
    "今日のチャンピオン案（むずかしい文は後ででいい、下の『やること』だけ見る）:",
    "",
    "```",
    champion,
    "```",
    "",
    "**やること（かんたん）:**",
    "",
    "1. Fork計画ファイルを開く（`create/projects/analogy-agent/forks/`）",
    "2. 書いてある『改造1』を、自分のプロジェクトで1つだけ試す",
    "3. できたことを `MEMORY.md` に3行で書く",
    "",
    "## agent 関連のおすすめ本",
    "",
    ...agentHits.map(
      (h) => `- [${h.entry.title}](${h.entry.url})（スコア ${h.score}）`,
    ),
    "",
    "## コマンド（コピー用）",
    "",
    "```bash",
    "cd ai-intel",
    "npm run go          # この案内を再生成（agent+bench込み）",
    "npm run daily       # 朝の収集",
    "npm run agent       # アナロジー作戦",
    "npm run bench       # テスト",
    "```",
    "",
    "## できたかのチェック",
    "",
    "- [ ] 新しい本を1つ開いた",
    "- [ ] テストの点数を見た",
    "- [ ] 改造を1つ試した、または計画を1つ書いた",
    "",
  ];

  const dir = path.join(config.dataRoot, "agent");
  await mkdir(dir, { recursive: true });
  const guidePath = path.join(dir, "TODAY_GO.md");
  await writeFile(guidePath, lines.join("\n"), "utf8");
  await writeFile(
    path.join(config.dataRoot, "daily", "TODAY_GO.md"),
    lines.join("\n"),
    "utf8",
  );

  // アダプタの使い方サンプルも残す（Fork移植用）
  const adapterDoc = `# CorpusAdapter の使い方

\`\`\`ts
import { CorpusAdapter } from "./corpus-adapter.js";

const adapter = new CorpusAdapter("/Volumes/外付け320GB/ai-intel");
const hits = await adapter.search("agent", 5);
const latest = await adapter.latest(5);
\`\`\`

- ネットワーク不要（HDDの catalog だけ読む）
- OSS に移植するときは、このファイルをコピーして dataRoot を渡す
`;
  await writeFile(
    path.join(
      config.dataRoot,
      "create",
      "projects",
      "analogy-agent",
      "CORPUS_ADAPTER.md",
    ),
    adapterDoc,
    "utf8",
  );

  const { runTommy } = await import("./tommy.js");
  await runTommy(config);

  return { guidePath, passRate };
}
