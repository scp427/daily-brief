import type { Category, RawArticle } from "./types";

/**
 * Douyin hot search — https://www.iesdouyin.com/web/api/v2/hotsearch/billboard/word/
 *
 * This is the endpoint the Douyin web board calls for its anonymous word list;
 * it answers without a signature, cookie, or msToken. Entries carry a search
 * phrase and a heat value only, so the reader link is built from the word
 * instead of being read out of the payload.
 */

const ENDPOINT = "https://www.iesdouyin.com/web/api/v2/hotsearch/billboard/word/";

const HEADERS: Record<string, string> = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  Referer: "https://www.douyin.com/",
  Accept: "application/json",
};

interface HotWord {
  word?: unknown;
  hot_value?: unknown;
}

function formatHeat(value: number): string {
  if (value >= 100_000_000) return `${(value / 100_000_000).toFixed(1)}亿`;
  return `${(value / 10_000).toFixed(1)}万`;
}

export function parseDouyinHot(
  payload: unknown,
  sourceId: string,
  category: Category,
): RawArticle[] {
  const root = payload as { status_code?: unknown; word_list?: unknown };
  if (root?.status_code !== 0 || !Array.isArray(root.word_list)) {
    throw new Error(
      `douyin ${sourceId}: unexpected payload (status_code=${String(root?.status_code)})`,
    );
  }

  const items: RawArticle[] = [];
  for (const raw of root.word_list as HotWord[]) {
    const word = typeof raw?.word === "string" ? raw.word.trim() : "";
    if (!word) continue;
    const heat = Number(raw?.hot_value);
    items.push({
      sourceId,
      title: word,
      url: `https://www.douyin.com/search/${encodeURIComponent(word)}`,
      // No publishedAt: the board is ordered by heat, and a search phrase has
      // no publish time of its own.
      meta: Number.isFinite(heat) && heat > 0 ? `${formatHeat(heat)} 热度` : "",
      category,
    });
  }

  return items;
}

export async function fetchDouyin(sourceId: string, category: Category): Promise<RawArticle[]> {
  const res = await fetch(ENDPOINT, { headers: HEADERS, signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`douyin ${sourceId}: HTTP ${res.status}`);
  return parseDouyinHot(await res.json(), sourceId, category);
}
