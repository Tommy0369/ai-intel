import type { Category, RawItem } from "./types.js";

/**
 * 先にマッチした棚が勝つ。
 * business棚・reviews棚をAI棚より前に置き、
 * 「training」などが research に吸われないようにする。
 */
const RULES: Array<{ category: Category; patterns: RegExp[] }> = [
  {
    category: "reviews",
    patterns: [
      /\bsystematic review\b/i,
      /\bmeta[- ]?analysis\b/i,
      /\bscoping review\b/i,
      /\bnarrative review\b/i,
      /\bliterature review\b/i,
      /\bumbrella review\b/i,
      /\bintegrative review\b/i,
      /\breview and meta/i,
      /\bシステマティックレビュー\b/,
      /\bメタアナリシス\b/,
      /\bメタ分析\b/,
      /\bレビュー論文\b/,
    ],
  },
  {
    category: "dining",
    patterns: [
      /\brestaurant\b/i,
      /\bfoodservice\b/i,
      /\bfood service\b/i,
      /\bhospitality\b/i,
      /\bghost kitchen\b/i,
      /\bcloud kitchen\b/i,
      /\bqsr\b/i,
      /\bquick[- ]?service\b/i,
      /\bfood truck\b/i,
      /\bcatering\b/i,
      /\bmenu engineer/i,
      /\bdelivery app\b/i,
      /\bubereats|uber eats|doordash|grubhub/i,
      /\bbarista\b/i,
      /\bcafe business\b/i,
      /\b飲食\b/,
      /\b外食\b/,
      /\b飲食店\b/,
      /\b店舗運営\b/,
      /\bフードビジネス\b/,
      /\bゴーストキッチン\b/,
    ],
  },
  {
    category: "biz",
    patterns: [
      /\bmarketing\b/i,
      /\bcontent marketing\b/i,
      /\bgrowth hacking\b/i,
      /\bcustomer acquisition\b/i,
      /\blead gen/i,
      /\bsales funnel\b/i,
      /\bconversion rate\b/i,
      /\bpricing strategy\b/i,
      /\bsmall business\b/i,
      /\bentrepreneur/i,
      /\bsolopreneur\b/i,
      /\bindie hacker/i,
      /\bbootstrapp?ed\b/i,
      /\bmrr\b|\barr\b/i,
      /\bcrm\b/i,
      /\bgo[- ]?to[- ]?market\b/i,
      /\bbusiness model\b/i,
      /\bpersonal brand/i,
      /\bsocial media marketing\b/i,
      /\bマーケ\b/,
      /\bマーケティング\b/,
      /\b集客\b/,
      /\b起業\b/,
      /\b個人事業\b/,
      /\b副業\b/,
      /\b経営\b/,
      /\b売上\b/,
      /\b価格戦略\b/,
      /\b顧客獲得\b/,
      /\bブランディング\b/,
    ],
  },
  {
    category: "trends",
    patterns: [
      /\bproduct hunt\b/i,
      /\btrend(ing|s)?\b/i,
      /\bgadget\b/i,
      /\bconsumer tech\b/i,
      /\blaunching soon\b/i,
      /\bviral\b/i,
      /\bwearable\b/i,
      /\bstartup\b/i,
      /\b新商品\b/,
      /\bトレンド\b/,
      /\b話題の\b/,
    ],
  },
  {
    category: "mind",
    patterns: [
      /\bpsychology\b/i,
      /\bpsychological\b/i,
      /\bbehavioral econom/i,
      /\bbehavioural econom/i,
      /\bcognitive bias\b/i,
      /\bnudge\b/i,
      /\bhabit\b/i,
      /\bmotivat/i,
      /\bneuro[- ]?linguistic\b/i,
      /\bpersuasion\b/i,
      /\bemotion regulation\b/i,
      /\bmindfulness\b/i,
      /\bpsycholog/i,
      /\bneuroscience\b/i,
      /\b心理学\b/,
      /\b行動経済\b/,
      /\b認知バイアス\b/,
      /\b習慣\b/,
      /\bモチベーション\b/,
    ],
  },
  {
    category: "body",
    patterns: [
      /\bworkout\b/i,
      /\bfitness\b/i,
      /\bexercise\b/i,
      /\bstrength training\b/i,
      /\bhypertrophy\b/i,
      /\bcardio\b/i,
      /\bsleep\b/i,
      /\bciradian\b/i,
      /\bnutrition\b/i,
      /\bprotein\b/i,
      /\bmuscle\b/i,
      /\b(muscle|post[- ]?workout|athletic)\s*recovery\b/i,
      /\bvo2\b/i,
      /\bhrv\b/i,
      /\b運動\b/,
      /\bトレーニング\b/,
      /\b睡眠\b/,
      /\b栄養\b/,
      /\b筋トレ\b/,
    ],
  },
  {
    category: "agents",
    patterns: [
      /\bagents?\b/i,
      /\bmulti[- ]?agent\b/i,
      /\bautonomous\b/i,
      /\btool[- ]?use\b/i,
      /\breact agent\b/i,
      /\blanggraph\b/i,
      /\bcrewai\b/i,
      /\bautogen\b/i,
    ],
  },
  {
    category: "safety",
    patterns: [
      /\balignment\b/i,
      /\bsafety\b/i,
      /\bred[- ]?team/i,
      /\bjailbreak\b/i,
      /\bresponsible ai\b/i,
      /\bcontent modera/i,
    ],
  },
  {
    category: "multimodal",
    patterns: [
      /\bmultimodal\b/i,
      /\bvision[- ]?language\b/i,
      /\bvlm\b/i,
      /\bimage[- ]?to[- ]?text\b/i,
      /\btext[- ]?to[- ]?image\b/i,
      /\bvideo generation\b/i,
      /\bdiffusion\b/i,
    ],
  },
  {
    category: "llms",
    patterns: [
      /\bllm\b/i,
      /\blarge language model\b/i,
      /\bgpt[- ]?\d/i,
      /\bclaude\b/i,
      /\bgemini\b/i,
      /\bllama\b/i,
      /\bmistral\b/i,
      /\btransformer\b/i,
      /\binstruction[- ]?tun/i,
      /\bfine[- ]?tun/i,
    ],
  },
  {
    category: "tools",
    patterns: [
      /\brag\b/i,
      /\bvector\b/i,
      /\bembedding\b/i,
      /\blangchain\b/i,
      /\bllamaindex\b/i,
      /\bcursor\b/i,
      /\bide\b/i,
      /\bsdk\b/i,
      /\bframework\b/i,
      /\bbenchmark\b/i,
    ],
  },
  {
    category: "opensource",
    patterns: [
      /\bopen[- ]?source\b/i,
      /\bhuggingface\b/i,
      /\bhugging face\b/i,
      /\bmit license\b/i,
      /\bgithub\.com\b/i,
    ],
  },
  {
    category: "industry",
    patterns: [
      /\blaunch\b/i,
      /\brelease\b/i,
      /\bchangelog\b/i,
      /\bproduct\b/i,
      /\bfunding\b/i,
      /\bacquisition\b/i,
      /\bopenai\b/i,
      /\banthropic\b/i,
    ],
  },
  {
    category: "research",
    patterns: [
      /\barxiv\b/i,
      /\bpaper\b/i,
      /\bpreprint\b/i,
      /\bcs\.(ai|lg|cl|cv|ma)\b/i,
      /\bdataset\b/i,
      /\bmodel training\b/i,
      /\bneural training\b/i,
    ],
  },
];

