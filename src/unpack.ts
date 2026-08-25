import { readFile } from "node:fs/promises";
import path from "node:path";
import type { CatalogEntry } from "./types.js";
import { findAnalogies, structureCase, type AnalogyMapping } from "./analogy.js";

/** 中学生でも追える因数分解レイヤー */
export interface FactorLayers {
  oneLine: string;
  elementary: string;
  juniorHigh: string;
  structure: string;
  whyNow: string;
  pitfall: string;
  /** さらに噛み砕いた部品 */
  parts: {
    who: string;
    whatChanged: string;
    how: string;
    soWhat: string;
  };
}

export interface MetaphorSet {
  dailyLife: string;
  schoolOrSports: string;
  natureOrBody: string;
  workplace: string;
}

export interface UnpackedIntel {
  id: string;
  source: CatalogEntry;
  factors: FactorLayers;
  metaphors: MetaphorSet;
  analogy?: AnalogyMapping;
  modalityHints: {
    text: string;
    image: string;
    video: string;
    music: string;
  };
  coreMessage: string;
  guardrails: string[];
  /** 抽出した具体語（受け手AIの変換用） */
  concreteHooks: string[];
}

interface TopicSignals {
  title: string;
  summary: string;
  nouns: string[];
  verbs: string[];
  themeKey: string;
  themeLabelJa: string;
  concreteHooks: string[];
}

function clip(s: string, n: number): string {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length <= n ? t : `${t.slice(0, n - 1)}…`;
}

