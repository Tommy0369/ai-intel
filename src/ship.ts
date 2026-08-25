import { mkdir, writeFile, copyFile, readdir } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { assertDataRootReady, ensureLayout } from "./disk.js";
import { nowIso } from "./http.js";
import { loadCatalog, pickTop, sortByRecency } from "./corpus.js";
import {
  unpackBatch,
  unpackEntry,
  loadEntryText,
  type UnpackedIntel,
} from "./unpack.js";
import { CATEGORIES, type AppConfig } from "./types.js";
import { findAnalogies } from "./analogy.js";
import { isShipEligible, loadVetLedger, runVet } from "./vet.js";

function todayStamp(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function defaultIcloudBridgeRoot(): string {
  return path.join(
    os.homedir(),
    "Library/Mobile Documents/com~apple~CloudDocs/99_システム/AI共有OS/AI活動OS/intel-bridge",
  );
}

export function resolveBridgeRoot(config: AppConfig): string {
  const fromConfig = (config as AppConfig & { icloudBridgeRoot?: string })
    .icloudBridgeRoot;
  return fromConfig?.trim() || defaultIcloudBridgeRoot();
}

function renderReceiverReadme(stamp: string, count: number): string {
  return `# 受け手AIへ — このパックの使い方

発行: ${stamp}  
件数: ${count}  
送り側: comic-shelf / ai-intel（収集Mac）  
共有路: iCloud（AI共有OS / intel-bridge）

## これは何か

投稿文の完成品ではない。  
**因数分解・アナロジー・メタファーで噛み砕いた「理解用データ」** である。

受け手（SNS稼働MacのAI）は、これを材料に:
- 文章（X / Threads / note / ブログ）
- 画像
- 動画
- 音楽

へ**変換**してよい。公開・投稿は各端末の承認ルールに従うこと。

## 読む順

1. \`PACK_BRIEF.md\` — 全体の地図（人間・AI共通）
2. \`units/UNIT_*.md\` — 1トピックずつ（因数分解済み）
3. \`units.jsonl\` — 機械一括読み込み用
4. \`MANIFEST.json\` — メタ情報

## 変換時の約束

- \`coreMessage\` と \`metaphors\` を先に使え（わかりやすさの核）
- \`source.url\` を必ず残す
- \`guardrails\` を破らない
- わからないことは推測で埋めず「要確認」と書け
`;
}

function renderPackBrief(stamp: string, units: UnpackedIntel[]): string {
  const lines = [
    `# Intel Pack Brief — ${stamp}`,
    "",
    `生成: ${nowIso()}`,
    "",
    "収集Macが、SNS用MacのAIに渡すための**理解パック**。",
    "目的: わからない人にも伝わるところまで因数分解し、アナロジーとメタファーで橋を架ける。",
    "",
    "## きょうの核（上位）",
    "",
  ];
  for (const u of units.slice(0, 5)) {
    lines.push(`### ${u.factors.oneLine}`);
    lines.push("");
    lines.push(`- たとえ: ${u.metaphors.dailyLife}`);
    lines.push(`- なぜ今: ${u.factors.whyNow}`);
    lines.push(`- 原文: ${u.source.url}`);
    lines.push(`- 変換ヒント: 文=${clipHint(u.modalityHints.text)} / 画=${clipHint(u.modalityHints.image)}`);
    lines.push("");
  }
  lines.push("## 受け手への一言", "");
  lines.push(
    "このパックは『投稿原稿』ではない。理解の設計図だ。設計図を、各SNSの形に翻訳してくれ。",
  );
  lines.push("");
  return lines.join("\n");
}

function clipHint(s: string): string {
  return s.length > 40 ? `${s.slice(0, 39)}…` : s;
}

function renderUnitMd(u: UnpackedIntel): string {
  const lines = [
    `# UNIT ${u.id}`,
    "",
    `source_id: \`${u.source.id}\``,
    `title: ${u.source.title}`,
    `url: ${u.source.url}`,
    `category/source: ${u.source.category}/${u.source.source}`,
    "",
    "## 核メッセージ",
    "",
    u.coreMessage,
    "",
    "## 因数分解",
    "",
    "### 一言",
    "",
    u.factors.oneLine,
    "",
    "### 部品（だれ/何が/どう/だから何）",
    "",
    `- だれ: ${u.factors.parts.who}`,
    `- 何が変わった: ${u.factors.parts.whatChanged}`,
    `- どうやって: ${u.factors.parts.how}`,
    `- だから何: ${u.factors.parts.soWhat}`,
    "",
    "### 小学生向け",
    "",
    u.factors.elementary,
    "",
    "### 中学生向け",
    "",
    "```",
    u.factors.juniorHigh,
    "```",
    "",
    "### 構造",
    "",
    u.factors.structure,
    "",
    "### なぜ今",
    "",
    u.factors.whyNow,
    "",
    "### 落とし穴",
    "",
    u.factors.pitfall,
    "",
    "## 具体フック（変換の取っ手）",
    "",
    ...(u.concreteHooks.length
      ? u.concreteHooks.map((h) => `- ${h}`)
      : ["- （タイトルから抽出弱め。原文を確認）"]),
    "",
    "## メタファー",
    "",
    `| 領域 | たとえ |`,
    `|------|--------|`,
    `| 日常 | ${u.metaphors.dailyLife} |`,
    `| 学校/スポーツ | ${u.metaphors.schoolOrSports} |`,
    `| 自然/身体 | ${u.metaphors.natureOrBody} |`,
    `| 仕事 | ${u.metaphors.workplace} |`,
    "",
  ];

  if (u.analogy) {
    lines.push("## アナロジー（構造写像）", "");
    lines.push(`- depth: **${u.analogy.depth}**`);
    lines.push(`- id: \`${u.analogy.id}\``);
    lines.push("");
    lines.push("```");
    lines.push(u.analogy.analogy);
    lines.push("```");
    lines.push("");
    lines.push(`転送: ${u.analogy.transfer}`);
    lines.push("");
  }

  lines.push("## モダリティ変換ヒント（受け手AI用）", "");
  lines.push(`- **文章**: ${u.modalityHints.text}`);
  lines.push(`- **画像**: ${u.modalityHints.image}`);
  lines.push(`- **動画**: ${u.modalityHints.video}`);
  lines.push(`- **音楽**: ${u.modalityHints.music}`);
  lines.push("");
  lines.push("## ガードレール", "");
  for (const g of u.guardrails) lines.push(`- ${g}`);
  lines.push("");
  return lines.join("\n");
}

function unitToJsonl(u: UnpackedIntel): Record<string, unknown> {
  return {
    id: u.id,
    source_id: u.source.id,
    title: u.source.title,
    url: u.source.url,
    category: u.source.category,
    source: u.source.source,
    core_message: u.coreMessage,
    factors: u.factors,
    concrete_hooks: u.concreteHooks,
    metaphors: u.metaphors,
    analogy: u.analogy
      ? {
          id: u.analogy.id,
          depth: u.analogy.depth,
          mapped_relation: u.analogy.mappedRelation,
          transfer: u.analogy.transfer,
          agent_move: u.analogy.agentMove,
        }
      : null,
    modality_hints: u.modalityHints,
    guardrails: u.guardrails,
    platforms_intended: [
      "x",
      "threads",
      "note",
      "instagram",
      "blog",
      "youtube_script",
      "music",
    ],
  };
}

export interface ShipResult {
  stamp: string;
  outDir: string;
  latestDir: string;
  unitCount: number;
  bridgeRoot: string;
}

export async function runShip(
  config: AppConfig,
  opts?: { limit?: number },
): Promise<ShipResult> {
  await assertDataRootReady(config);
  await ensureLayout(config.dataRoot);

  const bridgeRoot = resolveBridgeRoot(config);
  const stamp = todayStamp();
  const outDir = path.join(bridgeRoot, "outbox", stamp);
  const unitsDir = path.join(outDir, "units");
  const latestDir = path.join(bridgeRoot, "LATEST");

  await mkdir(unitsDir, { recursive: true });
  await mkdir(path.join(bridgeRoot, "outbox"), { recursive: true });
  await mkdir(path.join(bridgeRoot, "processed"), { recursive: true });
  await mkdir(latestDir, { recursive: true });

  const catalog = await loadCatalog(config.dataRoot);
  if (!catalog.length) {
    throw new Error("catalog が空。先に npm run daily");
  }

  // 今日の新規優先、なければ最新
  const todayItems = catalog.filter((e) =>
    (e.collected_at || "").startsWith(stamp),
  );
  const focus = (
    todayItems.length ? sortByRecency(todayItems) : sortByRecency(catalog)
  ).slice(0, 40);
  const picked = pickTop(focus, opts?.limit ?? 8);
  const units = await unpackBatch(picked, catalog, {
    limit: opts?.limit ?? 8,
    dataRoot: config.dataRoot,
  });

  // Write units
  for (const [i, u] of units.entries()) {
    const name = `UNIT_${String(i + 1).padStart(2, "0")}_${u.source.id}.md`;
    await writeFile(path.join(unitsDir, name), renderUnitMd(u), "utf8");
  }

  await writeFile(
    path.join(outDir, "units.jsonl"),
    units.map((u) => JSON.stringify(unitToJsonl(u))).join("\n") + "\n",
    "utf8",
  );
  await writeFile(path.join(outDir, "PACK_BRIEF.md"), renderPackBrief(stamp, units), "utf8");
  await writeFile(
    path.join(outDir, "README_FOR_RECEIVER_AI.md"),
    renderReceiverReadme(stamp, units.length),
    "utf8",
  );

  const manifest = {
    schema: "ai-intel-bridge.v1",
    kind: "understanding_pack",
    not: "final_sns_posts",
    stamp,
    generatedAt: nowIso(),
    unitCount: units.length,
    sourceMachine: "collector-mac / comic-shelf ai-intel",
    dataRoot: config.dataRoot,
    platformsIntended: [
      "x",
      "threads",
      "note",
      "instagram",
      "blog",
      "youtube_script",
      "music",
    ],
    paths: {
      brief: "PACK_BRIEF.md",
      units: "units/",
      jsonl: "units.jsonl",
      receiver: "README_FOR_RECEIVER_AI.md",
    },
    unitIds: units.map((u) => u.id),
  };
  await writeFile(
    path.join(outDir, "MANIFEST.json"),
    JSON.stringify(manifest, null, 2) + "\n",
    "utf8",
  );

  // LATEST ミラー（受け手がいつも同じ場所を見ればよい）
  const latestFiles = [
    "PACK_BRIEF.md",
    "README_FOR_RECEIVER_AI.md",
    "MANIFEST.json",
    "units.jsonl",
  ];
  for (const f of latestFiles) {
    await copyFile(path.join(outDir, f), path.join(latestDir, f));
  }
  // units dir: write a pointer
  await writeFile(
    path.join(latestDir, "UNITS_PATH.txt"),
    `../outbox/${stamp}/units/\n`,
    "utf8",
  );

  await writeFile(
    path.join(bridgeRoot, "STATUS.md"),
    [
      `# intel-bridge STATUS`,
      "",
      `- updated: ${nowIso()}`,
      `- latest_stamp: **${stamp}**`,
      `- units: **${units.length}**`,
      `- outbox: \`outbox/${stamp}/\``,
      `- pointer: \`LATEST/\``,
      "",
      "## 受け手AI",
      "",
      "1. `LATEST/README_FOR_RECEIVER_AI.md` を読む",
      "2. `LATEST/PACK_BRIEF.md` で全体把握",
      "3. `units.jsonl` または `outbox/.../units/` で詳細",
      "4. 文章/画像/動画/音楽へ変換（公開は承認後）",
      "5. 済んだら `processed/${stamp}/` へ移動してよい",
      "",
    ].join("\n"),
    "utf8",
  );

  // ローカルHDDにも控え
  const localShip = path.join(config.dataRoot, "ship", stamp);
  await mkdir(localShip, { recursive: true });
  await writeFile(
    path.join(localShip, "SHIPPED_TO.txt"),
    `${outDir}\n`,
    "utf8",
  );
  await copyFile(
    path.join(outDir, "PACK_BRIEF.md"),
    path.join(localShip, "PACK_BRIEF.md"),
  );
  await copyFile(
    path.join(outDir, "MANIFEST.json"),
    path.join(localShip, "MANIFEST.json"),
  );

  return {
    stamp,
    outDir,
    latestDir,
    unitCount: units.length,
    bridgeRoot,
  };
}

export interface CategoryShipResult {
  stamp: string;
  rootDir: string;
  latestDir: string;
  perCategory: Record<string, number>;
  unitCount: number;
  bridgeRoot: string;
}

/**
 * テスト運用: 各カテゴリから N 件ずつ因数分解し、
 * intel-bridge にカテゴリフォルダで渡す。
 */
export async function runShipByCategory(
  config: AppConfig,
  opts?: { perCategory?: number },
): Promise<CategoryShipResult> {
  await assertDataRootReady(config);
  await ensureLayout(config.dataRoot);

  const per = opts?.perCategory ?? 3;
  const bridgeRoot = resolveBridgeRoot(config);
  const stamp = todayStamp();
  const rootDir = path.join(bridgeRoot, "by-category", stamp);
  const latestDir = path.join(bridgeRoot, "by-category", "LATEST");

  await mkdir(rootDir, { recursive: true });
  await mkdir(latestDir, { recursive: true });

  const catalog = await loadCatalog(config.dataRoot);
  if (!catalog.length) {
    throw new Error("catalog が空。先に npm run collect / daily");
  }

  // 精査を更新してから、期間明け＆reject以外を優先
  await runVet(config);
  const vetMap = await loadVetLedger(config.dataRoot);

  const perCategory: Record<string, number> = {};
  const allUnits: UnpackedIntel[] = [];
  const indexLines = [
    `# intel-bridge by-category（テスト運用）— ${stamp}`,
    "",
    `生成: ${nowIso()}`,
    "",
    `各カテゴリから最大 **${per}** 件を因数分解して渡したパック。`,
    "投稿原稿ではない。受け手AIが文章/画像/動画/音楽へ変換する材料。",
    "選定: 精査（鮮度・信憑性）で reject でないものを優先。精査期間中は注記つき。",
    "",
    "| カテゴリ | 件数 | フォルダ |",
    "|----------|------|----------|",
  ];

  for (const cat of CATEGORIES) {
    const pool = sortByRecency(
      catalog.filter((e) => e.category === cat),
    ).filter((e) => {
      const v = vetMap.get(e.id);
      if (!v) return true;
      return v.verdict !== "reject";
    });
    // 精査明けを先に、なければ期間中でもテスト出荷（reject除外済み）
    const cleared = pool.filter((e) => {
      const v = vetMap.get(e.id);
      return v ? isShipEligible(v) : false;
    });
    const fallback = pool.filter((e) => !cleared.includes(e));
    const ordered = [
      ...pickTop(cleared, per),
      ...pickTop(fallback, per),
    ];
    const picked = ordered.slice(0, per);
    perCategory[cat] = picked.length;

    const catDir = path.join(rootDir, cat);
    await mkdir(catDir, { recursive: true });

    if (!picked.length) {
      await writeFile(
        path.join(catDir, "EMPTY.md"),
        `# ${cat}\n\nこのカテゴリはまだ0件。ソース追加後に再実行。\n`,
        "utf8",
      );
      indexLines.push(`| \`${cat}\` | 0 | \`${cat}/\` |`);
      continue;
    }

    const analogies = findAnalogies(picked, catalog, per);
    const byId = new Map(analogies.map((a) => [a.source.entry.id, a] as const));
    const units: UnpackedIntel[] = [];
    for (const entry of picked) {
      const summary = await loadEntryText(config.dataRoot, entry);
      units.push(
        unpackEntry(entry, {
          summary,
          analogy: byId.get(entry.id),
        }),
      );
    }
    allUnits.push(...units);

    for (const [i, u] of units.entries()) {
      const name = `UNIT_${String(i + 1).padStart(2, "0")}_${u.source.id}.md`;
      await writeFile(path.join(catDir, name), renderUnitMd(u), "utf8");
    }
    await writeFile(
      path.join(catDir, "units.jsonl"),
      units.map((u) => JSON.stringify(unitToJsonl(u))).join("\n") + "\n",
      "utf8",
    );
    await writeFile(
      path.join(catDir, "PACK_BRIEF.md"),
      [
        `# ${cat} — ${stamp}`,
        "",
        `件数: ${units.length}`,
        "",
        ...units.map(
          (u, i) =>
            `${i + 1}. **${u.factors.oneLine}**\n   - たとえ: ${u.metaphors.dailyLife}\n   - ${u.source.url}`,
        ),
        "",
      ].join("\n"),
      "utf8",
    );
    await writeFile(
      path.join(catDir, "README.md"),
      [
        `# カテゴリ \`${cat}\`（テスト運用）`,
        "",
        "このフォルダの UNIT_*.md を読んで、媒体へ変換してよい。",
        "公開は承認フローに従う。",
        "",
      ].join("\n"),
      "utf8",
    );

    indexLines.push(`| \`${cat}\` | ${units.length} | \`${cat}/\` |`);
  }

  indexLines.push(
    "",
    "## 受け手AIの読み方",
    "",
    "1. この INDEX で棚を選ぶ",
    "2. `カテゴリ/PACK_BRIEF.md` → `UNIT_*.md`",
    "3. または `カテゴリ/units.jsonl` を一括読み",
    "",
    "## 安定ポインタ",
    "",
    "`by-category/LATEST/` が毎回ここを指す（テスト運用）",
    "",
  );

  const indexBody = indexLines.join("\n");
  await writeFile(path.join(rootDir, "INDEX.md"), indexBody, "utf8");
  await writeFile(
    path.join(rootDir, "README_FOR_RECEIVER_AI.md"),
    [
      `# 受け手AIへ — カテゴリ別テストパック`,
      "",
      `stamp: ${stamp}`,
      `総ユニット: ${allUnits.length}`,
      "",
      "これはテスト運用。各カテゴリフォルダに最大3件の理解パックがある。",
      "",
      "まず `INDEX.md` を開き、欲しい棚の `UNIT_*.md` を読め。",
      "",
    ].join("\n"),
    "utf8",
  );
  await writeFile(
    path.join(rootDir, "MANIFEST.json"),
    JSON.stringify(
      {
        schema: "ai-intel-bridge.by-category.v1",
        kind: "category_test_pack",
        test: true,
        stamp,
        generatedAt: nowIso(),
        perCategory,
        unitCount: allUnits.length,
        categories: CATEGORIES,
      },
      null,
      2,
    ) + "\n",
    "utf8",
  );
  await writeFile(
    path.join(rootDir, "all-units.jsonl"),
    allUnits.map((u) => JSON.stringify(unitToJsonl(u))).join("\n") + "\n",
    "utf8",
  );

  // LATEST ミラー
  await writeFile(path.join(latestDir, "INDEX.md"), indexBody, "utf8");
  await copyFile(
    path.join(rootDir, "README_FOR_RECEIVER_AI.md"),
    path.join(latestDir, "README_FOR_RECEIVER_AI.md"),
  );
  await copyFile(
    path.join(rootDir, "MANIFEST.json"),
    path.join(latestDir, "MANIFEST.json"),
  );
  await copyFile(
    path.join(rootDir, "all-units.jsonl"),
    path.join(latestDir, "all-units.jsonl"),
  );
  await writeFile(
    path.join(latestDir, "SOURCE_PATH.txt"),
    `../${stamp}/\n`,
    "utf8",
  );

  for (const cat of CATEGORIES) {
    const src = path.join(rootDir, cat);
    const dst = path.join(latestDir, cat);
    await mkdir(dst, { recursive: true });
    const files = await readdir(src);
    for (const f of files) {
      await copyFile(path.join(src, f), path.join(dst, f));
    }
  }

  await writeFile(
    path.join(bridgeRoot, "STATUS.md"),
    [
      `# intel-bridge STATUS`,
      "",
      `- updated: ${nowIso()}`,
      `- category_test_stamp: **${stamp}**`,
      `- units: **${allUnits.length}**（各カテゴリ最大${per}）`,
      `- path: \`by-category/${stamp}/\``,
      `- pointer: \`by-category/LATEST/\``,
      "",
      "## テスト運用メモ",
      "",
      "通常の LATEST/（横断パック）とは別に、カテゴリ別フォルダを渡している。",
      "",
    ].join("\n"),
    "utf8",
  );

  // HDD控え
  const localShip = path.join(config.dataRoot, "ship", `by-category-${stamp}`);
  await mkdir(localShip, { recursive: true });
  await writeFile(
    path.join(localShip, "SHIPPED_TO.txt"),
    `${rootDir}\n`,
    "utf8",
  );
  await copyFile(
    path.join(rootDir, "INDEX.md"),
    path.join(localShip, "INDEX.md"),
  );

  return {
    stamp,
    rootDir,
    latestDir,
    perCategory,
    unitCount: allUnits.length,
    bridgeRoot,
  };
}
