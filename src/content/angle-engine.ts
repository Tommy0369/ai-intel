import type { ContentAngle, IntelEvent } from "../v2-types.js";

export const ANGLE_TEMPLATES: Array<{ id: string; label: string; perspective: string }> = [
  { id: "breaking", label: "速報", perspective: "いま何が起きたか" },
  { id: "summary", label: "要約", perspective: "3行で要点" },
  { id: "beginner", label: "初心者向け", perspective: "前提から説明する" },
  { id: "expert", label: "専門家向け", perspective: "実装・論文レベルの差分" },
  { id: "practical", label: "実務活用", perspective: "今日の仕事に落とす" },
  { id: "business", label: "ビジネス活用", perspective: "売上・コスト・組織" },
  { id: "monetize", label: "収益化", perspective: "お金に変える経路" },
  { id: "future", label: "未来予測", perspective: "12ヶ月後" },
  { id: "pros", label: "メリット", perspective: "得すること" },
  { id: "cons", label: "デメリット", perspective: "失うもの・リスク" },
  { id: "howto", label: "How To", perspective: "手順" },
  { id: "checklist", label: "チェックリスト", perspective: "確認項目" },
  { id: "myth", label: "誤解", perspective: "よくある勘違い" },
  { id: "psych", label: "心理学視点", perspective: "行動・認知" },
  { id: "dining", label: "飲食店視点", perspective: "店舗オペレーション" },
  { id: "solo", label: "個人事業主視点", perspective: "ひとり会社" },
  { id: "agent", label: "AI活用視点", perspective: "エージェント化" },
  { id: "analogy", label: "アナロジー", perspective: "別領域の写像" },
];

export function anglesForEvent(ev: IntelEvent, max = 8): ContentAngle[] {
  const picked = ANGLE_TEMPLATES.slice(0, max);
  const head = ev.titleJa || ev.title;
  return picked.map((t) => ({
    id: `${ev.id}_${t.id}`,
    label: t.label,
    perspective: t.perspective,
    hook: `${t.label}: ${head}`,
  }));
}