const THEME_RULES: Array<{
  key: string;
  label: string;
  re: RegExp;
  metaphors: MetaphorSet;
  whyNow: string;
  pitfall: string;
}> = [
  {
    key: "cost",
    label: "コスト・請求・効率化",
    re: /\bcost\b|\bbill\b|\bprice\b|\bcheap\b|\btoken\b|\bbudget\b|\bspend\b|\bdoubled?\b|efficient|optimiz/i,
    metaphors: {
      dailyLife: "電気代が急に増えた家。どこでムダに明かりをつけているか探す感じ",
      schoolOrSports: "部費が足りなくなった部活。練習メニューを見直してムダ打ちを減らす感じ",
      natureOrBody: "カロリーの使いすぎ。同じ動きでも息が上がらない走り方に直す感じ",
      workplace: "請求書が先月の2倍。ツールの使い方を監査して無駄呼びを止める感じ",
    },
    whyNow: "AIを使うほど請求が膨らむ局面で、『賢く使う』が競争力になるから",
    pitfall: "『安い＝正義』と決めつけない。安全性や品質を犠牲にしていないか見る",
  },
  {
    key: "caching",
    label: "キャッシュ・再利用",
    re: /cach(e|ing)|reuse|memoiz/i,
    metaphors: {
      dailyLife: "よく行く店の注文を『いつもの』で済ませる感じ。毎回メニューを読み直さない",
      schoolOrSports: "同じドリルをノートに残して、次の練習で最初から書かない感じ",
      natureOrBody: "筋肉の記憶。一度覚えた動きは毎回ゼロから練習しなくていい",
      workplace: "よく使う資料をテンプレ化。毎回ゼロから作らない",
    },
    whyNow: "同じ説明を何度も送るとコストと待ち時間が増える。再利用が効く時代だから",
    pitfall: "古いキャッシュを信じすぎない。情報が変わったら更新が必要",
  },
  {
    key: "ops",
    label: "運用・観測・土台",
    re: /llmops|\bops\b|observ|monitor|foundation|harness|enterprise|govern/i,
    metaphors: {
      dailyLife: "キッチンの動線と収納を整える。料理そのものより『毎回迷わない』仕組み",
      schoolOrSports: "試合前の準備チェックリスト。選手の才能より、忘れ物をなくす仕組み",
      natureOrBody: "土を耕してから種をまく。苗だけ買っても育たない",
      workplace: "現場の標準作業書。誰がやっても同じ品質になるレール",
    },
    whyNow: "モデル単体より『回し方』が差になる。企業導入が運用勝負に入ったから",
    pitfall: "立派な設計図だけで満足しない。現場で回っているかが本題",
  },
  {
    key: "agent",
    label: "エージェント・代行",
    re: /agent|orchestr|tool.?use|autonomous|multi[- ]?agent|deep agent/i,
    metaphors: {
      dailyLife: "優秀な秘書が調べて、順番に手続きを進めてくれる感じ",
      schoolOrSports: "キャプテンが役割を配り、試合の流れを回す感じ",
      natureOrBody: "脳が手足に『取って』『置いて』と指示して、体全体で作業する感じ",
      workplace: "プロジェクトリーダーがタスクを配り、進捗を見て次を決める感じ",
    },
    whyNow: "AIが『答える』から『代わりに進める』へ移る転換点だから",
    pitfall: "エージェント＝万能ロボットと思わない。権限・失敗・コストをセットで見る",
  },
  {
    key: "infra",
    label: "推論・学習インフラ",
    re: /nemoclaw|nemotron|\bnvidia\b|inferen|fine[- ]?tun|hardware|\bgpu\b|tuning the harness/i,
    metaphors: {
      dailyLife: "キッチンのコンロを強い火力に替えた感じ。同じレシピでも仕上がりが変わる",
      schoolOrSports: "グラウンドと体育館の設備投資。練習メニューが広がる",
      natureOrBody: "心臓と肺のキャパが増える。同じ距離でも余裕が違う",
      workplace: "サーバと回線の増強。アプリは同じでも応答が速くなる",
    },
    whyNow: "モデルの中身だけでなく、回す土台（ハーネス/ハード）が成果を左右するから",
    pitfall: "『速いチップ＝賢い答え』と混同しない。中身の設計も見る",
  },
  {
    key: "safety",
    label: "安全・制御",
    re: /safe|align|jailbreak|security|risk|govern|sensitive|off[- ]?switch/i,
    metaphors: {
      dailyLife: "コンセントのブレーカー。危ないとき電気を落とす感じ",
      schoolOrSports: "試合のファウル規定。やりすぎを止めるルール",
      natureOrBody: "免疫。外敵を見分けて体を守る感じ",
      workplace: "承認フロー。勝手に送信・契約しない仕組み",
    },
    whyNow: "便利さが増えるほど、止め方・守り方も同時に必要になるから",
    pitfall: "安全＝全部禁止、にしない。使える範囲をはっきり書くことが本題",
  },
  {
    key: "rag",
    label: "検索・知識接続",
    re: /rag|retriev|embed|vector|search|knowledge/i,
    metaphors: {
      dailyLife: "図書館で本を探してから答える感じ。記憶だけでしゃべらない",
      schoolOrSports: "試合前に過去の対戦ノートを見返す感じ",
      natureOrBody: "嗅覚で匂いを辿って餌場を見つける感じ",
      workplace: "社内Wikiを開いてから顧客に答える感じ",
    },
    whyNow: "モデルの暗記より、正しい資料を引っ張る力が実務で効くから",
    pitfall: "検索できた＝正しい、ではない。出典の新しさと品質を見る",
  },
  {
    key: "eval",
    label: "評価・測定",
    re: /eval|benchmark|metric|checklist|score|measure/i,
    metaphors: {
      dailyLife: "体重計とタイマー。感覚じゃなく数字で確認する感じ",
      schoolOrSports: "タイム計測とフォームチェック。『なんとなく上手い』を分解する",
      natureOrBody: "体温計。熱があるか測らないとわからない",
      workplace: "KPIダッシュボード。頑張った気と結果を分ける",
    },
    whyNow: "AIの良し悪しは雰囲気では測れない。測れる形にしないと比較できないから",
    pitfall: "ベンチマーク一位＝現場で役立つ、と短絡しない",
  },
  {
    key: "body",
    label: "運動・睡眠・食事・回復",
    re: /workout|fitness|exercise|sleep|nutrition|protein|hypertrophy|recovery|hrv|筋トレ|睡眠|食事/i,
    metaphors: {
      dailyLife: "体という乗り物のメンテ。燃料・休息・走り込みのバランス",
      schoolOrSports: "試合に勝つための練習メニューと睡眠計画",
      natureOrBody: "筋肉と神経が適応する。刺激→回復→強くなる",
      workplace: "パフォーマンス管理。無理な残業より回復設計",
    },
    whyNow: "運動×心×AIのビジネスでは、身体プロトコルが信頼の土台になるから",
    pitfall: "個人差を無視した万能メニューにしない。根拠と体感を分けて書く",
  },
  {
    key: "mind",
    label: "心理・行動・習慣",
    re: /psycholog|behavioral econom|nudge|habit|motivat|cognitive bias|neuroscience|心理学|行動経済|習慣/i,
    metaphors: {
      dailyLife: "心の取扱説明書。同じ出来事でも感じ方が変わるつまみ",
      schoolOrSports: "試合前のメンタルセット。緊張を力に変えるルーチン",
      natureOrBody: "川の流れを少しだけ変える。習慣は水路の設計",
      workplace: "意思決定のバイアス対策。会議で『決め方』を設計する",
    },
    whyNow: "人の行動が変わらないと、AIも運動も続かないから",
    pitfall: "心理用語で賢く見せて終わらない。実験条件と限界を残す",
  },
  {
    key: "dining",
    label: "飲食・店舗・フードビジネス",
    re: /restaurant|foodservice|hospitality|ghost kitchen|qsr|飲食|外食|店舗|メニュー/i,
    metaphors: {
      dailyLife: "台所とホールが息を合わせる。料理だけ上手でも店は回らない",
      schoolOrSports: "文化祭の模擬店。仕込み・接客・会計が同時に動く",
      natureOrBody: "消化のように、仕入れ→調理→提供→片付けが循環する",
      workplace: "シフトと原価とお客様の満足を同時に見る現場マネジメント",
    },
    whyNow: "飲食は体験と数字が直結する。AI×心理×トレンドの掛け合わせが効く現場だから",
    pitfall: "流行メニュー自慢で終わらない。原価・人手・再現性をセットで見る",
  },
  {
    key: "biz",
    label: "経営・マーケ・集客・起業",
    re: /marketing|entrepreneur|solopreneur|pricing|funnel|acquisition|マーケ|起業|集客|個人事業|経営/i,
    metaphors: {
      dailyLife: "お店の看板と導線。来てもらう・選んでもらう・また来てもらう設計",
      schoolOrSports: "部活の勧誘と試合運営。入口・体験・継続が別メニュー",
      natureOrBody: "種を蒔き、水をやり、実を取る。刈り取りだけ急がない",
      workplace: "誰に・何を・いくらで・どう届けるかの事業設計図",
    },
    whyNow: "飲食以外も含め、事業は集客と価値提案が先に立たないと回らないから",
    pitfall: "テクニック集めだけで終わらない。誰のどんな課題かまで落とす",
  },
  {
    key: "reviews",
    label: "レビュー文献（SR / メタ / 叙述）",
    re: /systematic review|meta[- ]?analysis|scoping review|narrative review|literature review|umbrella review|システマティック|メタアナリシス|レビュー論文/i,
    metaphors: {
      dailyLife: "口コミを全部読んで『本当に効くのか』を表にする。1件の感想では決めない",
      schoolOrSports: "試合映像を何本も見て戦術の型を抽出する。1試合の勝敗だけで語らない",
      natureOrBody: "川の水位を何地点も測って『この雨でどれだけ増えるか』を推定する",
      workplace: "事例集ではなく、条件付きの結論書。限界と除外基準まで残す",
    },
    whyNow: "根拠の強さが違う情報を同じ棚に載せると、発信と実践がブレるから",
    pitfall: "『レビュー』と書いてあるだけで信じない。SR/メタか叙述かを必ず見る",
  },
  {
    key: "trends",
    label: "先読みトレンド・新商品",
    re: /trend|product hunt|gadget|wearable|startup|viral|新商品|トレンド/i,
    metaphors: {
      dailyLife: "天気予報の『あす傘』。まだ降ってないが備え始める合図",
      schoolOrSports: "新しい競技が部活に入ってくる前哨戦",
      natureOrBody: "風向きが変わる前の雲。早い人だけ気づく",
      workplace: "市場の予告編。在庫を持つ前に試作品を見る",
    },
    whyNow: "SNSでは『あとから皆が知る話』より『いま早い話』が価値になるから",
    pitfall: "噂と実在プロダクトを混ぜない。発売・検証状況を必ず残す",
  },
  {
    key: "oss",
    label: "公開・共有実装",
    re: /open.?source|github|release|launch|introduc|unveil|announc/i,
    metaphors: {
      dailyLife: "レシピ公開の台所。誰でも同じ料理を再現できる感じ",
      schoolOrSports: "練習メニューの共有ノート。みんなで改良する感じ",
      natureOrBody: "種を配る。植えた人の庭で育つ感じ",
      workplace: "設計図のオープン化。他チームも改造できる部品庫",
    },
    whyNow: "使える実装が公開されると、試せる人が一気に増えるから",
    pitfall: "発表＝すぐ本番投入、と決めない。自分の環境での検証が必要",
  },
];

