import { createHash } from "node:crypto";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";

export function normalizeUrl(url: string): string {
  try {
    const u = new URL(url.trim());
    u.hash = "";
    // strip common tracking params
    for (const key of [...u.searchParams.keys()]) {
      if (
        key.startsWith("utm_") ||
        key === "ref" ||
        key === "si" ||
        key === "feature"
      ) {
        u.searchParams.delete(key);
      }
    }
    let href = u.toString();
    if (href.endsWith("/") && u.pathname !== "/") {
      href = href.slice(0, -1);
    }
    return href;
  } catch {
    return url.trim();
  }
}

export function makeId(source: string, url: string): string {
  const hash = createHash("sha1")
    .update(`${source}|${normalizeUrl(url)}`)
    .digest("hex")
    .slice(0, 12);
  return `${source}_${hash}`;
}

export class DedupStore {
  private seen = new Set<string>();
  private filePath: string;
  private dirty = false;

  constructor(dataRoot: string) {
    this.filePath = path.join(dataRoot, "state", "seen-urls.json");
  }

  async load(): Promise<void> {
    try {
      const raw = await readFile(this.filePath, "utf8");
      const list = JSON.parse(raw) as string[];
      this.seen = new Set(list);
    } catch {
      this.seen = new Set();
    }
  }

  has(url: string): boolean {
    return this.seen.has(normalizeUrl(url));
  }

  add(url: string): void {
    const n = normalizeUrl(url);
    if (!this.seen.has(n)) {
      this.seen.add(n);
      this.dirty = true;
    }
  }

  size(): number {
    return this.seen.size;
  }

  async save(): Promise<void> {
    if (!this.dirty) return;
    await mkdir(path.dirname(this.filePath), { recursive: true });
    const list = [...this.seen].sort();
    await writeFile(this.filePath, JSON.stringify(list, null, 2) + "\n", "utf8");
    this.dirty = false;
  }
}
