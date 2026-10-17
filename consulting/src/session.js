// 伴走（相談整理）のデータモデルと出力。画面から独立させてテストする。
// 方針: 未合意の担当・期限は「案」、空なら「未定」。決定済みとして書かない。

export const ITEM_KINDS = {
  fact: { label: "事実", hint: "観測したこと。出典・日時を添える" },
  interpretation: { label: "解釈", hint: "事実の意味づけ" },
  hypothesis: { label: "仮説", hint: "反証できる説明。確かめ方とセット" },
  condition: { label: "条件", hint: "守る制約・前提" },
  unknown: { label: "未確認", hint: "判断に必要だがまだ分からないこと" },
};

export const SUPPORT_MODES = {
  advice: "助言（教える・提案する）",
  codesign: "共同設計（一緒に考える）",
  inquiry: "問いによる整理（本人の気づき）",
  implement: "実装代行（許可された範囲で代わりに作る）",
};

export const STEPS = [
  { key: "start", label: "相談の開始", short: "開始" },
  { key: "sort", label: "問題の整理", short: "整理" },
  { key: "compare", label: "計画の比較", short: "比較" },
  { key: "plan", label: "行動計画", short: "行動" },
  { key: "review", label: "振り返り", short: "振返" },
  { key: "export", label: "出力", short: "出力" },
];

let seq = 0;
export function uid(prefix = "x") {
  seq += 1;
  return `${prefix}${Date.now().toString(36)}${seq.toString(36)}${Math.random().toString(36).slice(2, 5)}`;
}

export function newSession(title = "新しい相談") {
  const now = new Date().toISOString();
  return {
    id: uid("s"),
    title,
    isSample: false,
    createdAt: now,
    updatedAt: now,
    step: 0,
    intake: { client: "", decideToday: "", current: "", deadline: "", constraints: "", desired: "", mode: "codesign", decider: "" },
    items: [],
    issue: { target: "", deadline: "", metric: "", goal: "", constraint: "", decision: "" },
    options: [{ id: uid("o"), name: "現状維持", desc: "何も変えない場合", cost: "", burden: "", effect: "", risk: "", check: "", isStatusQuo: true }],
    recommend: { optionId: "", reason: "", revisit: "" },
    actions: [],
    nextStep: "",
    review: [],
    reviewNext: "",
    clarified: "",
  };
}

const blank = (s) => !s || !String(s).trim();

/** 担当の表示。空なら「未定」、未合意なら「〜（案）」。 */
export function ownerLabel(a) {
  if (blank(a.owner)) return "未定";
  return a.agreed ? a.owner.trim() : `${a.owner.trim()}（案）`;
}

/** 期限の表示。空なら「未定」、未合意なら「〜（案）」。 */
export function dueLabel(a) {
  if (blank(a.due)) return "未定";
  return a.agreed ? a.due.trim() : `${a.due.trim()}（案）`;
}

/** 課題の一文。空欄は［未定：項目］として残す。 */
export function issueSentence(issue) {
  const f = (v, name) => (blank(v) ? `［未定：${name}］` : v.trim());
  const goal = blank(issue.goal) ? "［目標は未定（まず測定）］" : issue.goal.trim();
  return `${f(issue.target, "対象")}が${f(issue.deadline, "期限")}までに${f(issue.metric, "指標")}を${goal}にするうえで、${f(issue.constraint, "制約")}の下、${f(issue.decision, "何を決めるか")}を決める。`;
}

export function recommendedOption(s) {
  return s.options.find((o) => o.id === s.recommend.optionId) || null;
}

