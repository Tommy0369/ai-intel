import { mkdir, writeFile, appendFile, readFile } from "node:fs/promises";
import path from "node:path";
import { assertDataRootReady, ensureLayout } from "./disk.js";
import { nowIso } from "./http.js";
import {
  loadCatalog,
  pickTop,
  sortByRecency,
  topTags,
} from "./corpus.js";
import {
  SEED_ANALOGIES,
  findAnalogies,
  type AnalogyMapping,
} from "./analogy.js";
import type { AppConfig, CatalogEntry } from "./types.js";

export interface AgentRunResult {
  goal: string;
  analogies: number;
  deep: number;
  missionPath: string;
  analogiesPath: string;
  memoryPath: string;
}

function todayStamp(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function pickFocus(catalog: CatalogEntry[], goal: string): CatalogEntry[] {
  const g = goal.toLowerCase();
  const terms = g.split(/\s+/).filter((t) => t.length >= 2);
  const scored = catalog.map((e) => {
    const hay = `${e.title} ${e.tags?.join(" ") ?? ""} ${e.category}`.toLowerCase();
    let s = 0;
    for (const t of terms) if (hay.includes(t)) s += 2;
    if (/agent/.test(g) && /agent/.test(hay)) s += 3;
    if (/analog|アナロジ|想像/.test(g) && e.category !== "other") s += 1;
    return { e, s };
  });
  const hit = scored.filter((x) => x.s > 0).sort((a, b) => b.s - a.s);
  if (hit.length >= 8) return hit.slice(0, 30).map((x) => x.e);
  // ゴールが広い → 最新 + 高シグナル
  return pickTop(sortByRecency(catalog).slice(0, 80), 30);
}

function renderAnalogiesMd(
  goal: string,
  mappings: AnalogyMapping[],
  stamp: string,
): string {
  const deep = mappings.filter((m) => m.depth === "deep");
  const lines = [
    `# Analogy Map — ${stamp}`,
    "",
    `生成: ${nowIso()}`,
    `ゴール: ${goal}`,
    "",
    "Gentner 風の**構造写像**で、表層コピーではなく関係を移植する。",
    `深層アナロジー: **${deep.length}** / 全 ${mappings.length}`,
    "",
    "## 使い方",
    "",
    "1. 深層（deep）を優先して読め",
    "2. `agentMove` を実行手順に落とす",
    "3. `buildPrompt` を Cursor に渡し実装",
    "",
  ];

  lines.push("## 種アナロジー（定番の強い型）", "");
  for (const s of SEED_ANALOGIES) {
    lines.push(`### ${s.name}`);
    lines.push("");
    lines.push(`- id: \`${s.id}\``);
    lines.push(`- 源: ${s.sourceDomain}`);
    lines.push(`- 的: ${s.targetDomain}`);
    lines.push(`- 写像: ${s.mapping}`);
    lines.push(`- 設計図: ${s.agentBlueprint}`);
    lines.push("");
  }

  lines.push("## コーパスから抽出したアナロジー", "");
  for (const m of mappings) {
    lines.push(`### ${m.depth === "deep" ? "深層" : "浅層"} · ${m.id} (score ${m.score.toFixed(1)})`);
    lines.push("");
    lines.push("```");
    lines.push(m.analogy);
    lines.push("```");
    lines.push("");
    lines.push(`- 転送: ${m.transfer}`);
    lines.push(`- 次手: ${m.agentMove}`);
    lines.push(`- 源URL: ${m.source.entry.url}`);
    lines.push(`- 的URL: ${m.target.entry.url}`);
    lines.push("");
    lines.push("<details><summary>AIへの実装依頼</summary>");
    lines.push("");
    lines.push("```");
    lines.push(m.buildPrompt);
    lines.push("```");
    lines.push("");
    lines.push("</details>");
    lines.push("");
  }
  return lines.join("\n");
}

function renderMissionMd(
  goal: string,
  mappings: AnalogyMapping[],
  catalog: CatalogEntry[],
  stamp: string,
): string {
  const champion =
    mappings.find((m) => m.depth === "deep") ?? mappings[0] ?? null;
  const tags = topTags(catalog, 12);
  const seed = SEED_ANALOGIES.find((s) => s.id === "seed_orchestra")!;

  const lines = [
    `# STRONGEST AGENT MISSION — ${stamp}`,
    "",
    `生成: ${nowIso()}`,
    "",
    "## エージェントの正体",
    "",
    "**Analogy Conductor（アナロジー指揮者）**",
    "",
    "コーパスを『書架』、アナロジーを『楽譜』、実行を『演奏』とする。",
    `定番写像: ${seed.mapping}`,
    "",
    "## ゴール",
    "",
    goal,
    "",
    "## 世界認識（観測）",
    "",
    `- コーパス件数: ${catalog.length}`,
    `- 強いタグ: ${tags.map((t) => `\`${t.tag}\`(${t.count})`).join(" · ")}`,
    `- 抽出アナロジー: ${mappings.length}（深層 ${mappings.filter((m) => m.depth === "deep").length}）`,
    "",
    "## アーキテクチャ（4奏者）",
    "",
    "```",
    "Observe  →  Analogize  →  Plan  →  Act",
    " 司書        構造写像      指揮者     実行係",
    "```",
    "",
    "| 奏者 | 役割 | ツール |",
    "|------|------|--------|",
    "| Observe | コーパス・日次・レポートを読む | catalog / REPORT / daily |",
    "| Analogize | 深層アナロジーを選ぶ | findAnalogies + SEED |",
    "| Plan | 評価指標・予算・安全を決める | mission テンプレ |",
    "| Act | ファイルに残し次の実装を起動 | write mission/analogies |",
    "",
    "## ガードレール（免疫系アナロジー）",
    "",
    "1. **予算**: 1ランで外部APIを呼ばない（ローカルコーパスのみ）— コスト家計簿の写像",
    "2. **安全**: 破壊的コマンドや秘密ファイルは提案のみ、自動実行しない — off-switch の写像",
    "3. **評価**: 毎回『深層アナロジーを1つ以上出せたか』を合格条件にする — 道場の写像",
    "",
  ];

  if (champion) {
    lines.push("## 今日のチャンピオン・アナロジー（これを実装せよ）", "");
    lines.push(`- id: \`${champion.id}\``);
    lines.push(`- depth: **${champion.depth}**`);
    lines.push(`- 次手: ${champion.agentMove}`);
    lines.push("");
    lines.push("```");
    lines.push(champion.analogy);
    lines.push("```");
    lines.push("");
    lines.push("### 転送");
    lines.push("");
    lines.push(champion.transfer);
    lines.push("");
    lines.push("### Cursor に貼るプロンプト");
    lines.push("");
    lines.push("```");
    lines.push(champion.buildPrompt);
    lines.push("```");
    lines.push("");
  }

  lines.push("## 実行チェックリスト", "");
  lines.push("- [ ] ANALOGIES.md の深層を1つ選んだ");
  lines.push("- [ ] 評価指標を1つ決めた（例: 30秒で価値が伝わるデモ）");
  lines.push("- [ ] 安全ガードを1つ入れた");
  lines.push("- [ ] `create/projects/analogy-agent/` にメモを残した");
  lines.push("- [ ] 翌朝 `npm run daily` の新情報で再アナロジーする");
  lines.push("");
  lines.push("## 再起動コマンド", "");
  lines.push("```bash");
  lines.push("cd ai-intel && npm run agent");
  lines.push("cd ai-intel && npm run agent -- \"個人用コーディング秘書を作れ\"");
  lines.push("```");
  lines.push("");

  return lines.join("\n");
}