export function categorize(item: RawItem): Category {
  if (item.categoryHint) return item.categoryHint;

  const hay = [
    item.title,
    item.summary ?? "",
    item.tags?.join(" ") ?? "",
    item.url,
  ].join(" ");

  for (const rule of RULES) {
    if (rule.patterns.some((p) => p.test(hay))) {
      return rule.category;
    }
  }

  if (item.source === "arxiv") return "research";
  if (item.source === "github") return "opensource";
  if (item.source === "docs") return "industry";
  if (item.source === "youtube") return "other";
  return "other";
}

/** リンク種別タグ（動画 / Web / 論文） */
export function linkKindTag(item: Pick<RawItem, "source" | "url">): string {
  if (item.source === "youtube") return "link:video";
  const url = item.url ?? "";
  if (
    item.source === "arxiv" ||
    item.source === "europepmc" ||
    /arxiv\.org|doi\.org|pubmed\.ncbi|europepmc\.org/i.test(url)
  ) {
    return "link:paper";
  }
  if (/^https?:\/\//i.test(url)) return "link:web";
  return "link:web";
}

export function inferTags(item: RawItem, category: Category): string[] {
  const tags = new Set<string>(item.tags ?? []);
  tags.add(category);
  tags.add(item.source);
  tags.add(linkKindTag(item));

  const hay = `${item.title} ${item.summary ?? ""}`.toLowerCase();
  const candidates: Array<[string, RegExp]> = [
    ["gpt", /\bgpt\b/],
    ["claude", /\bclaude\b/],
    ["gemini", /\bgemini\b/],
    ["llama", /\bllama\b/],
    ["rag", /\brag\b/],
    ["agent", /\bagents?\b/],
    ["openai", /\bopenai\b/],
    ["anthropic", /\banthropic\b/],
    ["huggingface", /hugging\s?face|huggingface/],
    ["sleep", /\bsleep\b/],
    ["fitness", /\bfitness|workout|exercise\b/],
    ["psychology", /\bpsycholog|behavioral econom|nudge\b/],
    ["nlp-coaching", /neuro[- ]?linguistic|\bnlp coaching\b/],
    ["trend", /\btrend|product hunt|gadget\b/],
    ["dining", /\brestaurant|foodservice|飲食|外食|ghost kitchen\b/],
    ["biz", /\bmarketing|entrepreneur|small business|マーケ|起業|集客|個人事業\b/],
    ["systematic-review", /\bsystematic review|システマティックレビュー\b/],
    ["meta-analysis", /\bmeta[- ]?analysis|メタアナリシス|メタ分析\b/],
    ["review-paper", /\b(scoping|narrative|literature|umbrella) review|レビュー論文\b/],
    ["business-fusion", /\bai\b.+\b(health|fitness|psych|habit|sleep|restaurant|marketing)|habit.+\bai\b/],
  ];
  for (const [tag, re] of candidates) {
    if (re.test(hay)) tags.add(tag);
  }
  return [...tags].sort();
}