function extractSummaryFromMd(raw: string): string {
  const m = raw.match(/##\s*要約\s*\n+([\s\S]*?)(?:\n##\s|\n---\s*$|$)/);
  if (m) return clip(m[1].replace(/```[\s\S]*?```/g, " ").replace(/\s+/g, " "), 420);
  const body = raw.replace(/^---[\s\S]*?---\s*/, "").replace(/\s+/g, " ");
  return clip(body, 280);
}

export async function loadEntryText(
  dataRoot: string,
  entry: CatalogEntry,
): Promise<string> {
  try {
    const raw = await readFile(path.join(dataRoot, entry.path), "utf8");
    return extractSummaryFromMd(raw);
  } catch {
    return "";
  }
}

function pickTheme(title: string, summary: string, category: string) {
  const blob = `${title}\n${summary}\n${category}`;
  let best: (typeof THEME_RULES)[number] | null = null;
  let bestScore = 0;
  for (const rule of THEME_RULES) {
    const titleHits = (title.match(rule.re) || []).length;
    const summaryHits = (summary.match(rule.re) || []).length;
    // タイトル一致を優先（要約の一般語で誤爆しにくい）
    const score = titleHits * 3 + summaryHits;
    if (score > bestScore) {
      bestScore = score;
      best = rule;
    }
  }
  if (best && bestScore > 0) return best;
  return {
    key: "generic",
    label: `${category} の話題`,
    re: /$a/,
    metaphors: {
      dailyLife: `『${clip(title, 28)}』という新しい話題の本が図書館に届いた感じ`,
      schoolOrSports: "ニュースで知った新しい技を、次の練習で試す感じ",
      natureOrBody: "風向きが少し変わった合図",
      workplace: "業界ニュースの一行が、来週の会議の前提を変える感じ",
    },
    whyNow: "今の流れを知っておくと、次の一手が選びやすいから",
    pitfall: "タイトルだけで『すごい/終わり』と決めつけない。リンク先と体験を分けて扱う",
  };
}

function extractHooks(title: string, summary: string): string[] {
  const blob = `${title} ${summary}`;
  const hooks: string[] = [];
  const pct = blob.match(/(\d+\s*%|\d+\s*percent)/i);
  if (pct) hooks.push(`数値フック: ${pct[1]}`);
  const named = blob.match(
    /\b(LangChain|LangSmith|NVIDIA|NemoClaw|Nemotron|Schneider|OpenAI|Anthropic|Deep Agents?)\b/gi,
  );
  if (named) {
    for (const n of [...new Set(named.map((x) => x.trim()))].slice(0, 4)) {
      hooks.push(`固有名: ${n}`);
    }
  }
  // タイトルの内容語
  const words = title
    .replace(/[^\w\u3040-\u30ff\u4e00-\u9fff\s-]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 4)
    .filter(
      (w) =>
        !/^(with|from|your|their|this|that|here|how|what|into|using|built|launch)$/i.test(
          w,
        ),
    );
  for (const w of words.slice(0, 5)) hooks.push(`語: ${w}`);
  return [...new Set(hooks)].slice(0, 8);
}

function buildSignals(
  entry: CatalogEntry,
  summary: string,
): TopicSignals {
  const theme = pickTheme(entry.title, summary, entry.category);
  const nouns = extractHooks(entry.title, summary)
    .filter((h) => h.startsWith("語:") || h.startsWith("固有名:"))
    .map((h) => h.replace(/^(語|固有名):\s*/, ""));
  return {
    title: entry.title,
    summary,
    nouns,
    verbs: [],
    themeKey: theme.key,
    themeLabelJa: theme.label,
    concreteHooks: extractHooks(entry.title, summary),
  };
}

function specializeMetaphors(
  base: MetaphorSet,
  signals: TopicSignals,
): MetaphorSet {
  const hook =
    signals.nouns[0] ||
    signals.concreteHooks.find((h) => h.startsWith("固有名:"))?.replace(/^固有名:\s*/, "") ||
    clip(signals.title, 24);
  const num = signals.concreteHooks.find((h) => h.startsWith("数値フック:"));
  const numBit = num ? `（${num.replace("数値フック: ", "")}の話も絡む）` : "";

  return {
    dailyLife: `${base.dailyLife} — 今回の主役は「${hook}」${numBit}`,
    schoolOrSports: `${base.schoolOrSports} — 「${clip(signals.title, 40)}」を部活の出来事に置き換えるとこう`,
    natureOrBody: base.natureOrBody,
    workplace: `${base.workplace} — 現場ワード: ${signals.themeLabelJa}`,
  };
}

function factorize(
  entry: CatalogEntry,
  signals: TopicSignals,
  theme: ReturnType<typeof pickTheme>,
): FactorLayers {
  const sc = structureCase(entry);
  const method = sc.roles.method ?? theme.label;
  const problem = sc.roles.problem ?? `${entry.category} の課題`;
  const summaryBit = signals.summary
    ? clip(signals.summary, 160)
    : "（要約なし。タイトルと分野から推定）";

  const who =
    signals.nouns.find((n) => /Lang|NVIDIA|Schneider|OpenAI|Anthropic|Nemo/i.test(n)) ||
    (entry.source === "arxiv" ? "研究者コミュニティ" : "この分野の実務者・開発者");

  const whatChanged = signals.summary
    ? clip(signals.summary, 120)
    : `「${clip(entry.title, 70)}」という動きが出ている`;

  const how = `${method}（テーマ: ${theme.label}）`;
  const soWhat = `受け手が伝えるべき核: 「${theme.label}」を、わからない人にも日常のたとえで橋渡しすること`;

  const oneLine = `${clip(entry.title, 70)} — 要するに「${theme.label}」の話`;

  return {
    oneLine,
    elementary: [
      `むずかしい機械の話だけど、やろうとしてることはシンプル。`,
      `「${problem}」を、「${how}」で何とかしようとしているよ。`,
      signals.summary ? `くわしく言うと: ${clip(signals.summary, 100)}` : "",
    ]
      .filter(Boolean)
      .join(""),
    juniorHigh: [
      `テーマ: ${clip(entry.title, 90)}`,
      `分野: ${entry.category}（出典: ${entry.source}）`,
      `分解A だれの話?: ${who}`,
      `分解B 何が変わった/主張?: ${whatChanged}`,
      `分解C どうやってる?: ${how}`,
      `分解D 構造式: ${problem} —[${method}]→ ${sc.roles.system ?? "成果・実装"}`,
      `分解E 原文: ${entry.url}`,
      `分解F 要約メモ: ${summaryBit}`,
    ].join("\n"),
    structure: `${problem} —[${method}]→ ${sc.roles.system ?? clip(entry.title, 40)}`,
    whyNow: theme.whyNow,
    pitfall: theme.pitfall,
    parts: { who, whatChanged, how, soWhat },
  };
}

function modalityHints(
  entry: CatalogEntry,
  metaphors: MetaphorSet,
  factors: FactorLayers,
  signals: TopicSignals,
): UnpackedIntel["modalityHints"] {
  const hook = signals.concreteHooks[0] ?? factors.parts.how;
  return {
    text: [
      `①核（${factors.parts.soWhat}）を3行`,
      `②日常比喩「${metaphors.dailyLife}」を1つ`,
      `③具体フック「${hook}」`,
      `④原文URL`,
    ].join(" / "),
    image: `一枚絵の主題: 「${metaphors.schoolOrSports}」。文字は核の一行「${clip(factors.oneLine, 42)}」だけ`,
    video: `30〜60秒台本: ①日常の困りごと（${factors.parts.who}視点）②比喩 ③何が変わったか（${clip(factors.parts.whatChanged, 60)}）④URL`,
    music: `ムード: ${
      signals.themeKey === "safety"
        ? "緊張→安心"
        : signals.themeKey === "cost"
          ? "焦り→整理"
          : signals.themeKey === "ops"
            ? "整う・定着"
            : "前向き・前進"
    }。歌詞モチーフは「${signals.themeLabelJa}」と比喩のキーワードだけ`,
  };
}

export function unpackEntry(
  entry: CatalogEntry,
  opts?: { summary?: string; analogy?: AnalogyMapping },
): UnpackedIntel {
  const summary = opts?.summary?.trim() || "";
  const signals = buildSignals(entry, summary);
  const theme = pickTheme(entry.title, summary, entry.category);
  const factors = factorize(entry, signals, theme);
  const metaphors = specializeMetaphors(theme.metaphors, signals);
  const coreMessage = [
    factors.oneLine,
    `たとえ: ${metaphors.dailyLife}`,
    `なぜ今: ${factors.whyNow}`,
    `だれ: ${factors.parts.who}`,
  ].join(" / ");

  return {
    id: `unp_${entry.id}`,
    source: entry,
    factors,
    metaphors,
    analogy: opts?.analogy,
    modalityHints: modalityHints(entry, metaphors, factors, signals),
    coreMessage,
    concreteHooks: signals.concreteHooks,
    guardrails: [
      "事実と意見を分ける",
      "原文リンクを必ず残す",
      "煽り・断定を避け、中学生にも通じる言葉を優先",
      "投稿・公開は別Mac側の承認フローに従う（こちらは分析パックのみ）",
      "X / Threads / note / Instagram / ブログ / 動画 / 音楽 への変換は受け手AIが行う",
    ],
  };
}

export async function unpackBatch(
  focus: CatalogEntry[],
  corpus: CatalogEntry[],
  opts?: { limit?: number; dataRoot?: string },
): Promise<UnpackedIntel[]> {
  const limit = opts?.limit ?? 8;
  const analogies = findAnalogies(focus, corpus, limit);
  const bySourceId = new Map(
    analogies.map((a) => [a.source.entry.id, a] as const),
  );
  const out: UnpackedIntel[] = [];
  for (const entry of focus.slice(0, limit)) {
    const summary = opts?.dataRoot
      ? await loadEntryText(opts.dataRoot, entry)
      : "";
    out.push(
      unpackEntry(entry, {
        summary,
        analogy: bySourceId.get(entry.id),
      }),
    );
  }
  out.sort((a, b) => Number(!!b.analogy) - Number(!!a.analogy));
  return out;
}
