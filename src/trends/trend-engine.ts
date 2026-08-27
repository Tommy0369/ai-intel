import path from "node:path";
import type { IntelEvent, TrendStatus } from "../v2-types.js";
import { writeJson } from "../store-jsonl.js";
import { appendObservations } from "./observations.js";

export function trendStatusOf(ev: IntelEvent): TrendStatus {
  const v = ev.velocity;
  const acc = ev.acceleration;
  if (v >= 70 && acc > 4) return "hot";
  if (acc > 3 || ev.mentions_24h >= 6) return "rising";
  if (ev.mentions_24h >= 2 && ev.mentions_7d <= 4) return "emerging";
  if (ev.mentions_24h === 0 && ev.mentions_7d <= 2) return "declining";
  return "stable";
}

export function applyTrends(events: IntelEvent[]): IntelEvent[] {
  return events.map((e) => ({ ...e, trendStatus: trendStatusOf(e) }));
}

export async function saveTrends(
  dataRoot: string,
  events: IntelEvent[],
): Promise<string> {
  const rising = events
    .filter((e) => e.trendStatus === "rising" || e.trendStatus === "hot" || e.trendStatus === "emerging")
    .slice()
    .sort((a, b) => b.velocity - a.velocity)
    .slice(0, 40);
  const file = path.join(dataRoot, "trends", "latest.json");
  await writeJson(file, {
    updatedAt: new Date().toISOString(),
    rising,
  });
  return file;
}

export async function runTrendEngine(
  dataRoot: string,
  events: IntelEvent[],
): Promise<IntelEvent[]> {
  const next = applyTrends(events);
  await saveTrends(dataRoot, next);
  await appendObservations(dataRoot, next);
  return next;
}
