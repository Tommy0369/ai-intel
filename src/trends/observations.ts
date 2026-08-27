import path from "node:path";
import type { IntelEvent } from "../v2-types.js";
import { appendJsonl, writeJson } from "../store-jsonl.js";

export interface EventObservation {
  event_id: string;
  observed_at: string;
  article_count_total: number;
  mentions_1h: number;
  mentions_6h: number;
  mentions_24h: number;
  mentions_3d: number;
  mentions_7d: number;
  source_count: number;
  source_domain_count: number;
  velocity: number;
  acceleration: number;
  trend_status?: string;
}

export function eventToObservation(ev: IntelEvent, at: string): EventObservation {
  return {
    event_id: ev.id,
    observed_at: at,
    article_count_total: ev.sourceCount,
    mentions_1h: ev.mentions_1h,
    mentions_6h: ev.mentions_6h,
    mentions_24h: ev.mentions_24h,
    mentions_3d: ev.mentions_3d,
    mentions_7d: ev.mentions_7d,
    source_count: ev.sourceCount,
    source_domain_count: ev.sourceDomains?.length ?? 0,
    velocity: ev.velocity,
    acceleration: ev.acceleration,
    trend_status: ev.trendStatus,
  };
}

export async function appendObservations(
  dataRoot: string,
  events: IntelEvent[],
): Promise<string> {
  const file = path.join(dataRoot, "trends", "observations.jsonl");
  const at = new Date().toISOString();
  for (const ev of events) {
    await appendJsonl(file, eventToObservation(ev, at));
  }
  await writeJson(path.join(dataRoot, "trends", "latest.json"), {
    updatedAt: at,
    count: events.length,
    hot: events.filter((e) => e.trendStatus === "hot").slice(0, 20),
    rising: events.filter((e) => e.trendStatus === "rising").slice(0, 20),
    emerging: events.filter((e) => e.trendStatus === "emerging").slice(0, 20),
    declining: events.filter((e) => e.trendStatus === "declining").slice(0, 20),
  });
  return file;
}