/** 不足・未合意の一覧（ステップ番号つき）。 */
export function missingInfo(s) {
  const out = [];
  const add = (step, text) => out.push({ step, text });
  if (blank(s.intake.decideToday)) add(0, "今日決めたいことが未入力");
  if (blank(s.intake.current)) add(0, "現状が未入力");
  if (blank(s.intake.deadline)) add(0, "期限が未定");
  const kinds = (k) => s.items.filter((i) => i.kind === k);
  if (!kinds("fact").length) add(1, "事実が1件もない");
  if (kinds("fact").some((i) => blank(i.source))) add(1, "出典・日時のない事実がある");
  if (!kinds("hypothesis").length) add(1, "仮説がない");
  if (kinds("hypothesis").length === 1) add(1, "代替仮説がない（原因を一つに決めつけていないか）");
  for (const k of ["target", "metric", "decision"]) {
    if (blank(s.issue[k])) add(1, `課題の一文：${{ target: "対象", metric: "指標", decision: "何を決めるか" }[k]}が未定`);
  }
  const real = s.options.filter((o) => !o.isStatusQuo);
  if (!real.length) add(2, "比較する実行案がない（現状維持と比べる）");
  if (!s.recommend.optionId) add(2, "推奨案が未選択");
  else if (blank(s.recommend.revisit)) add(2, "推奨案の見直し・撤退条件が未記入");
  if (!s.actions.length) add(3, "行動がない");
  for (const a of s.actions) {
    const name = blank(a.what) ? "（無題の行動）" : a.what.trim();
    if (blank(a.owner)) add(3, `「${name}」の担当が未定`);
    if (blank(a.due)) add(3, `「${name}」の期限が未定`);
    if (blank(a.done)) add(3, `「${name}」の完了条件が未記入`);
    if (blank(a.measure)) add(3, `「${name}」の確かめ方が未記入`);
    if (!blank(a.owner) && !a.agreed) add(3, `「${name}」の担当・期限が未合意（案）`);
  }
  if (blank(s.nextStep)) add(3, "今日できる最小の一手が未記入");
  return out;
}

/** 今日できる最小の一手。未記入なら代わりの提案を返す（提案であることを明示）。 */
export function smallestStep(s) {
  if (!blank(s.nextStep)) return { text: s.nextStep.trim(), suggested: false };
  const open = s.actions.find((a) => a.status !== "done" && !blank(a.what));
  if (open) return { text: `「${open.what.trim()}」の最初の5分だけ着手する`, suggested: true };
  const unk = s.items.find((i) => i.kind === "unknown");
  if (unk) return { text: `未確認事項「${unk.text.trim()}」を誰に聞くか決める`, suggested: true };
  return { text: "今日の相談で分かった事実を1つ、出典つきで記録する", suggested: true };
}

const mdEsc = (s) => String(s ?? "").replace(/\|/g, "｜").replace(/\r?\n/g, " ").trim();
const or = (s, d = "未記入") => (blank(s) ? d : String(s).trim());

function header(s, title) {
  const lines = [`# ${title}：${or(s.title, "無題の相談")}`, ""];
  if (s.isSample) lines.push("> サンプル（架空の相談データ）。実在の顧客・実績・料金ではない。", "");
  lines.push(`- 作成：${s.createdAt.slice(0, 10)}　更新：${s.updatedAt.slice(0, 10)}`);
  lines.push(`- 支援の形：${SUPPORT_MODES[s.intake.mode] || "未定"}`);
  lines.push("");
  return lines;
}

function itemsBlock(s) {
  const lines = [];
  for (const [k, def] of Object.entries(ITEM_KINDS)) {
    const xs = s.items.filter((i) => i.kind === k);
    lines.push(`### ${def.label}`);
    if (!xs.length) lines.push("- （なし）");
    for (const i of xs) lines.push(`- ${mdEsc(i.text)}${blank(i.source) ? "" : `（出典：${mdEsc(i.source)}）`}`);
    lines.push("");
  }
  return lines;
}

function actionsTable(s) {
  const lines = ["| 行動 | 担当 | 期限 | 完了条件 | 確かめ方 | 状態 |", "|---|---|---|---|---|---|"];
  if (!s.actions.length) lines.push("| （未設定） | 未定 | 未定 | 未記入 | 未記入 | — |");
  const st = { todo: "未着手", doing: "進行中", done: "完了" };
  for (const a of s.actions) {
    lines.push(`| ${mdEsc(or(a.what))} | ${ownerLabel(a)} | ${dueLabel(a)} | ${mdEsc(or(a.done))} | ${mdEsc(or(a.measure))} | ${st[a.status] || "未着手"} |`);
  }
  return lines;
}

function missingBlock(s) {
  const m = missingInfo(s);
  if (!m.length) return ["## 不足・未合意", "- なし", ""];
  return ["## 不足・未合意", ...m.map((x) => `- ${x.text}`), ""];
}

function stepLine(s) {
  const st = smallestStep(s);
  return [`## 今日できる最小の一手`, `- ${st.text}${st.suggested ? "（提案・未合意）" : ""}`, ""];
}

