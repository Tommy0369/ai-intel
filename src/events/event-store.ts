import path from "node:path";
import type { IntelEvent } from "../v2-types.js";
import { readJson, readJsonl, writeJson, writeJsonl } from "../store-jsonl.js";

export function eventsDir(dataRoot: string): string {
  return path.join(dataRoot, "events");
}

export interface EventStoreState {
  updatedAt: string;
  eventCount: number;
  articleCount: number;
  catalogArticles?: number;
  mergeRate: number;
  singleArticleEvents: number;
  multiSourceEvents: number;
  multiDomainEvents: number;
  rebuilt?: boolean;
}

export function summarizeEvents(
  events: IntelEvent[],
  catalogArticles?: number,
): EventStoreState {
  const articleIds = new Set<string>();
  let multiSource = 0;
  let multiDomain = 0;
  for (const e of events) {
    for (const id of e.articles) articleIds.add(id);
    if (e.sourceCount > 1) multiSource += 1;
    if ((e.sourceDomains?.length ?? 0) > 1) multiDomain += 1;
  }
  const articleCount = articleIds.size;
  const eventCount = events.length;
  const mergeRate =
    articleCount > 0
      ? Math.round((1 - eventCount / articleCount) * 1000) / 1000
      : 0;
  return {
    updatedAt: new Date().toISOString(),
    eventCount,
    articleCount,
    catalogArticles,
    mergeRate,
    singleArticleEvents: events.filter((e) => e.sourceCount <= 1).length,
    multiSourceEvents: multiSource,
    multiDomainEvents: multiDomain,
  };
}

export async function saveEvents(
  dataRoot: string,
  events: IntelEvent[],
  meta?: { catalogArticleCount?: number; rebuilt?: boolean },
): Promise<{ jsonl: string; index: string; state: string }> {
  const dir = eventsDir(dataRoot);
  const jsonl = path.join(dir, "events.jsonl");
  const index = path.join(dir, "index.json");
  const statePath = path.join(dir, "state.json");
  await writeJsonl(jsonl, events);
  await writeJson(index, {
    updatedAt: new Date().toISOString(),
    count: events.length,
    ids: events.map((e) => e.id),
  });
  const state = {
    ...summarizeEvents(events, meta?.catalogArticleCount),
    rebuilt: meta?.rebuilt,
  };
  await writeJson(statePath, state);
  return { jsonl, index, state: statePath };
}

export async function loadEvents(dataRoot: string): Promise<IntelEvent[]> {
  return readJsonl<IntelEvent>(path.join(eventsDir(dataRoot), "events.jsonl"));
}

export async function loadEventState(
  dataRoot: string,
): Promise<EventStoreState | null> {
  const file = path.join(eventsDir(dataRoot), "state.json");
  const state = await readJson<EventStoreState | null>(file, null);
  return state;
}

export function formatEventStatus(state: EventStoreState): string {
  const lines = [
    "EVENT ENGINE",
    "",
    `events           ${state.eventCount}`,
    `articles linked  ${state.articleCount}`,
    `merge rate       ${Math.round(state.mergeRate * 100)}%`,
    `single-article   ${state.singleArticleEvents}`,
    `multi-source     ${state.multiSourceEvents}`,
    `multi-domain     ${state.multiDomainEvents}`,
  ];
  if (state.catalogArticles != null) {
    lines.push(`catalog slice    ${state.catalogArticles}`);
  }
  lines.push("", `updated ${state.updatedAt}`);
  return lines.join("\n");
}
