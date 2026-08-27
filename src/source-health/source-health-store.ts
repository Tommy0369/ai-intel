import path from "node:path";
import type { AppConfig, SourceKind } from "../types.js";
import { nowIso } from "../http.js";
import { appendJsonl, readJson, writeJson } from "../store-jsonl.js";

export interface SourceHealthRecord {
  sourceId: string;
  sourceKind: SourceKind | string;
  attempts: number;
  successes: number;
  partials: number;
  failures: number;
  successRate: number;
  lastAttemptAt?: string;
  lastSuccessAt?: string;
  lastFailureAt?: string;
  lastItemAt?: string;
  consecutiveFailures: number;
  lastHttpStatus?: number;
  lastError?: string;
  status: "healthy" | "warning" | "dead";
}

export interface SourceHealthAttempt {
  at: string;
  sourceId: string;
  sourceKind: string;
  ok: boolean;
  partial?: boolean;
  httpStatus?: number;
  error?: string;
  itemId?: string;
}

export interface SourceHealthState {
  updatedAt: string;
  sources: Record<string, SourceHealthRecord>;
}

function healthDir(dataRoot: string): string {
  return path.join(dataRoot, "source-health");
}

export function computeSourceStatus(rec: {
  attempts: number;
  successRate: number;
  consecutiveFailures: number;
}): "healthy" | "warning" | "dead" {
  const { attempts, successRate, consecutiveFailures } = rec;
  if (attempts < 5) {
    if (consecutiveFailures >= 3) return "warning";
    return successRate >= 0.5 ? "healthy" : "warning";
  }
  if (consecutiveFailures >= 5 || successRate < 0.4) return "dead";
  if (successRate >= 0.8 && consecutiveFailures < 3) return "healthy";
  return "warning";
}

export async function loadSourceHealthState(
  dataRoot: string,
): Promise<SourceHealthState> {
  return readJson<SourceHealthState>(path.join(healthDir(dataRoot), "state.json"), {
    updatedAt: nowIso(),
    sources: {},
  });
}

export async function recordSourceAttempt(
  dataRoot: string,
  attempt: SourceHealthAttempt,
): Promise<SourceHealthRecord> {
  const state = await loadSourceHealthState(dataRoot);
  const prev = state.sources[attempt.sourceId] ?? {
    sourceId: attempt.sourceId,
    sourceKind: attempt.sourceKind,
    attempts: 0,
    successes: 0,
    partials: 0,
    failures: 0,
    successRate: 0,
    consecutiveFailures: 0,
    status: "healthy" as const,
  };

  const next: SourceHealthRecord = { ...prev };
  next.attempts += 1;
  next.lastAttemptAt = attempt.at;
  if (attempt.httpStatus != null) next.lastHttpStatus = attempt.httpStatus;
  if (attempt.ok) {
    next.successes += 1;
    next.consecutiveFailures = 0;
    next.lastSuccessAt = attempt.at;
    next.lastItemAt = attempt.at;
    next.lastError = undefined;
  } else if (attempt.partial) {
    next.partials += 1;
    next.consecutiveFailures = 0;
    next.lastSuccessAt = attempt.at;
    next.lastItemAt = attempt.at;
    next.lastError = attempt.error;
  } else {
    next.failures += 1;
    next.consecutiveFailures += 1;
    next.lastFailureAt = attempt.at;
    next.lastError = attempt.error;
  }
  const scored = next.successes + next.partials * 0.5;
  next.successRate =
    next.attempts > 0 ? Math.round((scored / next.attempts) * 1000) / 1000 : 0;
  next.status = computeSourceStatus(next);

  state.sources[attempt.sourceId] = next;
  state.updatedAt = attempt.at;
  await writeJson(path.join(healthDir(dataRoot), "state.json"), state);
  await appendJsonl(path.join(healthDir(dataRoot), "history.jsonl"), attempt);
  return next;
}

export async function listSourceHealth(
  dataRoot: string,
): Promise<SourceHealthRecord[]> {
  const state = await loadSourceHealthState(dataRoot);
  return Object.values(state.sources).sort((a, b) => {
    const rank = { dead: 0, warning: 1, healthy: 2 };
    return rank[a.status] - rank[b.status] || a.sourceId.localeCompare(b.sourceId);
  });
}

export function formatSourceHealthTable(rows: SourceHealthRecord[]): string {
  const lines = ["SOURCE HEALTH", ""];
  for (const r of rows) {
    const pct = `${Math.round(r.successRate * 100)}%`.padStart(4, " ");
    const when = r.lastSuccessAt
      ? `last success ${relativeShort(r.lastSuccessAt)}`
      : r.lastFailureAt
        ? `last fail ${relativeShort(r.lastFailureAt)}`
        : "no attempts";
    const extra =
      r.status === "dead"
        ? `consecutive failures ${r.consecutiveFailures}`
        : r.lastError
          ? r.lastError
          : "";
    lines.push(
      `${r.sourceId.padEnd(28)} ${r.status.padEnd(8)} ${pct}   ${when}${extra ? `   ${extra}` : ""}`,
    );
  }
  if (rows.length === 0) lines.push("(no data yet — run enrich / collect first)");
  return lines.join("\n");
}

function relativeShort(iso: string): string {
  const ms = Date.now() - Date.parse(iso);
  if (!Number.isFinite(ms) || ms < 0) return iso.slice(0, 16);
  const m = Math.round(ms / 60_000);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

/** カタログ由来の観測も混ぜる（attemptsが無いソースの穴埋め） */
export async function seedFromCatalogIfEmpty(
  config: AppConfig,
  catalogRows: Array<{ sourceId: string; sourceKind: string; lastItemAt?: string; n: number }>,
): Promise<void> {
  const state = await loadSourceHealthState(config.dataRoot);
  let changed = false;
  for (const row of catalogRows) {
    if (state.sources[row.sourceId]) continue;
    state.sources[row.sourceId] = {
      sourceId: row.sourceId,
      sourceKind: row.sourceKind,
      attempts: Math.max(1, row.n),
      successes: row.n,
      partials: 0,
      failures: 0,
      successRate: 1,
      lastItemAt: row.lastItemAt,
      lastSuccessAt: row.lastItemAt,
      consecutiveFailures: 0,
      status: "healthy",
    };
    changed = true;
  }
  if (changed) {
    state.updatedAt = nowIso();
    await writeJson(path.join(healthDir(config.dataRoot), "state.json"), state);
  }
}
