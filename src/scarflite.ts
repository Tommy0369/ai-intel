import { appendFile, mkdir, writeFile, readFile } from "node:fs/promises";
import path from "node:path";
import { assertDataRootReady, ensureLayout } from "./disk.js";
import { nowIso } from "./http.js";
import { loadCatalog, pickTop } from "./corpus.js";
import { findAnalogies } from "./analogy.js";
import type { AppConfig, CatalogEntry } from "./types.js";

/**
 * ScarfLite — agents評価文化 × opensourceタスク の最小ブリッジ
 *
 * 源: Benchmarking Single Agent Performance（評価）
 * 的: ScarfBench 的な「OSS対象でのエージェント評価」
 * 写像: 固定シナリオで合否を測り、clone→改造の計画まで出す（実cloneは既定OFF）
 */

export type ScenarioId =
  | "retrieve_oss"
  | "deep_analogy"
  | "fork_plan"
  | "safety_guard";

export interface ScenarioResult {
  id: ScenarioId;
  name: string;
  pass: boolean;
  detail: string;
  ms: number;
}

export interface ScarfLiteReport {
  at: string;
  metric: "pass_rate";
  passRate: number;
  passed: number;
  total: number;
  costGuard: string;
  safetyGuard: string;
  targetRepo: CatalogEntry | null;
  scenarios: ScenarioResult[];
  forkPlanPath?: string;
  reportPath: string;
}

const FORBIDDEN_HOST_PATTERNS = [
  /localhost/i,
  /127\.0\.0\.1/,
  /0\.0\.0\.0/,
  /file:/i,
  /javascript:/i,
];

function isSafeCatalogUrl(url: string): boolean {
  try {
    const u = new URL(url);
    if (!["http:", "https:"].includes(u.protocol)) return false;
    if (FORBIDDEN_HOST_PATTERNS.some((p) => p.test(u.href))) return false;
    // opensource ブリッジ対象は主に GitHub
    return true;
  } catch {
    return false;
  }
}

function pickOssTarget(catalog: CatalogEntry[], query?: string): CatalogEntry | null {
  const github = catalog.filter(
    (e) =>
      e.source === "github" &&
      e.category === "opensource" &&
      isSafeCatalogUrl(e.url),
  );
  if (!github.length) return null;
  if (query?.trim()) {
    const q = query.toLowerCase();
    const hit = github.filter(
      (e) =>
        e.title.toLowerCase().includes(q) ||
        (e.tags ?? []).some((t) => t.toLowerCase().includes(q)),
    );
    if (hit.length) return pickTop(hit, 1)[0] ?? hit[0];
  }
  // agent 関連を優先（チャンピオン写像）
  const agentish = github.filter((e) =>
    /agent|bench|eval|rag|llm/i.test(`${e.title} ${(e.tags ?? []).join(" ")}`),
  );
  const pool = agentish.length ? agentish : github;
  return pickTop(pool, 1)[0] ?? pool[0];
}

async function runScenario(
  id: ScenarioId,
  name: string,
  fn: () => Promise<{ pass: boolean; detail: string }>,
): Promise<ScenarioResult> {
  const t0 = Date.now();
  try {
    const r = await fn();
    return { id, name, pass: r.pass, detail: r.detail, ms: Date.now() - t0 };
  } catch (err) {
    return {
      id,
      name,
      pass: false,
      detail: err instanceof Error ? err.message : String(err),
      ms: Date.now() - t0,
    };
  }
}

