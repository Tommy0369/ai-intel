import { access, mkdir, statfs } from "node:fs/promises";
import path from "node:path";
import { CATEGORIES, SOURCES, type AppConfig } from "./types.js";

export class DiskError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DiskError";
  }
}

function volumeRootFromDataRoot(dataRoot: string): string {
  // /Volumes/外付け320GB/ai-intel -> /Volumes/外付け320GB
  const parts = path.resolve(dataRoot).split(path.sep);
  const volumesIdx = parts.indexOf("Volumes");
  if (volumesIdx >= 0 && parts.length > volumesIdx + 1) {
    return path.sep + path.join(...parts.slice(1, volumesIdx + 2));
  }
  return path.resolve(dataRoot);
}

export async function assertDataRootReady(config: AppConfig): Promise<void> {
  const volume = volumeRootFromDataRoot(config.dataRoot);
  try {
    await access(volume);
  } catch {
    throw new DiskError(
      `外付けHDDが見つかりません: ${volume}\n接続を確認してから再実行してください。`,
    );
  }

  const freeBytes = await getFreeBytes(volume);
  const freeGb = freeBytes / 1024 ** 3;
  if (freeGb < config.minFreeGb) {
    throw new DiskError(
      `空き容量不足: ${freeGb.toFixed(2)} GB（最低 ${config.minFreeGb} GB 必要）`,
    );
  }
}

export async function getFreeBytes(targetPath: string): Promise<number> {
  const info = await statfs(targetPath);
  return info.bavail * info.bsize;
}

export async function ensureLayout(dataRoot: string): Promise<void> {
  const dirs = [
    dataRoot,
    path.join(dataRoot, "state"),
    path.join(dataRoot, "raw"),
    path.join(dataRoot, "by-category"),
    path.join(dataRoot, "by-source"),
    path.join(dataRoot, "learning"),
    path.join(dataRoot, "learning", "notes"),
    path.join(dataRoot, "create"),
    path.join(dataRoot, "create", "projects"),
    path.join(dataRoot, "ready"),
    path.join(dataRoot, "ready", "categories"),
    path.join(dataRoot, "ready", "bundles"),
    path.join(dataRoot, "ready", "links"),
    path.join(dataRoot, "fleet"),
    path.join(dataRoot, "daily"),
    path.join(dataRoot, "daily", "logs"),
    path.join(dataRoot, "agent"),
    path.join(dataRoot, "vet"),
    path.join(dataRoot, "vet", "quarantine"),
    path.join(dataRoot, "vet", "cleared"),
    path.join(dataRoot, "vet", "dup"),
    path.join(dataRoot, "vet", "dup", "quarantine"),
    path.join(dataRoot, "enrich"),
    path.join(dataRoot, "create", "projects", "analogy-agent"),
    ...CATEGORIES.map((c) => path.join(dataRoot, "by-category", c)),
    ...SOURCES.map((s) => path.join(dataRoot, "by-source", s)),
  ];
  for (const dir of dirs) {
    await mkdir(dir, { recursive: true });
  }
}

export function volumePath(dataRoot: string): string {
  return volumeRootFromDataRoot(dataRoot);
}