export function memoMarkdown(s) {
  return [
    ...header(s, "面談メモ"),
    "## 今日決めたいこと",
    or(s.intake.decideToday),
    "",
    "## 現状",
    or(s.intake.current),
    "",
    `- 期限：${or(s.intake.deadline, "未定")}`,
    `- 制約：${or(s.intake.constraints)}`,
    `- 望む成果：${or(s.intake.desired)}`,
    `- 意思決定者：${or(s.intake.decider, "未確認")}`,
    "",
    "## 整理（事実・解釈・仮説・条件・未確認）",
    "",
    ...itemsBlock(s),
    "## 課題の一文",
    issueSentence(s.issue),
    "",
    ...missingBlock(s),
    ...stepLine(s),
    "## 明確になったこと",
    or(s.clarified),
    "",
  ].join("\n");
}

export function proposalMarkdown(s) {
  const rec = recommendedOption(s);
  const lines = [...header(s, "提案の骨子"), "## 結論"];
  lines.push(rec ? `現時点では「${rec.name}」を勧める（推奨・顧客の判断待ち）。` : "推奨案は未決定。");
  lines.push("", "## 根拠と未確認点");
  for (const i of s.items.filter((x) => x.kind === "fact")) lines.push(`- 事実：${mdEsc(i.text)}${blank(i.source) ? "（出典未記入）" : `（${mdEsc(i.source)}）`}`);
  for (const i of s.items.filter((x) => x.kind === "hypothesis")) lines.push(`- 仮説：${mdEsc(i.text)}`);
  for (const i of s.items.filter((x) => x.kind === "unknown")) lines.push(`- 未確認：${mdEsc(i.text)}`);
  lines.push("", "## 選択肢の比較", "| 案 | 内容 | 費用 | 負担 | 期待効果 | リスク | 検証すること |", "|---|---|---|---|---|---|---|");
  for (const o of s.options) {
    lines.push(`| ${mdEsc(o.name)}${o.id === s.recommend.optionId ? "（推奨）" : ""} | ${mdEsc(or(o.desc, "—"))} | ${mdEsc(or(o.cost, "未見積"))} | ${mdEsc(or(o.burden, "—"))} | ${mdEsc(or(o.effect, "—"))} | ${mdEsc(or(o.risk, "—"))} | ${mdEsc(or(o.check, "—"))} |`);
  }
  lines.push("", "## 推奨理由と見直し条件", `- 理由：${or(s.recommend.reason)}`, `- 見直し・撤退条件：${or(s.recommend.revisit)}`, "", "## 課題の一文", issueSentence(s.issue), "");
  lines.push("## 担当・期限・確かめ方", ...actionsTable(s), "", ...stepLine(s));
  lines.push("> 期待効果は推定・目標であり、実測や保証ではない。法律・税務等の判断は専門家に確認する。", "");
  return lines.join("\n");
}

export function planMarkdown(s) {
  const lines = [...header(s, "行動計画"), "## 行動", ...actionsTable(s), "", ...stepLine(s)];
  if (s.review.length) {
    lines.push("## 振り返り", "| 指標 | 計画・仮説 | 導入前 | 導入後 | 判断 | メモ |", "|---|---|---|---|---|---|");
    for (const r of s.review) {
      lines.push(`| ${mdEsc(or(r.metric))} | ${mdEsc(or(r.plan, "—"))} | ${mdEsc(or(r.before, "未取得"))} | ${mdEsc(or(r.after, "未取得"))} | ${or(r.judge, "保留")} | ${mdEsc(or(r.note, "—"))} |`);
    }
    lines.push("", `- 次の一手：${or(s.reviewNext, "未定")}`, "", "> 前後の差は関連の段階。比較群と交絡の確認なしに原因・効果を断定しない。", "");
  }
  lines.push(...missingBlock(s));
  return lines.join("\n");
}

export function allMarkdown(s) {
  return [memoMarkdown(s), proposalMarkdown(s), planMarkdown(s)].join("\n---\n\n");
}

/** 外部AIに貼る前提の診断プロンプト（送信はしない）。 */
export function diagnosisPrompt(s) {
  const body = [
    `今日決めたいこと：${or(s.intake.decideToday)}`,
    `現状：${or(s.intake.current)}`,
    `期限：${or(s.intake.deadline, "未定")}`,
    `制約：${or(s.intake.constraints)}`,
    ...s.items.map((i) => `${ITEM_KINDS[i.kind]?.label || i.kind}：${i.text}`),
  ].join("\n");
  return `次の相談を、事実・解釈・仮説・条件・未知に分けてください。既知の事項は質問せず、判断が変わる質問を最大3つ。原因を断定せず代替仮説を示し、最小の検証を1つ提案してください。存在しない資料・引用・数値を作らないでください。\n入力：\n${body}`;
}

