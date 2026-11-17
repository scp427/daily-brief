import type { Category, RawArticle } from "./types";

/**
 * Zhihu hot list — https://api.zhihu.com/topstory/hot-lists/total
 *
 * The www.zhihu.com web API rejects anonymous requests (401 AuthenticationError)
 * and the billboard page sits behind 403; api.zhihu.com answers the same list
 * without a cookie or an x-zse-96 signature, so that host is the one we use.
 *
 * Every entry links to `https://api.zhihu.com/questions/<id>`, which a browser
 * renders as JSON — the reader needs the web question page, so the id is
 * extracted and re-pointed at www.zhihu.com. Entries without a recognised id
 * are dropped rather than linked somewhere useless.
 */

const ENDPOINT = "https://api.zhihu.com/topstory/hot-lists/total?limit=50";

const HEADERS: Record<string, string> = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  Referer: "https://www.zhihu.com/hot",
  Accept: "application/json",
};

const QUESTION_ID_RE = /questions\/(\d{6,})$/;

interface HotItem {
  target?: {
    title?: unknown;
    url?: unknown;
    excerpt?: unknown;
    answer_count?: unknown;
  };
}

export function parseZhihuHot(
  payload: unknown,
  sourceId: string,
  category: Category,
): RawArticle[] {
  const list = (payload as { data?: unknown })?.data;
  if (!Array.isArray(list)) throw new Error(`zhihu ${sourceId}: missing data array`);

  const items: RawArticle[] = [];
  for (const raw of list as HotItem[]) {
    const target = raw?.target;
    const title = typeof target?.title === "string" ? target.title.trim() : "";
    const apiUrl = typeof target?.url === "string" ? target.url.trim() : "";
    const id = QUESTION_ID_RE.exec(apiUrl)?.[1];
    if (!title || id === undefined) continue;

    const answers = Number(target?.answer_count);
    const excerptText = typeof target?.excerpt === "string" ? target.excerpt.trim() : "";
    // Hot-list excerpts restate the question title before the actual body.
    const excerpt = excerptText.startsWith(title)
      ? excerptText.slice(title.length).trim()
      : excerptText;

    items.push({
      sourceId,
      title,
      url: `https://www.zhihu.com/question/${id}`,
      excerpt: excerpt.slice(0, 300),
      // No publishedAt: the hot list is ordered by heat, and `created` is when
      // the question was asked — months or years before it trended.
      meta: Number.isFinite(answers) && answers > 0 ? `${answers} 回答` : "",
      category,
    });
  }

  return items;
}

export async function fetchZhihu(sourceId: string, category: Category): Promise<RawArticle[]> {
  const res = await fetch(ENDPOINT, { headers: HEADERS, signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`zhihu ${sourceId}: HTTP ${res.status}`);
  return parseZhihuHot(await res.json(), sourceId, category);
}
