import { fetchJson } from "../http.js";
import type { RawItem, SourcesConfig } from "../types.js";

interface GitHubSearchResponse {
  items?: Array<{
    full_name: string;
    html_url: string;
    description: string | null;
    stargazers_count?: number;
    language?: string | null;
    topics?: string[];
    updated_at?: string;
    created_at?: string;
  }>;
}

export async function collectGithub(
  sources: SourcesConfig,
  userAgent: string,
): Promise<RawItem[]> {
  if (!sources.github.enabled) return [];
  const out: RawItem[] = [];

  for (const query of sources.github.queries) {
    const url =
      `https://api.github.com/search/repositories?q=${encodeURIComponent(query)}` +
      `&sort=updated&order=desc&per_page=${sources.github.maxPerQuery}`;
    try {
      const data = await fetchJson<GitHubSearchResponse>(url, userAgent, {
        headers: {
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
        },
      });
      const items = data.items ?? [];
      for (const repo of items) {
        out.push({
          title: repo.full_name,
          url: repo.html_url,
          source: "github",
          summary: repo.description ?? undefined,
          publishedAt: repo.updated_at ?? repo.created_at,
          tags: [
            "github",
            ...(repo.topics ?? []).slice(0, 8),
            ...(repo.language ? [repo.language.toLowerCase()] : []),
          ],
          categoryHint: "opensource",
          lang: "en",
          extra: { stars: repo.stargazers_count },
        });
      }
      console.log(`  [github] ${query.slice(0, 40)}…: ${items.length}`);
    } catch (err) {
      console.warn(
        `  [github] query failed:`,
        err instanceof Error ? err.message : err,
      );
    }
  }

  return out;
}