/** 架空のサンプル相談（examples.md の適用例1をもとにした説明用データ）。 */
export function sampleSession() {
  const s = newSession("見積書づくりにAIを使うか迷う個人事業主（サンプル）");
  s.isSample = true;
  s.step = 1;
  s.intake = {
    client: "架空：内装業の個人事業主Bさん",
    decideToday: "AIを使うかどうかではなく、最初に手をつける業務を1つ決めたい",
    current: "見積書作成が週4件ほど、1件45分前後。確認漏れで再送したことがある。営業に時間を戻したい",
    deadline: "来月末までに方針を決める",
    constraints: "既存の会計ソフトは継続。顧客情報は外部AIに入れない",
    desired: "見積作業の時間と確認漏れを減らし、営業の時間を週2時間確保",
    mode: "codesign",
    decider: "Bさん本人",
  };
  const it = (kind, text, source = "") => ({ id: uid("i"), kind, text, source });
  s.items = [
    it("fact", "見積書は週4件前後", "Bさんの申告（直近1か月の送付履歴で要確認）"),
    it("fact", "直近1件の作成時間は約45分", "面談中に前回の作業を再現して計測"),
    it("interpretation", "品目の転記と単価の確認に時間を取られているように見える"),
    it("hypothesis", "過去見積からの転記（二重入力）が所要時間の主因"),
    it("hypothesis", "単価表が最新でないため確認に時間がかかっている"),
    it("condition", "会計ソフトは変更しない／顧客名・住所はAIに入力しない"),
    it("unknown", "修正・再送の頻度（未測定。0%とはしない）"),
  ];
  s.issue = {
    target: "Bさんの見積書作成",
    deadline: "来月末",
    metric: "1件あたりの作成時間と再送件数",
    goal: "",
    constraint: "会計ソフト継続・顧客情報をAIに入れない条件",
    decision: "最初に試す改善策（書式整理かAI下書きか）",
  };
  s.options = [
    { id: uid("o"), name: "現状維持", desc: "何も変えない", cost: "0円", burden: "なし", effect: "変化なし", risk: "営業時間が増えない", check: "—", isStatusQuo: true },
    { id: uid("o"), name: "A 既存書式の整理", desc: "品目・単価表を1枚にまとめ、転記を減らす", cost: "支援2時間（料金は採算確認後）", burden: "小", effect: "推定：転記時間の削減", risk: "効果が小さい可能性", check: "AIなしでも時間が減るか", isStatusQuo: false },
    { id: uid("o"), name: "B 入力項目＋AI下書き", desc: "必要項目だけ入力し、AIが説明文の下書きを作る", cost: "ツール費＋設定支援（未見積）", burden: "中", effect: "推定：作成時間と漏れの減少", risk: "AIの誤記・情報の扱い", check: "時間と誤りが改善するか", isStatusQuo: false },
  ];
  s.recommend = {
    optionId: s.options[1].id,
    reason: "費用と負担が小さく、AIを使う前に転記の影響を切り分けられる",
    revisit: "2週間で1件あたりの時間が変わらなければBを検討。再送が増えたら中止",
  };
  s.actions = [
    { id: uid("a"), what: "直近4件の見積作成時間と再送の有無を記録する", owner: "Bさん", due: "来週金曜", done: "4件分の時間・再送が表に記入済み", measure: "記録表の件数", agreed: true, status: "doing" },
    { id: uid("a"), what: "品目・単価表のたたき台を作る", owner: "支援者", due: "再来週月曜", done: "Bさんが確認して修正点を出せる状態", measure: "Bさんの確認コメント", agreed: false, status: "todo" },
    { id: uid("a"), what: "2週間後に時間・再送を比較し、次の案を決める", owner: "", due: "", done: "継続・修正・中止のどれかを決める", measure: "記録表の前後比較（関連の段階）", agreed: false, status: "todo" },
  ];
  s.nextStep = "今日の見積1件だけ、開始と終了の時刻をメモする";
  s.review = [
    { id: uid("r"), metric: "見積1件あたりの作成時間（分）", plan: "書式整理で転記が減れば短くなる", before: "45", after: "", judge: "", note: "導入後は未取得（0分ではない）" },
  ];
  s.reviewNext = "";
  s.clarified = "最初に試すのはAIではなく書式の整理で、2週間の記録で次を決める。";
  return s;
}