function renderMemoryAppend(
  goal: string,
  champion: AnalogyMapping | null,
  stamp: string,
): string {
  return [
    "",
    `## ${stamp} ${nowIso()}`,
    "",
    `- goal: ${goal}`,
    champion
      ? `- champion: ${champion.id} (${champion.depth}) — ${champion.agentMove}`
      : "- champion: (なし)",
    "",
  ].join("\n");
}

export async function runAgent(
  config: AppConfig,
  goal?: string,
): Promise<AgentRunResult> {
  await assertDataRootReady(config);
  await ensureLayout(config.dataRoot);

  const resolvedGoal =
    goal?.trim() ||
    "アナロジー思考でコーパスを燃料にし、評価と安全とコスト意識を持つ最強エージェントを設計・進化させる";

  console.log("▶ Observe — loading corpus…");
  const catalog = await loadCatalog(config.dataRoot);
  if (!catalog.length) {
    throw new Error("catalog が空です。先に npm run collect または npm run daily");
  }

  const focus = pickFocus(catalog, resolvedGoal);
  console.log(`  catalog=${catalog.length} focus=${focus.length}`);

  console.log("▶ Analogize — structure mapping…");
  const mappings = findAnalogies(focus, catalog, 12);
  const deep = mappings.filter((m) => m.depth === "deep").length;
  console.log(`  analogies=${mappings.length} deep=${deep}`);

  console.log("▶ Plan + Act — writing mission…");
  const stamp = todayStamp();
  const agentDir = path.join(config.dataRoot, "create", "projects", "analogy-agent");
  const dayDir = path.join(config.dataRoot, "agent", stamp);
  await mkdir(agentDir, { recursive: true });
  await mkdir(dayDir, { recursive: true });
  await mkdir(path.join(config.dataRoot, "agent"), { recursive: true });

  const analogiesBody = renderAnalogiesMd(resolvedGoal, mappings, stamp);
  const missionBody = renderMissionMd(resolvedGoal, mappings, catalog, stamp);

  const analogiesPath = path.join(dayDir, "ANALOGIES.md");
  const missionPath = path.join(dayDir, "MISSION.md");
  const latestMission = path.join(config.dataRoot, "agent", "MISSION.md");
  const latestAnalogies = path.join(config.dataRoot, "agent", "ANALOGIES.md");
  const memoryPath = path.join(agentDir, "MEMORY.md");

  await writeFile(analogiesPath, analogiesBody, "utf8");
  await writeFile(missionPath, missionBody, "utf8");
  await writeFile(latestMission, missionBody, "utf8");
  await writeFile(latestAnalogies, analogiesBody, "utf8");

  let memory = "";
  try {
    memory = await readFile(memoryPath, "utf8");
  } catch {
    memory = "# Analogy Agent Memory\n\nラン履歴。道場（評価）用。\n";
  }
  const champion = mappings.find((m) => m.depth === "deep") ?? mappings[0] ?? null;
  await writeFile(
    memoryPath,
    memory.trimEnd() + renderMemoryAppend(resolvedGoal, champion, stamp) + "\n",
    "utf8",
  );

  // 評価ログ（道場アナロジー）
  const evalPath = path.join(config.dataRoot, "state", "agent-eval.jsonl");
  await appendFile(
    evalPath,
    JSON.stringify({
      at: nowIso(),
      stamp,
      goal: resolvedGoal,
      analogies: mappings.length,
      deep,
      pass: deep >= 1,
      champion: champion?.id ?? null,
    }) + "\n",
    "utf8",
  );

  // チャンピオンの即実行用プロンプトを単体ファイルに
  if (champion) {
    await writeFile(
      path.join(config.dataRoot, "agent", "CHAMPION_PROMPT.md"),
      `# Champion Prompt\n\n${champion.buildPrompt}\n`,
      "utf8",
    );
    await writeFile(
      path.join(dayDir, "CHAMPION_PROMPT.md"),
      `# Champion Prompt\n\n${champion.buildPrompt}\n`,
      "utf8",
    );
  }

  return {
    goal: resolvedGoal,
    analogies: mappings.length,
    deep,
    missionPath: latestMission,
    analogiesPath: latestAnalogies,
    memoryPath,
  };
}
