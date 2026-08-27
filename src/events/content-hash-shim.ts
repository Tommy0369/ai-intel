import { createHash } from "node:crypto";

/** 旧イベント層が使っていた短いハッシュ（本文無しのフォールバック） */
export function contentHash(text: string): string {
  return createHash("sha1").update(text).digest("hex").slice(0, 16);
}
