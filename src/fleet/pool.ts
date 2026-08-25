import { sleep } from "../http.js";
import type { Mission, MissionResult } from "./types.js";

type Runner = (mission: Mission) => Promise<{ fetched: number }>;

const HOST_GAP_MS: Record<string, number> = {
  youtube: 400,
  rss: 200,
  github: 350,
  reddit: 500,
  arxiv: 250,
  europepmc: 300,
  docs: 200,
  x: 400,
};

/**
 * ワーカープール（1000体検算: 任務は最大1000、同時実行は concurrency）
 */
export async function runMissionPool(
  missions: Mission[],
  concurrency: number,
  runOne: Runner,
  onResult?: (r: MissionResult) => void | Promise<void>,
): Promise<MissionResult[]> {
  const results: MissionResult[] = [];
  let cursor = 0;
  const lastByShip = new Map<string, number>();

  async function worker(): Promise<void> {
    for (;;) {
      const i = cursor++;
      if (i >= missions.length) return;
      const mission = missions[i];
      const gap = HOST_GAP_MS[mission.ship] ?? 250;
      const last = lastByShip.get(mission.ship) ?? 0;
      const wait = Math.max(0, gap - (Date.now() - last));
      if (wait) await sleep(wait);
      lastByShip.set(mission.ship, Date.now());

      const started = Date.now();
      console.log(
        `  🚢 [${i + 1}/${missions.length}] ${mission.ship} · ${mission.label.slice(0, 60)}`,
      );
      try {
        const out = await runOne(mission);
        const result: MissionResult = {
          mission,
          status: "done",
          fetched: out.fetched,
          ms: Date.now() - started,
        };
        results.push(result);
        await onResult?.(result);
        console.log(`    ✓ ${out.fetched}件 (${result.ms}ms)`);
      } catch (err) {
        const result: MissionResult = {
          mission,
          status: "failed",
          fetched: 0,
          error: err instanceof Error ? err.message : String(err),
          ms: Date.now() - started,
        };
        results.push(result);
        await onResult?.(result);
        console.warn(`    ✗ ${result.error}`);
      }
    }
  }

  const n = Math.max(1, Math.min(concurrency, missions.length || 1));
  await Promise.all(Array.from({ length: n }, () => worker()));
  return results;
}
