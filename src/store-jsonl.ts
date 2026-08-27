import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export async function writeJson(
  file: string,
  data: unknown,
): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(data, null, 2) + "\n", "utf8");
}

export async function readJson<T>(file: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await readFile(file, "utf8")) as T;
  } catch {
    return fallback;
  }
}

export async function writeJsonl<T>(file: string, rows: T[]): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  const body = rows.map((r) => JSON.stringify(r)).join("\n");
  await writeFile(file, body + (rows.length ? "\n" : ""), "utf8");
}

export async function readJsonl<T>(file: string): Promise<T[]> {
  try {
    const raw = await readFile(file, "utf8");
    return raw
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean)
      .map((l) => JSON.parse(l) as T);
  } catch {
    return [];
  }
}

export async function appendJsonl(
  file: string,
  row: unknown,
): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  const { appendFile } = await import("node:fs/promises");
  await appendFile(file, JSON.stringify(row) + "\n", "utf8");
}
