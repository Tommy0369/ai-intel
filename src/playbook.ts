import { writeFile } from "node:fs/promises";
import path from "node:path";
import { nowIso } from "./http.js";

export async function writePlaybook(dataRoot: string): Promise<string> {
  const body = `# AI Intel Playbook

生成日時: ${nowIso()}

## とみー

デスクトップ「とみーの今日」→ \`agent/TOMMY.md\`

## 自動フル

\`daily → finish → go → tommy → ship\`

## ship（iCloud）

理解パック（因数分解・アナロジー・メタファー）を:

\`AI共有OS/AI活動OS/intel-bridge/outbox/日付/\`
\`AI共有OS/AI活動OS/intel-bridge/LATEST/\`

へ置く。投稿文の完成品ではない。SNS Mac のAIが変換する材料。
`;

  const out = path.join(dataRoot, "PLAYBOOK.md");
  await writeFile(out, body, "utf8");
  return out;
}
