/**
 * Map operator-typed selections onto fetched articles.
 *
 * Selections arrive as URLs (copied from the day's report) or as title
 * substrings (typed by hand). A substring that hits more than one article is
 * rejected with the candidate list: this step carries a human's editorial
 * intent, so guessing which article was meant is worse than stopping.
 */

export interface PickCandidate {
  title: string;
  url: string;
}

export interface PickResult<T extends PickCandidate> {
  picked: T[];
  problems: string[];
}

export function resolvePicks<T extends PickCandidate>(
  pool: T[],
  queries: string[],
): PickResult<T> {
  const picked: T[] = [];
  const problems: string[] = [];
  const seen = new Set<string>();

  for (const raw of queries) {
    const query = raw.trim();
    if (!query) continue;

    if (/^https?:\/\//i.test(query)) {
      const hit = pool.find((a) => a.url === query);
      if (!hit) {
        problems.push(`没有匹配的条目：${query}（URL 与当日抓取结果不精确一致）`);
        continue;
      }
      if (seen.has(hit.url)) continue;
      seen.add(hit.url);
      picked.push(hit);
      continue;
    }

    const needle = query.toLowerCase();
    const matches = pool.filter((a) =>
      a.title.toLowerCase().includes(needle),
    );
    if (matches.length === 0) {
      problems.push(`没有匹配的条目：${query}（标题子串无命中）`);
      continue;
    }
    if (matches.length > 1) {
      const list = matches
        .map((m) => `  · ${m.title} — ${m.url}`)
        .join("\n");
      problems.push(
        `「${query}」命中 ${matches.length} 条，请改用 URL 精确指定：\n${list}`,
      );
      continue;
    }
    const hit = matches[0];
    if (seen.has(hit.url)) continue;
    seen.add(hit.url);
    picked.push(hit);
  }

  return { picked, problems };
}
