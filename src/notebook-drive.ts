import {
  access,
  copyFile,
  mkdir,
  readdir,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { spawnSync } from "node:child_process";
import { assertDataRootReady, ensureLayout } from "./disk.js";
import { nowIso } from "./http.js";
import { resolveBridgeRoot } from "./ship.js";
import type { AppConfig } from "./types.js";

const SKIP_DIR = "_skip";
/** NotebookLM の Drive 検索用フラット置き場 */
const SEARCH_DIR = "_search";

/** Drive / NotebookLM 検索に載る短い安全な題名 */
function driveTitleSlug(topic: TopicPack): string {
  const nn = topic.folder.slice(0, 2);
  const raw =
    topic.titleJa?.trim() ||
    topic.folder.replace(/^\d{2}_[a-z]+_?/i, "") ||
    topic.folder;
  const cleaned = raw
    .replace(/【[^】]*】/g, "")
    .replace(/[\/\\:*?"<>|]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 48);
  return `${nn}_${cleaned || topic.folder.slice(0, 40)}`;
}

function bodySlug(filename: string): string {
  return filename
    .replace(/\.md$/i, "")
    .replace(/^00_README$/i, "README")
    .replace(/[\/\\:*?"<>|]/g, "_")
    .slice(0, 40);
}

export interface NotebookDriveResult {
  stamp: string;
  sourceDir: string;
  driveRoot: string;
  inboxDir: string;
  latestDir: string;
  published: number;
  skipped: number;
  mode: "local-sync" | "rclone" | "staging";
  readmePath: string;
}

function runStamp(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

async function exists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

async function isDir(p: string): Promise<boolean> {
  try {
    return (await stat(p)).isDirectory();
  } catch {
    return false;
  }
}

/** Google Drive for desktop の My Drive を自動検出 */
export async function detectGoogleDriveMyDrive(): Promise<string | null> {
  const cloud = path.join(os.homedir(), "Library/CloudStorage");
  if (!(await isDir(cloud))) return null;
  const names = await readdir(cloud);
  const drives = names
    .filter((n) => /^GoogleDrive-/i.test(n))
    .map((n) => path.join(cloud, n));
  for (const root of drives) {
    const candidates = [
      path.join(root, "My Drive"),
      path.join(root, "マイドライブ"),
    ];
    for (const c of candidates) {
      if (await isDir(c)) return c;
    }
    // ルート直下が My Drive 相当のこともある
    if (await isDir(root)) return root;
  }
  // 古い同期クライアント
  for (const legacy of [
    path.join(os.homedir(), "Google Drive", "My Drive"),
    path.join(os.homedir(), "Google Drive File Stream", "My Drive"),
  ]) {
    if (await isDir(legacy)) return legacy;
  }
  return null;
}

export function resolveDriveNotebookRoot(config: AppConfig): {
  root: string;
  mode: NotebookDriveResult["mode"];
  rcloneRemote?: string;
} {
  const cfg = config as AppConfig & {
    googleDriveNotebookRoot?: string;
    googleDriveRcloneRemote?: string;
  };
  const rcloneRemote = cfg.googleDriveRcloneRemote?.trim();
  if (rcloneRemote) {
    // rclone はローカル staging に一度書いてから sync
    return {
      root: path.join(config.dataRoot, "notebook", "drive-staging"),
      mode: "rclone",
      rcloneRemote,
    };
  }
  const configured = cfg.googleDriveNotebookRoot?.trim();
  if (configured) {
    return { root: configured, mode: "local-sync" };
  }
  return {
    root: path.join(config.dataRoot, "notebook", "drive-staging"),
    mode: "staging",
  };
}

async function resolveSourceNotebookDir(config: AppConfig): Promise<string> {
  const bridge = path.join(resolveBridgeRoot(config), "notebook");
  const local = path.join(config.dataRoot, "notebook", "out");
  if (await isDir(bridge)) {
    const entries = await readdir(bridge);
    if (entries.some((e) => /^\d{2}_/.test(e))) return bridge;
  }
  if (await isDir(local)) return local;
  throw new Error(
    "notebook 出力がありません。先に npm run notebook または notebook:one を実行してください。",
  );
}

interface TopicPack {
  folder: string;
  ok: boolean;
  bodyFiles: string[];
  titleJa?: string;
}

async function inspectTopic(dir: string, name: string): Promise<TopicPack | null> {
  const folder = path.join(dir, name);
  if (!(await isDir(folder))) return null;
  if (!/^\d{2}_/.test(name)) return null;

  let ok = false;
  let bodyFiles: string[] = [];
  let titleJa: string | undefined;
  const manifestPath = path.join(folder, "manifest.json");
  try {
    const raw = await readFile(manifestPath, "utf8");
    const m = JSON.parse(raw) as {
      titleJa?: string;
      enrich?: { representativeOk?: boolean; bodyFiles?: string[]; withBody?: number };
    };
    titleJa = m.titleJa;
    bodyFiles = m.enrich?.bodyFiles ?? [];
    ok = Boolean(
      m.enrich?.representativeOk ||
        (m.enrich?.withBody && m.enrich.withBody > 0) ||
        bodyFiles.length > 0,
    );
  } catch {
    // manifest なし → bodies の有無で判定
  }
  const bodiesDir = path.join(folder, "bodies");
  if (await isDir(bodiesDir)) {
    const files = (await readdir(bodiesDir)).filter(
      (f) => f.endsWith(".md") && f !== "00_README.md",
    );
    if (files.length) {
      bodyFiles = files;
      ok = true;
    }
  }
  return { folder: name, ok, bodyFiles, titleJa };
}

/**
 * Drive / NotebookLM 用: 話題1つ = ファイル1つに結合する。
 * （文脈・本文・指示をバラすとソースが数百個になって扱いにくい）
 */
async function publishTopicToSearch(
  srcRoot: string,
  searchRoot: string,
  topic: TopicPack,
): Promise<string[]> {
  const src = path.join(srcRoot, topic.folder);
  const slug = driveTitleSlug(topic);
  await mkdir(searchRoot, { recursive: true });

  const parts: string[] = [];
  parts.push(`# ${topic.titleJa || slug}`);
  parts.push("");
  parts.push(`- folder: ${topic.folder}`);
  parts.push(`- generated: ${nowIso()}`);
  parts.push("");

  const contextPath = path.join(src, "CONTEXT.md");
  if (await exists(contextPath)) {
    parts.push("## 文脈");
    parts.push("");
    parts.push(await readFile(contextPath, "utf8"));
    parts.push("");
  }

  const bodiesSrc = path.join(src, "bodies");
  if (await isDir(bodiesSrc)) {
    const files = (await readdir(bodiesSrc))
      .filter((f) => f.endsWith(".md") && f !== "00_README.md")
      .sort();
    if (files.length) {
      parts.push("## 本文（抽出）");
      parts.push("");
      for (const f of files) {
        const body = await readFile(path.join(bodiesSrc, f), "utf8");
        parts.push(`### ${bodySlug(f)}`);
        parts.push("");
        parts.push(body.trim());
        parts.push("");
      }
    }
  }

  const promptPath = path.join(src, "PROMPT.md");
  if (await exists(promptPath)) {
    parts.push("## NotebookLMへの指示");
    parts.push("");
    parts.push(await readFile(promptPath, "utf8"));
    parts.push("");
  }

  const named = `${slug}.md`;
  await writeFile(path.join(searchRoot, named), parts.join("\n"), "utf8");
  return [named];
}

/** 古い inbox 世代を消して最新だけ残す */
async function pruneOldInboxes(
  notebookRoot: string,
  keepStamp?: string,
  keepLast = 1,
): Promise<number> {
  const inboxRoot = path.join(notebookRoot, "inbox");
  if (!(await isDir(inboxRoot))) return 0;
  const stamps = (await readdir(inboxRoot))
    .filter((n) => /^\d{4}-\d{2}-\d{2}_/.test(n))
    .sort()
    .reverse();
  const keep = new Set<string>();
  if (keepStamp) keep.add(keepStamp);
  for (const s of stamps) {
    if (keep.size >= keepLast) break;
    keep.add(s);
  }
  let removed = 0;
  for (const s of stamps) {
    if (keep.has(s)) continue;
    await rm(path.join(inboxRoot, s), { recursive: true, force: true });
    removed++;
  }
  return removed;
}

function renderDriveReadme(
  stamp: string,
  published: TopicPack[],
  skipped: TopicPack[],
  mode: string,
): string {
  return `# NotebookLM 投入用（Google Drive）

発行: ${stamp}  
生成: ${nowIso()}  
同期モード: ${mode}

## これは何か

収集Macが作った **NotebookLM 専用パック**です。
iCloud の共有OS（因数分解・SNS向け）とは別出口です。

## NotebookLM での使い方

1. 新規ノートブックを作る（＝話題1つ）
2. 「ソースを追加」→ Drive → **NotebookLM / LATEST / _search**
3. 話題名で検索して **\`01_….md\` を1つだけ**追加
4. ファイル末尾の「NotebookLMへの指示」をチャットに貼る

**話題1つ = ファイル1つ**（文脈＋本文＋指示を結合済み）。バラファイルは置かない。

## 投入してよい話題（本文あり ${published.length}）

${published.map((t, i) => `${i + 1}. \`${driveTitleSlug(t)}.md\``).join("\n") || "_なし_"}

## 本文なしで除外（${skipped.length}）

${skipped.map((t) => `- ${driveTitleSlug(t)}`).join("\n") || "_なし_"}

## レイアウト

\`\`\`
NotebookLM/LATEST/_search/
  01_Anthropicの安全・制御.md   ← 1話題1ファイル
  02_….md
  …
\`\`\`
`;
}

function renderDriveIndex(stamp: string, published: TopicPack[]): string {
  const lines = [
    `# NotebookLM Drive INDEX — ${stamp}`,
    "",
    `| # | フォルダ | タイトル |`,
    `|---|----------|----------|`,
  ];
  published.forEach((t, i) => {
    lines.push(
      `| ${i + 1} | \`${t.folder}/\` | ${t.titleJa || t.folder} |`,
    );
  });
  lines.push("");
  return lines.join("\n");
}

async function mirrorDir(src: string, dest: string): Promise<void> {
  await rm(dest, { recursive: true, force: true });
  await mkdir(dest, { recursive: true });
  const entries = await readdir(src, { withFileTypes: true });
  for (const ent of entries) {
    const from = path.join(src, ent.name);
    const to = path.join(dest, ent.name);
    if (ent.isDirectory()) {
      await mirrorDir(from, to);
    } else if (ent.isFile()) {
      await copyFile(from, to);
    }
  }
}

function runRcloneSync(localDir: string, remote: string): void {
  const r = spawnSync(
    "rclone",
    ["sync", localDir, remote, "--create-empty-src-dirs", "-v"],
    { encoding: "utf8" },
  );
  if (r.status !== 0) {
    throw new Error(
      `rclone sync 失敗: ${r.stderr || r.stdout || `exit ${r.status}`}`,
    );
  }
}

export interface NotebookDriveOptions {
  /** 本文なしを Drive に載せる（既定 false＝載せない） */
  includeSkip?: boolean;
  /** 検出できた Drive があれば staging より優先 */
  preferDetectedDrive?: boolean;
  /** 残す inbox 世代数（既定 1） */
  keepInboxGenerations?: number;
}

/**
 * notebook 出力を Google Drive（または staging / rclone）へ公開する。
 */
export async function runNotebookDrive(
  config: AppConfig,
  opts?: NotebookDriveOptions,
): Promise<NotebookDriveResult> {
  await assertDataRootReady(config);
  await ensureLayout(config.dataRoot);

  const sourceDir = await resolveSourceNotebookDir(config);
  let { root, mode, rcloneRemote } = resolveDriveNotebookRoot(config);

  if (opts?.preferDetectedDrive !== false && mode === "staging") {
    const myDrive = await detectGoogleDriveMyDrive();
    if (myDrive) {
      root = path.join(myDrive, "NotebookLM");
      mode = "local-sync";
    }
  }

  const stamp = runStamp();
  const notebookRoot = root;
  const inboxDir = path.join(notebookRoot, "inbox", stamp);
  const latestDir = path.join(notebookRoot, "LATEST");
  const keepN = opts?.keepInboxGenerations ?? 1;

  // 先に古い世代を掃除（Drive のゴミを溜めない）
  const pruned = await pruneOldInboxes(notebookRoot, undefined, 0);
  if (pruned) console.log(`  pruned old inbox: ${pruned}`);

  await mkdir(inboxDir, { recursive: true });

  const names = (await readdir(sourceDir)).filter((n) => /^\d{2}_/.test(n));
  const topics: TopicPack[] = [];
  for (const name of names) {
    const t = await inspectTopic(sourceDir, name);
    if (t) topics.push(t);
  }
  topics.sort((a, b) => a.folder.localeCompare(b.folder));

  const published = topics.filter((t) => t.ok);
  const skipped = topics.filter((t) => !t.ok);

  const searchRoot = path.join(inboxDir, SEARCH_DIR);
  await mkdir(searchRoot, { recursive: true });
  const searchFiles: string[] = [];
  for (const t of published) {
    const written = await publishTopicToSearch(sourceDir, searchRoot, t);
    searchFiles.push(...written);
  }
  // includeSkip は明示 true のときだけ（既定は載せない）
  if (opts?.includeSkip === true) {
    const skipRoot = path.join(inboxDir, SKIP_DIR);
    await mkdir(skipRoot, { recursive: true });
    for (const t of skipped) {
      await publishTopicToSearch(sourceDir, skipRoot, t);
    }
  }

  await writeFile(
    path.join(searchRoot, "00_このフォルダをNotebookLMで検索.txt"),
    [
      "話題1つ = ファイル1つです。NotebookLM には該当の .md を1個だけ追加してください。",
      "",
      `件数: ${searchFiles.length}`,
      "",
      ...searchFiles.map((n, i) => `${i + 1}. ${n}`),
      "",
    ].join("\n"),
    "utf8",
  );

  const readme = renderDriveReadme(stamp, published, skipped, mode);
  const readmePath = path.join(inboxDir, "00_README.md");
  await writeFile(readmePath, readme, "utf8");
  await writeFile(
    path.join(inboxDir, "00_INDEX.md"),
    renderDriveIndex(stamp, published),
    "utf8",
  );
  await writeFile(
    path.join(inboxDir, "00_MANIFEST.json"),
    JSON.stringify(
      {
        schema: "ai-intel-notebook-drive.v2",
        stamp,
        generatedAt: nowIso(),
        sourceDir,
        mode,
        rcloneRemote: rcloneRemote || null,
        layout: "search-only",
        published: published.map((t) => t.folder),
        skipped: skipped.map((t) => t.folder),
        filesPerTopic: ["{nn}_{title}.md  （文脈+本文+指示を1ファイル）"],
        omitted: [
          "CONTEXT.md",
          "SOURCES.md",
          "split 文脈/本文/指示",
          "topic folders",
          "_skip",
        ],
        searchDir: SEARCH_DIR,
        searchFileCount: searchFiles.length,
      },
      null,
      2,
    ) + "\n",
    "utf8",
  );

  await mirrorDir(inboxDir, latestDir);
  await pruneOldInboxes(notebookRoot, stamp, keepN);

  // HDD staging も同じ lean 構成＋古い inbox 掃除
  const stagingRoot = path.join(config.dataRoot, "notebook", "drive-staging");
  if (path.resolve(notebookRoot) !== path.resolve(stagingRoot)) {
    await mkdir(path.join(stagingRoot, "inbox", stamp), { recursive: true });
    await mirrorDir(inboxDir, path.join(stagingRoot, "inbox", stamp));
    await mirrorDir(inboxDir, path.join(stagingRoot, "LATEST"));
    await pruneOldInboxes(stagingRoot, stamp, keepN);
  }

  if (mode === "rclone" && rcloneRemote) {
    console.log(`  rclone sync → ${rcloneRemote}`);
    runRcloneSync(stagingRoot, rcloneRemote);
  }

  return {
    stamp,
    sourceDir,
    driveRoot: notebookRoot,
    inboxDir,
    latestDir,
    published: published.length,
    skipped: skipped.length,
    mode,
    readmePath,
  };
}
