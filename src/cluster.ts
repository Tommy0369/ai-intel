import { loadCatalog } from "./corpus.js";
import { readAllItems, type ReadItem } from "./readall.js";
import type { Category, SourceKind } from "./types.js";

export interface ClusterMember {
  id: string;
  title: string;
  titleJa?: string;
  url: string;
  source: SourceKind;
  category: Category;
  summary: string;
  path: string;
  tags: string[];
  /** 表示・時系列用: published_at があればそれ、なければ collected_at */
  date?: string;
}

export interface TopicCluster {
  index: number;
  /** 内部用ラベル（キーワード等）。表示は titleJa を優先 */
  label: string;
  /** 日本語の話題見出し（NotebookLM / UI 用） */
  titleJa: string;
  slug: string;
  category: Category;
  keywords: string[];
  members: ClusterMember[];
  size: number;
}

export interface ClusterOptions {
  /** ペアを同じ話題とみなすコサイン類似のしきい値（0〜1） */
  similarity?: number;
  /** 採用する最小メンバー数 */
  minSize?: number;
  /** 出力するグループ数の上限 */
  maxGroups?: number;
  /** 1クラスタの上限件数。超えたら類似度を上げて再分割 */
  maxSize?: number;
}

export interface ClusterResult {
  clusters: TopicCluster[];
  totalItems: number;
  clusteredItems: number;
  /** minSize を満たすグループ総数（maxGroups で切る前の候補数） */
  candidateCount: number;
  options: Required<ClusterOptions>;
}

const DEFAULTS: Required<ClusterOptions> = {
  similarity: 0.42,
  minSize: 2,
  maxGroups: 60,
  maxSize: 10,
};

const STOPWORDS = new Set([
  "the", "and", "for", "are", "was", "were", "with", "from", "this", "that",
  "these", "those", "have", "has", "had", "will", "would", "can", "could",
  "should", "into", "your", "you", "our", "out", "not", "but", "how", "what",
  "when", "where", "who", "why", "which", "its", "his", "her", "their", "them",
  "they", "she", "him", "over", "under", "than", "then", "some", "any", "all",
  "new", "now", "get", "got", "use", "using", "used", "via", "per", "about",
  "more", "most", "less", "very", "just", "like", "also", "one", "two", "here",
  "there", "such", "each", "other", "been", "being", "make", "made", "does",
  "did", "doing", "may", "might", "must", "shall", "own", "off", "yet", "too",
  "http", "https", "www", "com", "org", "net", "amp", "utm", "html",
  "ai", "llm", "llms",
]);

const KNOWN_ENTITIES = [
  "OpenAI", "Anthropic", "Google", "DeepMind", "Gemini", "ChatGPT", "GPT-5",
  "GPT-4", "Claude", "Llama", "Meta", "Microsoft", "Copilot", "NVIDIA",
  "Mistral", "DeepSeek", "Qwen", "Hugging Face", "LangChain", "LlamaIndex",
  "Perplexity", "Cohere", "Stability AI", "Midjourney", "Apple", "Amazon",
  "AWS", "Azure", "GitHub", "YouTube", "Nemotron", "Grok", "xAI", "Runway",
  "Sora", "Vercel", "Notion", "Slack",
];

/** キーワード／本文から拾うテーマ語（日本語見出し用） */
const THEME_HINTS: Array<{ re: RegExp; ja: string }> = [
  { re: /\bcost\b|\bbill\b|\bprice\b|\btoken\b|\bbudget\b|料金|コスト|請求/i, ja: "料金・コスト" },
  { re: /cach(e|ing)|reuse|memoiz|キャッシュ/i, ja: "キャッシュ・再利用" },
  { re: /agent|orchestr|autonomous|エージェント/i, ja: "エージェント" },
  { re: /rag|retriev|embed|vector|検索|知識/i, ja: "検索・RAG" },
  { re: /safe|align|jailbreak|security|安全|制御/i, ja: "安全・制御" },
  { re: /eval|benchmark|評価|ベンチ/i, ja: "評価・ベンチマーク" },
  { re: /open.?source|opensource|weight|OSS|オープン/i, ja: "オープンソース" },
  { re: /multimodal|vision|画像|音声|動画/i, ja: "マルチモーダル" },
  { re: /inferen|fine[- ]?tun|\bgpu\b|推論|学習/i, ja: "推論・学習インフラ" },
  { re: /copyright|settlement|lawsuit|規制|著作権/i, ja: "規制・権利" },
  { re: /release|launch|announce|発表|リリース/i, ja: "発表・リリース" },
  { re: /funding|ipo|acquire|買収|資金/i, ja: "資金・事業動向" },
  { re: /sleep|workout|diet|睡眠|運動|食事/i, ja: "健康・生活" },
  { re: /habit|psych|行動|心理/i, ja: "心理・行動" },
  { re: /restaurant|dining|飲食|店舗/i, ja: "飲食・店舗" },
  { re: /marketing|startup|集客|マーケ|起業/i, ja: "マーケ・事業" },
];

