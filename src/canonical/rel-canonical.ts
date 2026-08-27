import { parseHTML } from "linkedom";

/**
 * <link rel="canonical"> を抽出。
 * ホームページやサイトトップだけのものは捨てる。
 */
export function extractRelCanonical(
  html: string,
  baseUrl: string,
): string | null {
  try {
    const { document } = parseHTML(html);
    const href =
      document
        .querySelector('link[rel="canonical"]')
        ?.getAttribute("href")
        ?.trim() ||
      document
        .querySelector('link[rel="Canonical"]')
        ?.getAttribute("href")
        ?.trim() ||
      "";
    if (!href) return null;
    const abs = new URL(href, baseUrl).href;
    if (!isPlausibleArticleCanonical(abs, baseUrl)) return null;
    return abs;
  } catch {
    return null;
  }
}

export function isPlausibleArticleCanonical(
  candidate: string,
  pageUrl: string,
): boolean {
  try {
    const c = new URL(candidate);
    const p = new URL(pageUrl);
    if (c.protocol !== "http:" && c.protocol !== "https:") return false;
    // トップページだけを指す canonical は不採用
    const path = c.pathname.replace(/\/+$/, "") || "/";
    if (path === "/" || path === "") return false;
    // 同一ホストでパスが極端に短い（セクション一覧）は弱い
    if (path.split("/").filter(Boolean).length < 1) return false;
    // 別ホストへの飛びは許可（CDN等）だが、クエリだけの差はOK
    void p;
    return true;
  } catch {
    return false;
  }
}