function buildForkPlan(target: CatalogEntry, analogyBlurb: string): string {
  return `# Fork Plan — ${target.title}

生成: ${nowIso()}

## 対象（コーパス内・安全確認済み）

- title: ${target.title}
- url: ${target.url}
- category/source: ${target.category}/${target.source}
- id: \`${target.id}\`

## アナロジー（agents → opensource）

${analogyBlurb}

## clone → 改造（手動手順・自動cloneなし）

> 安全ガード: ScarfLite はリモート clone を実行しません。計画のみ出します。

1. \`git clone ${target.url}.git\`（自分の責任で）
2. README の Quickstart を通す
3. **改造1**: ai-intel コーパスを読むアダプタを1つ足す（ローカルパス指定）
4. **改造2**: 評価シナリオを1つ足す（成功/失敗を JSON に残す）
5. 結果を \`create/projects/analogy-agent/forks/${target.id}.md\` にメモ

## 評価指標（このベンチと共通）

- **pass_rate**: ScarfLite 4シナリオの合格率
- 合格ライン: \`pass_rate >= 0.75\`（4つ中3つ以上）

## コストガード

- 外部LLM API呼び出し: なし
- ネットワーク: コーパス読取のみ（収集は daily に委譲）
`;
}

export async function runScarflite(
  config: AppConfig,
  opts?: { query?: string },
): Promise<ScarfLiteReport> {
  await assertDataRootReady(config);
  await ensureLayout(config.dataRoot);

  const catalog = await loadCatalog(config.dataRoot);
  if (!catalog.length) {
    throw new Error("catalog が空です。先に npm run daily または collect");
  }

  const agents = catalog.filter((e) => e.category === "agents");
  const target = pickOssTarget(catalog, opts?.query);

  let analogyBlurb = "_（対象なし）_";
  let deepCount = 0;

  const scenarios: ScenarioResult[] = [];

  // 1) Retrieve OSS from catalog
  scenarios.push(
    await runScenario("retrieve_oss", "OSS対象をコーパスから取得", async () => {
      if (!target) {
        return { pass: false, detail: "opensource/github がカタログに無い" };
      }
      return {
        pass: true,
        detail: `選出: ${target.title} (${target.url})`,
      };
    }),
  );

  // 2) Deep analogy agents → opensource
  scenarios.push(
    await runScenario(
      "deep_analogy",
      "深層アナロジー agents→opensource を1つ以上",
      async () => {
        if (!target) return { pass: false, detail: "対象なし" };
        const focus = [...pickTop(agents, 15), target];
        const maps = findAnalogies(focus, catalog, 8);
        const deep = maps.filter(
          (m) =>
            m.depth === "deep" &&
            (m.source.entry.category === "agents" ||
              m.target.entry.category === "opensource" ||
              m.source.entry.category === "opensource" ||
              m.target.entry.category === "agents"),
        );
        deepCount = deep.length;
        const best = deep[0] ?? maps.find((m) => m.depth === "deep") ?? maps[0];
        if (!best || best.depth !== "deep") {
          return { pass: false, detail: `deep=${deepCount}` };
        }
        analogyBlurb = [
          "```",
          best.analogy,
          "```",
          "",
          `次手: ${best.agentMove}`,
        ].join("\n");
        return {
          pass: true,
          detail: `deep=${deepCount} champion=${best.id}`,
        };
      },
    ),
  );

  // 3) Fork plan (act without remote clone)
  let forkPlanPath: string | undefined;
  scenarios.push(
    await runScenario(
      "fork_plan",
      "clone→改造のFork計画をローカルに書く",
      async () => {
        if (!target) return { pass: false, detail: "対象なし" };
        const dir = path.join(
          config.dataRoot,
          "create",
          "projects",
          "analogy-agent",
          "forks",
        );
        await mkdir(dir, { recursive: true });
        forkPlanPath = path.join(dir, `${target.id}.md`);
        let preserve = "";
        try {
          const prev = await readFile(forkPlanPath, "utf8");
          const idx = prev.indexOf("## 完了記録");
          if (idx >= 0) preserve = "\n" + prev.slice(idx).trimEnd() + "\n";
        } catch {
          // new file
        }
        await writeFile(
          forkPlanPath,
          buildForkPlan(target, analogyBlurb) + preserve,
          "utf8",
        );
        return { pass: true, detail: forkPlanPath };
      },
    ),
  );

  // 4) Safety guard — reject non-catalog / unsafe URL injection
  scenarios.push(
    await runScenario(
      "safety_guard",
      "安全ガード: カタログ外・危険URLを拒否",
      async () => {
        const evil = [
          "file:///etc/passwd",
          "http://127.0.0.1/admin",
          "https://evil.example/not-in-catalog",
        ];
        const rejected = evil.every((u) => !isSafeCatalogUrl(u) || !catalog.some((c) => c.url === u));
        // カタログ内でも protocol 不正は拒否
        const catalogOk = target ? isSafeCatalogUrl(target.url) : true;
        const pass = rejected && catalogOk;
        return {
          pass,
          detail: pass
            ? "危険URL拒否OK / 対象URLは http(s) のみ"
            : "ガード失敗",
        };
      },
    ),
  );

  const passed = scenarios.filter((s) => s.pass).length;
  const total = scenarios.length;
  const passRate = passed / total;

  const report: ScarfLiteReport = {
    at: nowIso(),
    metric: "pass_rate",
    passRate,
    passed,
    total,
    costGuard: "外部LLM APIなし・コーパス読取のみ",
    safetyGuard: "リモートcloneしない / 危険URL拒否 / カタログ内のみ対象",
    targetRepo: target,
    scenarios,
    forkPlanPath,
    reportPath: "",
  };

  const agentDir = path.join(config.dataRoot, "agent");
  await mkdir(agentDir, { recursive: true });
  const reportPath = path.join(agentDir, "SCARF_LITE_REPORT.md");
  report.reportPath = reportPath;

  const md = [
    `# ScarfLite Report`,
    "",
    `生成: ${report.at}`,
    "",
    "## 評価指標",
    "",
    `- **metric**: \`pass_rate\``,
    `- **score**: **${(passRate * 100).toFixed(0)}%** (${passed}/${total})`,
    `- **合格ライン**: 75%`,
    `- **結果**: ${passRate >= 0.75 ? "✅ PASS" : "❌ FAIL"}`,
    "",
    "## ガード",
    "",
    `- コスト: ${report.costGuard}`,
    `- 安全: ${report.safetyGuard}`,
    "",
    "## 対象 OSS",
    "",
    target
      ? `- [${target.title}](${target.url}) (\`${target.id}\`)`
      : "- （なし）",
    "",
    "## シナリオ",
    "",
    "| ID | 名前 | 合否 | 詳細 | ms |",
    "|----|------|------|------|-----|",
    ...scenarios.map(
      (s) =>
        `| ${s.id} | ${s.name} | ${s.pass ? "PASS" : "FAIL"} | ${s.detail.replace(/\|/g, "/")} | ${s.ms} |`,
    ),
    "",
    "## アナロジー",
    "",
    analogyBlurb,
    "",
    forkPlanPath ? `## Fork計画\n\n\`${forkPlanPath}\`\n` : "",
    "## 再実行",
    "",
    "```bash",
    "cd ai-intel && npm run bench",
    "cd ai-intel && npm run bench -- agent",
    "```",
    "",
  ].join("\n");

  await writeFile(reportPath, md, "utf8");
  await appendFile(
    path.join(config.dataRoot, "state", "scarf-lite-eval.jsonl"),
    JSON.stringify({
      at: report.at,
      passRate,
      passed,
      total,
      pass: passRate >= 0.75,
      target: target?.id ?? null,
      deepCount,
    }) + "\n",
    "utf8",
  );

  // MEMORY 追記
  const memPath = path.join(
    config.dataRoot,
    "create",
    "projects",
    "analogy-agent",
    "MEMORY.md",
  );
  await mkdir(path.dirname(memPath), { recursive: true });
  await appendFile(
    memPath,
    [
      "",
      `## ScarfLite ${report.at}`,
      "",
      `- pass_rate: ${(passRate * 100).toFixed(0)}% (${passed}/${total})`,
      `- target: ${target?.title ?? "(none)"}`,
      `- report: agent/SCARF_LITE_REPORT.md`,
      "",
    ].join("\n"),
    "utf8",
  );

  return report;
}