/**
 * 内容テキストからトークンを作る。
 * - ASCII 語: 小文字化して3文字以上・ストップワード除外
 * - CJK 連続: 文字 bigram（1文字なら unigram）
 */
function tokenize(text: string): string[] {
  const lower = text.toLowerCase();
  const tokens: string[] = [];

  const ascii = lower.match(/[a-z0-9][a-z0-9+.#-]*/g) ?? [];
  for (const t of ascii) {
    const trimmed = t.replace(/^[-.#+]+|[-.#+]+$/g, "");
    if (trimmed.length < 3) continue;
    if (/^\d+$/.test(trimmed)) continue;
    if (STOPWORDS.has(trimmed)) continue;
    tokens.push(trimmed);
  }

  const cjkRuns = lower.match(/[\u3040-\u30ff\u4e00-\u9fff]+/g) ?? [];
  for (const run of cjkRuns) {
    if (run.length === 1) {
      tokens.push(run);
      continue;
    }
    for (let i = 0; i < run.length - 1; i++) {
      tokens.push(run.slice(i, i + 2));
    }
  }

  return tokens;
}

function contentText(item: ReadItem): string {
  return [
    item.title,
    item.title, // タイトルは話題判別に効くので重み付けで2回
    item.summary,
    item.bodyPreview,
    item.tags.join(" "),
  ]
    .filter(Boolean)
    .join(" ");
}

class UnionFind {
  private parent: number[];

  constructor(n: number) {
    this.parent = Array.from({ length: n }, (_, i) => i);
  }

  findRoot(x: number): number {
    let root = x;
    while (this.parent[root] !== root) root = this.parent[root];
    while (this.parent[x] !== root) {
      const next = this.parent[x];
      this.parent[x] = root;
      x = next;
    }
    return root;
  }

  union(a: number, b: number): void {
    const ra = this.findRoot(a);
    const rb = this.findRoot(b);
    if (ra !== rb) this.parent[rb] = ra;
  }
}

function slugify(label: string, index: number): string {
  const ascii = label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return ascii || `group-${index}`;
}

function clip(s: string, n: number): string {
  const t = (s ?? "").replace(/\s+/g, " ").trim();
  return t.length <= n ? t : `${t.slice(0, n - 1)}…`;
}

function dominantCategory(members: ClusterMember[]): Category {
  const counts = new Map<Category, number>();
  for (const m of members) {
    counts.set(m.category, (counts.get(m.category) ?? 0) + 1);
  }
  let best: Category = members[0]?.category ?? "other";
  let bestN = 0;
  for (const [cat, n] of counts) {
    if (n > bestN) {
      best = cat;
      bestN = n;
    }
  }
  return best;
}

interface DocVectors {
  vectors: Array<Map<string, number>>;
  norms: number[];
  df: Map<string, number>;
  maxDf: number;
}

function buildVectors(docs: ReadItem[]): DocVectors {
  const n = docs.length;
  const df = new Map<string, number>();
  const termCounts: Array<Map<string, number>> = [];
  for (const doc of docs) {
    const counts = new Map<string, number>();
    for (const tok of tokenize(contentText(doc))) {
      counts.set(tok, (counts.get(tok) ?? 0) + 1);
    }
    termCounts.push(counts);
    for (const term of counts.keys()) {
      df.set(term, (df.get(term) ?? 0) + 1);
    }
  }

  const idf = new Map<string, number>();
  for (const [term, d] of df) {
    idf.set(term, Math.log((n + 1) / (d + 1)) + 1);
  }

  const maxDf = Math.max(2, Math.min(Math.floor(n * 0.35) || 2, 400));
  const vectors: Array<Map<string, number>> = [];
  const norms: number[] = [];

  for (let i = 0; i < n; i++) {
    const counts = termCounts[i];
    const vec = new Map<string, number>();
    let sumSq = 0;
    for (const [term, tf] of counts) {
      const w = tf * (idf.get(term) ?? 0);
      if (w <= 0) continue;
      vec.set(term, w);
      sumSq += w * w;
    }
    vectors.push(vec);
    norms.push(Math.sqrt(sumSq) || 1);
  }

  return { vectors, norms, df, maxDf };
}

function cosine(
  a: number,
  b: number,
  vectors: Array<Map<string, number>>,
  norms: number[],
): number {
  const va = vectors[a];
  const vb = vectors[b];
  const [small, big] = va.size <= vb.size ? [va, vb] : [vb, va];
  let dot = 0;
  for (const [term, wa] of small) {
    const wb = big.get(term);
    if (wb) dot += wa * wb;
  }
  return dot / (norms[a] * norms[b]);
}

/** ローカル索引上で連結成分クラスタ（indices は docs 内の局所 0..n-1） */
function connectedComponents(
  n: number,
  vectors: Array<Map<string, number>>,
  norms: number[],
  df: Map<string, number>,
  maxDf: number,
  similarity: number,
): number[][] {
  const inverted = new Map<string, number[]>();
  for (let i = 0; i < n; i++) {
    for (const term of vectors[i].keys()) {
      const d = df.get(term) ?? 0;
      if (d < 2 || d > maxDf) continue;
      const post = inverted.get(term);
      if (post) post.push(i);
      else inverted.set(term, [i]);
    }
  }

  const uf = new UnionFind(n);
  for (const post of inverted.values()) {
    for (let x = 0; x < post.length; x++) {
      const a = post[x];
      for (let y = x + 1; y < post.length; y++) {
        const b = post[y];
        if (uf.findRoot(a) === uf.findRoot(b)) continue;
        if (cosine(a, b, vectors, norms) >= similarity) {
          uf.union(a, b);
        }
      }
    }
  }

  const groups = new Map<number, number[]>();
  for (let i = 0; i < n; i++) {
    const root = uf.findRoot(i);
    const g = groups.get(root);
    if (g) g.push(i);
    else groups.set(root, [i]);
  }
  return [...groups.values()];
}

/**
 * maxSize を超えるグループを、類似度を段階的に上げて再分割する。
 * それでも割れない場合は件数で強制チャンクする。
 */
function refineGroups(
  groups: number[][],
  vectors: Array<Map<string, number>>,
  norms: number[],
  df: Map<string, number>,
  maxDf: number,
  baseSim: number,
  minSize: number,
  maxSize: number,
): number[][] {
  const out: number[][] = [];

  function splitOne(indices: number[], sim: number, depth: number): void {
    if (indices.length <= maxSize) {
      if (indices.length >= minSize) out.push(indices);
      return;
    }
    if (depth > 6 || sim >= 0.92) {
      for (let i = 0; i < indices.length; i += maxSize) {
        const chunk = indices.slice(i, i + maxSize);
        if (chunk.length >= minSize) out.push(chunk);
      }
      return;
    }

    // 局所インデックスで再クラスタ
    const localN = indices.length;
    const localVec = indices.map((i) => vectors[i]);
    const localNorms = indices.map((i) => norms[i]);
    const localDf = new Map<string, number>();
    for (const i of indices) {
      for (const term of vectors[i].keys()) {
        localDf.set(term, (localDf.get(term) ?? 0) + 1);
      }
    }
    const localMaxDf = Math.max(
      2,
      Math.min(Math.floor(localN * 0.5) || 2, maxDf),
    );
    const parts = connectedComponents(
      localN,
      localVec,
      localNorms,
      localDf,
      localMaxDf,
      sim,
    ).map((part) => part.map((li) => indices[li]));

    const useful = parts.filter((p) => p.length >= minSize);
    const stillOne =
      useful.length <= 1 &&
      (useful[0]?.length ?? 0) === indices.length;

    if (stillOne) {
      splitOne(indices, Math.min(0.95, sim + 0.12), depth + 1);
      return;
    }

    for (const p of useful) {
      splitOne(p, sim, depth + 1);
    }
  }

  for (const g of groups) {
    splitOne(g, Math.min(0.9, baseSim + 0.15), 0);
  }
  return out;
}

function pickEntity(blob: string): string | null {
  let best: string | null = null;
  let bestN = 0;
  for (const name of KNOWN_ENTITIES) {
    const re = new RegExp(
      `\\b${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`,
      "gi",
    );
    const hits = (blob.match(re) || []).length;
    if (hits > bestN) {
      best = name;
      bestN = hits;
    }
  }
  return bestN > 0 ? best : null;
}

function pickTheme(blob: string): string | null {
  for (const h of THEME_HINTS) {
    if (h.re.test(blob)) return h.ja;
  }
  return null;
}

function hasCjk(s: string): boolean {
  return /[\u3040-\u30ff\u4e00-\u9fff]/.test(s);
}

/** クラスタ向けの短い日本語見出し（外部AI不使用） */
export function buildClusterTitleJa(
  members: ClusterMember[],
  keywords: string[],
): string {
  const rep =
    [...members].sort(
      (a, b) => (b.summary?.length ?? 0) - (a.summary?.length ?? 0),
    )[0] ?? members[0];
  const blob = members
    .map((m) => `${m.title} ${m.titleJa ?? ""} ${m.summary}`)
    .join("\n");
  const entity = pickEntity(blob);
  const theme = pickTheme(`${blob} ${keywords.join(" ")}`);

  if (entity && theme) return clip(`${entity}の${theme}`, 48);
  if (entity) {
    const ja = rep?.titleJa?.trim();
    if (ja && hasCjk(ja)) return clip(`${entity} — ${ja}`, 48);
    return clip(`${entity}の話題`, 48);
  }
  if (theme) {
    const ja = rep?.titleJa?.trim();
    if (ja && hasCjk(ja)) return clip(`${theme}：${ja}`, 48);
    return clip(theme, 48);
  }

  const ja = rep?.titleJa?.trim();
  if (ja && hasCjk(ja)) return clip(ja, 48);

  const title = rep?.title?.trim();
  if (title) return clip(title, 48);

  return keywords.slice(0, 3).join("・") || "話題まとめ";
}

function toMember(
  d: ReadItem,
  titleJaById: Map<string, string | undefined>,
  urlById?: Map<string, string>,
): ClusterMember {
  return {
    id: d.id,
    title: d.title,
    titleJa: titleJaById.get(d.id),
    url: urlById?.get(d.id) || d.url,
    source: d.source,
    category: d.category,
    summary: d.summary,
    path: d.path,
    tags: d.tags,
    date: d.publishedAt || d.collectedAt,
  };
}

const KEYWORD_NOISE = new Set([
  "話題", "その他", "お知らせ", "関連", "情報", "記事", "ニュース", "まとめ",
  "ビジネス", "トレンド", "心理", "からだ", "飲食", "産業", "研究",
]);

/**
 * UI/CONTEXT用キーワード。
 * CJK bigram（経ク・ロス等）は出さず、タイトルから意味のある語を拾う。
 */
function keywordsFor(members: ClusterMember[]): string[] {
  const scores = new Map<string, number>();

  const bump = (term: string, w: number) => {
    const t = term.trim();
    if (t.length < 2) return;
    if (KEYWORD_NOISE.has(t)) return;
    if (/^[\u3040-\u309f]{1,2}$/.test(t)) return; // ひらがな短いのは除外
    scores.set(t, (scores.get(t) ?? 0) + w);
  };

  for (const m of members) {
    const blob = `${m.titleJa ?? ""} ${m.title} ${m.summary ?? ""}`;
    for (const name of KNOWN_ENTITIES) {
      if (new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i").test(blob)) {
        bump(name, 8);
      }
    }
    for (const h of THEME_HINTS) {
      if (h.re.test(blob)) bump(h.ja, 5);
    }
    // 日本語のまとまり（3〜12文字）
    for (const run of blob.match(/[\u3040-\u30ff\u4e00-\u9fff]{3,12}/g) ?? []) {
      bump(run, run.length >= 4 ? 3 : 1);
    }
    // 英語の意味語
    for (const w of blob.toLowerCase().match(/[a-z][a-z0-9+#.-]{3,}/g) ?? []) {
      if (STOPWORDS.has(w)) continue;
      bump(w, 2);
    }
  }

  return [...scores.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([term]) => term)
    .slice(0, 8);
}

/**
 * 1カテゴリ内で話題クラスタを作る。
 * docs は同一カテゴリの ReadItem 配列。
 */
function clusterCategoryDocs(
  docs: ReadItem[],
  titleJaById: Map<string, string | undefined>,
  urlById: Map<string, string>,
  options: Required<ClusterOptions>,
): Array<Omit<TopicCluster, "index">> {
  const n = docs.length;
  if (n < options.minSize) return [];

  const { vectors, norms, df, maxDf } = buildVectors(docs);
  const raw = connectedComponents(
    n,
    vectors,
    norms,
    df,
    maxDf,
    options.similarity,
  ).filter((g) => g.length >= options.minSize);

  const refined = refineGroups(
    raw,
    vectors,
    norms,
    df,
    maxDf,
    options.similarity,
    options.minSize,
    options.maxSize,
  );

  return refined.map((memberIdx) => {
    const members = memberIdx.map((i) =>
      toMember(docs[i], titleJaById, urlById),
    );
    const keywords = keywordsFor(members);
    const category = dominantCategory(members);
    const titleJa = buildClusterTitleJa(members, keywords);
    const label =
      titleJa ||
      keywords.slice(0, 3).join(" / ") ||
      members[0]?.titleJa ||
      members[0]?.title ||
      `${category} の話題`;

    return {
      label,
      titleJa,
      slug: "", // index 確定後に付与
      category,
      keywords,
      members,
      size: members.length,
    };
  });
}

/**
 * 収集物を内容ベースで「同じ話題」ごとにクラスタ化する。
 * - カテゴリ別に分割してからクラスタ（分野混在を防ぐ）
 * - 大きすぎる塊は類似度を上げて再分割
 * - 外部依存なし（ローカル TF-IDF + コサイン類似 + 連結成分）
 */
export async function clusterCorpus(
  dataRoot: string,
  opts?: ClusterOptions,
): Promise<ClusterResult> {
  const options: Required<ClusterOptions> = {
    similarity: opts?.similarity ?? DEFAULTS.similarity,
    minSize: Math.max(2, opts?.minSize ?? DEFAULTS.minSize),
    maxGroups: Math.max(1, opts?.maxGroups ?? DEFAULTS.maxGroups),
    maxSize: Math.max(2, opts?.maxSize ?? DEFAULTS.maxSize),
  };

  const [{ items }, catalog] = await Promise.all([
    readAllItems(dataRoot),
    loadCatalog(dataRoot),
  ]);
  const titleJaById = new Map(
    catalog.map((e) => [e.id, e.title_ja] as const),
  );
  const urlById = new Map(
    catalog.map((e) => [
      e.id,
      e.canonical_url && !/news\.google\.com/i.test(e.canonical_url)
        ? e.canonical_url
        : e.url,
    ]),
  );

  const docs = items.filter((i) => i.readOk);
  const byCat = new Map<Category, ReadItem[]>();
  for (const d of docs) {
    const list = byCat.get(d.category);
    if (list) list.push(d);
    else byCat.set(d.category, [d]);
  }

  const pooled: Array<Omit<TopicCluster, "index">> = [];
  for (const catDocs of byCat.values()) {
    pooled.push(...clusterCategoryDocs(catDocs, titleJaById, urlById, options));
  }

  pooled.sort((a, b) => b.size - a.size);
  const candidateCount = pooled.length;
  const chosen = pooled.slice(0, options.maxGroups);

  const clusters: TopicCluster[] = chosen.map((c, idx) => {
    const index = idx + 1;
    return {
      ...c,
      index,
      slug: `cluster-${String(index).padStart(2, "0")}-${slugify(c.titleJa || c.label, index)}`,
    };
  });

  return {
    clusters,
    totalItems: docs.length,
    clusteredItems: clusters.reduce((a, c) => a + c.size, 0),
    candidateCount,
    options,
  };
}
