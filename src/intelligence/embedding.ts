/** Optional embedding backend. Default is local hashed bag-of-words. */

export interface EmbeddingProvider {
  name: string;
  embed(text: string): Promise<number[]>;
}

const DIM = 64;

function hashToken(t: string): number {
  let h = 2166136261;
  for (let i = 0; i < t.length; i++) {
    h ^= t.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h) % DIM;
}

export class LocalHashEmbedding implements EmbeddingProvider {
  name = "local";
  async embed(text: string): Promise<number[]> {
    const vec = new Array<number>(DIM).fill(0);
    const toks = text
      .toLowerCase()
      .split(/[^a-z0-9\u3040-\u30ff\u4e00-\u9fff]+/i)
      .filter((t) => t.length >= 2);
    for (const t of toks) vec[hashToken(t)] += 1;
    let n = 0;
    for (const v of vec) n += v * v;
    const mag = Math.sqrt(n) || 1;
    return vec.map((v) => v / mag);
  }
}

export function cosine(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length);
  let s = 0;
  for (let i = 0; i < n; i++) s += a[i] * b[i];
  return s;
}

export function createEmbeddingProvider(
  kind: "local" | "ollama" | "external" = "local",
): EmbeddingProvider {
  // ollama / external は将来差し替え。未設定なら local。
  void kind;
  return new LocalHashEmbedding();
}
