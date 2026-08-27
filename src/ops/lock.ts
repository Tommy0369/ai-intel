import { mkdir, open, unlink } from "node:fs/promises";
import path from "node:path";

/**
 * 簡易ファイルロック（同時 collect / rebuild 競合防止）。
 * stale ロックは TTL 超過で奪取。
 */
export async function withDataLock<T>(
  dataRoot: string,
  name: string,
  fn: () => Promise<T>,
  opts?: { ttlMs?: number },
): Promise<T> {
  const ttlMs = opts?.ttlMs ?? 30 * 60_000;
  const dir = path.join(dataRoot, "state", "locks");
  await mkdir(dir, { recursive: true });
  const lockPath = path.join(dir, `${name}.lock`);
  const now = Date.now();
  try {
    const handle = await open(lockPath, "wx");
    await handle.writeFile(
      JSON.stringify({ pid: process.pid, at: new Date().toISOString() }),
      "utf8",
    );
    await handle.close();
  } catch {
    try {
      const { readFile, stat } = await import("node:fs/promises");
      const st = await stat(lockPath);
      if (now - st.mtimeMs > ttlMs) {
        await unlink(lockPath);
        return withDataLock(dataRoot, name, fn, opts);
      }
      const raw = await readFile(lockPath, "utf8");
      throw new Error(`lock busy: ${name} (${raw.slice(0, 120)})`);
    } catch (e) {
      if (e instanceof Error && e.message.startsWith("lock busy")) throw e;
      throw new Error(`lock busy: ${name}`);
    }
  }
  try {
    return await fn();
  } finally {
    try {
      await unlink(lockPath);
    } catch {
      /* ignore */
    }
  }
}

export function newRunId(prefix = "run"): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}
