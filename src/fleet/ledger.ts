import { mkdir, readFile, writeFile, appendFile } from "node:fs/promises";
import path from "node:path";
import { nowIso } from "../http.js";
import type { FleetProfile, Mission, MissionResult, MissionStatus } from "./types.js";

export interface LedgerState {
  runId: string;
  profile: FleetProfile;
  startedAt: string;
  updatedAt: string;
  queued: number;
  done: number;
  failed: number;
  skipped: number;
}

function fleetDir(dataRoot: string): string {
  return path.join(dataRoot, "fleet");
}

export async function ensureFleetLayout(dataRoot: string): Promise<void> {
  await mkdir(fleetDir(dataRoot), { recursive: true });
}

export async function startLedger(
  dataRoot: string,
  profile: FleetProfile,
  missions: Mission[],
): Promise<string> {
  await ensureFleetLayout(dataRoot);
  const runId = `${profile}-${Date.now().toString(36)}`;
  const state: LedgerState = {
    runId,
    profile,
    startedAt: nowIso(),
    updatedAt: nowIso(),
    queued: missions.length,
    done: 0,
    failed: 0,
    skipped: 0,
  };
  await writeFile(
    path.join(fleetDir(dataRoot), "state.json"),
    JSON.stringify(state, null, 2) + "\n",
    "utf8",
  );
  await writeFile(
    path.join(fleetDir(dataRoot), "missions.jsonl"),
    missions
      .map((m) =>
        JSON.stringify({
          at: nowIso(),
          runId,
          id: m.id,
          ship: m.ship,
          label: m.label,
          status: "queued" as MissionStatus,
          priority: m.priority,
        }),
      )
      .join("\n") + (missions.length ? "\n" : ""),
    "utf8",
  );
  return runId;
}

export async function appendMissionResult(
  dataRoot: string,
  runId: string,
  result: MissionResult,
): Promise<void> {
  await ensureFleetLayout(dataRoot);
  await appendFile(
    path.join(fleetDir(dataRoot), "missions.jsonl"),
    JSON.stringify({
      at: nowIso(),
      runId,
      id: result.mission.id,
      ship: result.mission.ship,
      label: result.mission.label,
      status: result.status,
      fetched: result.fetched,
      error: result.error,
      ms: result.ms,
    }) + "\n",
    "utf8",
  );

  try {
    const statePath = path.join(fleetDir(dataRoot), "state.json");
    const state = JSON.parse(await readFile(statePath, "utf8")) as LedgerState;
    if (state.runId !== runId) return;
    if (result.status === "done") state.done++;
    else if (result.status === "failed") state.failed++;
    else if (result.status === "skipped") state.skipped++;
    state.updatedAt = nowIso();
    await writeFile(statePath, JSON.stringify(state, null, 2) + "\n", "utf8");
  } catch {
    // state 更新失敗は致命的ではない
  }
}

export async function readFleetStatus(dataRoot: string): Promise<{
  state: LedgerState | null;
  recent: Array<Record<string, unknown>>;
}> {
  await ensureFleetLayout(dataRoot);
  let state: LedgerState | null = null;
  try {
    state = JSON.parse(
      await readFile(path.join(fleetDir(dataRoot), "state.json"), "utf8"),
    ) as LedgerState;
  } catch {
    state = null;
  }
  let recent: Array<Record<string, unknown>> = [];
  try {
    const raw = await readFile(
      path.join(fleetDir(dataRoot), "missions.jsonl"),
      "utf8",
    );
    const lines = raw.trim().split("\n").filter(Boolean);
    recent = lines.slice(-40).map((l) => JSON.parse(l) as Record<string, unknown>);
  } catch {
    recent = [];
  }
  return { state, recent };
}
