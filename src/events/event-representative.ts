import type { CatalogEntry } from "../types.js";
import { preferCanonicalUrl } from "./url.js";

const OFFICIAL_HINTS = [
  "openai.com",
  "anthropic.com",
  "google.com",
  "blog.",
  "docs.",
  "changelog",
  "github.com",
];

function articleScore(entry: CatalogEntry): number {
  let s = 0;
  const canon = entry.canonical_url || preferCanonicalUrl(entry);
  if (entry.canonical_url && entry.fetch_status === "success") s += 40;
  else if (entry.fetch_status === "success") s += 28;
  else if (entry.fetch_status === "partial") s += 12;
  if (canon && !/news\.google\.com/i.test(canon)) s += 10;
  const host = (entry.canonical_domain || "").toLowerCase();
  if (OFFICIAL_HINTS.some((h) => host.includes(h))) s += 18;
  s += Math.min(12, Math.floor((entry.title?.length ?? 0) / 40));
  const ts = Date.parse(entry.published_at || entry.collected_at || "");
  if (Number.isFinite(ts)) s += Math.max(0, 8 - Math.floor((Date.now() - ts) / 86_400_000));
  return s;
}

/** Event の代表記事を1件選ぶ（Step 02 簡易ルール） */
export function pickRepresentativeArticle(members: CatalogEntry[]): string {
  if (!members.length) return "";
  const sorted = [...members].sort((a, b) => articleScore(b) - articleScore(a));
  return sorted[0].id;
}
