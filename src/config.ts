import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { AppConfig, SourcesConfig } from "./types.js";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export function getConfigDir(): string {
  return path.join(rootDir, "config");
}

export async function loadConfig(): Promise<AppConfig> {
  const raw = await readFile(path.join(getConfigDir(), "config.json"), "utf8");
  const parsed = JSON.parse(raw) as AppConfig;
  if (!parsed.dataRoot) {
    throw new Error("config.dataRoot is required");
  }
  return {
    ...parsed,
    dataRoot: parsed.dataRoot,
    intervalMinutes: parsed.intervalMinutes ?? 30,
    vetReviewHours: parsed.vetReviewHours ?? 24,
    dupWatchHours: parsed.dupWatchHours ?? parsed.vetReviewHours ?? 24,
    minFreeGb: parsed.minFreeGb ?? 5,
    userAgent: parsed.userAgent ?? "ai-intel/1.0",
    dailyHour: parsed.dailyHour,
    icloudBridgeRoot: parsed.icloudBridgeRoot,
  };
}

export async function loadSources(): Promise<SourcesConfig> {
  const raw = await readFile(path.join(getConfigDir(), "sources.json"), "utf8");
  return JSON.parse(raw) as SourcesConfig;
}
