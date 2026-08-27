import { createHash } from "node:crypto";

/** 本文ハッシュ用の最小正規化（過剰加工しない） */
export function normalizeContentForHash(text: string): string {
  return text
    .normalize("NFKC")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/[ \t\f\v]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** SHA-256 hex。空本文は返さない（呼び出し側で本文ありを保証） */
export function contentHashSha256(text: string): string {
  const normalized = normalizeContentForHash(text);
  return createHash("sha256").update(normalized, "utf8").digest("hex");
}
