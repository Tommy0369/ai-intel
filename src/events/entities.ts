const COMPANY_RE =
  /\b(OpenAI|Anthropic|Google|DeepMind|Meta|Microsoft|NVIDIA|Apple|Amazon|Mistral|xAI|Hugging Face|Vercel|LangChain|LlamaIndex|Perplexity|Cohere|Stability)\b/gi;

const MODEL_RE =
  /\b(GPT-?5|GPT-?4o?|Claude(?:\s+Code)?|Gemini|Llama|Grok|Nemotron|Qwen|DeepSeek|Sora|Copilot)\b/gi;

const PRODUCT_RE =
  /\b(ChatGPT|Claude Code|AI Studio|Vertex|Bedrock|Cursor|NotebookLM)\b/gi;

export function extractNamed(text: string, re: RegExp): string[] {
  const out = new Set<string>();
  const copy = new RegExp(re.source, re.flags);
  let m: RegExpExecArray | null;
  while ((m = copy.exec(text))) {
    out.add(m[1] ?? m[0]);
  }
  return [...out];
}

export function extractEntities(title: string, tags: string[] = []): {
  companies: string[];
  models: string[];
  products: string[];
  entities: string[];
} {
  const hay = `${title} ${tags.join(" ")}`;
  const companies = extractNamed(hay, COMPANY_RE);
  const models = extractNamed(hay, MODEL_RE);
  const products = extractNamed(hay, PRODUCT_RE);
  const entities = [...new Set([...companies, ...models, ...products])];
  return { companies, models, products, entities };
}

export function jaccard(a: Iterable<string>, b: Iterable<string>): number {
  const A = new Set(a);
  const B = new Set(b);
  if (!A.size && !B.size) return 0;
  let inter = 0;
  for (const x of A) if (B.has(x)) inter++;
  return inter / (A.size + B.size - inter);
}
