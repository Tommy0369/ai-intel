import path from "node:path";
import type { ContentCard, ContentIdea, PlatformPack } from "../v2-types.js";
import { writeJson } from "../store-jsonl.js";

export function transformPlatform(
  idea: ContentIdea,
  card: ContentCard,
): PlatformPack {
  const hook = card.hook;
  const fact = card.fact;
  return {
    ideaId: idea.id,
    cardId: card.id,
    xShort: `${hook}\n\n${fact.slice(0, 180)}`,
    xLong: `${hook}\n\n事実: ${fact}\n洞察: ${card.insight}\n行動: ${card.action ?? ""}`,
    threads: `${hook}\n\n${card.insight}\n\n${card.action ?? ""}`,
    facebook: `${hook}\n\n${card.fact}\n\n${card.conclusion ?? ""}`,
    instagramCaption: `${hook}\n.\n${card.insight}\n.\n#AI #学び`,
    instagramCarousel: [hook, card.fact, card.insight, card.action ?? "次の一歩"],
    tiktokScript: `フック:${hook}\n本編:${fact}\nオチ:${card.cta ?? ""}`,
    shortsScript: `0-3秒 ${hook}\n3-20秒 ${fact}\n締め ${card.cta ?? ""}`,
    youtubeOutline: `企画: ${idea.title}\n1. 何が起きたか\n2. なぜ重要か\n3. どう使うか`,
    noteArticle: `# ${idea.title}\n\n${card.fact}\n\n## 洞察\n${card.insight}\n\n## 今日やること\n${card.action ?? ""}`,
    blogOutline: `導入 / 事実 / 解釈 / 転用 / CTA`,
    newsletter: `件名: ${hook}\n本文: ${card.insight}`,
    seminarOutline: `スライド: 事実→誤解→実務→演習`,
  };
}

export async function runPlatformTransform(
  dataRoot: string,
  ideas: ContentIdea[],
  cards: ContentCard[],
): Promise<PlatformPack[]> {
  const byIdea = new Map(cards.map((c) => [c.ideaId, c]));
  const packs = ideas
    .slice(0, 20)
    .map((i) => {
      const c = byIdea.get(i.id);
      return c ? transformPlatform(i, c) : null;
    })
    .filter((x): x is PlatformPack => x != null);
  const dir = path.join(dataRoot, "ready", "content");
  await writeJson(path.join(dir, "platform-packs.json"), {
    updatedAt: new Date().toISOString(),
    packs,
  });
  const lines = packs.map(
    (p) =>
      `## ${p.ideaId}\n\n### X\n${p.xShort}\n\n### note\n${p.noteArticle}\n`,
  );
  const { mkdir, writeFile } = await import("node:fs/promises");
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, "TODAY.md"), lines.join("\n---\n"), "utf8");
  return packs;
}
