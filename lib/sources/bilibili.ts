import type { Category, RawArticle } from "./types";

/**
 * Bilibili ranking — https://api.bilibili.com/x/web-interface/ranking/v2
 *
 * The ranking endpoint answers anonymous GET requests with a plain JSON body
 * (no wbi signature, no cookie) as long as a browser User-Agent and a
 * bilibili.com Referer are present. The configured url carries the region
 * (`rid`), so one fetcher serves the whole-site board (`rid=0`) and the
 * technology board (`rid=188`).
 */

const HEADERS: Record<string, string> = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  Referer: "https://www.bilibili.com/",
  Accept: "application/json",
};

function formatCount(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return "";
  if (n >= 100_000_000) return `${(n / 100_000_000).toFixed(1)}亿`;
  if (n >= 10_000) return `${(n / 10_000).toFixed(1)}万`;
  return String(n);
}

interface VideoShape {
  bvid?: unknown;
  title?: unknown;
  desc?: unknown;
  tname?: unknown;
  owner?: { name?: unknown };
  stat?: { view?: unknown };
}

function asString(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

export function parseBilibiliRanking(
  payload: unknown,
  sourceId: string,
  category: Category,
): RawArticle[] {
  const body = payload as { code?: unknown; message?: unknown; data?: { list?: unknown } };
  if (body?.code !== 0) {
    throw new Error(
      `bilibili ${sourceId}: code ${String(body?.code)} ${asString(body?.message)}`,
    );
  }
  const list = body?.data?.list;
  if (!Array.isArray(list)) throw new Error(`bilibili ${sourceId}: missing data.list`);

  const items: RawArticle[] = [];
  for (const raw of list as VideoShape[]) {
    const bvid = asString(raw?.bvid);
    const title = asString(raw?.title);
    if (!bvid || !title) continue;

    // The API returns an empty description for most videos; the channel and
    // category strip still gives the summariser something to anchor on.
    const metaParts: string[] = [];
    const tname = asString(raw?.tname);
    const owner = asString(raw?.owner?.name);
    const views = Number(raw?.stat?.view);
    if (tname) metaParts.push(tname);
    if (owner) metaParts.push(owner);
    if (views > 0) metaParts.push(`▶ ${formatCount(views)}`);

    items.push({
      sourceId,
      title,
      url: `https://www.bilibili.com/video/${bvid}`,
      excerpt: asString(raw?.desc).slice(0, 300),
      // No publishedAt: the board order is the ranking. Dating each item would
      // let the date sort in groupRaw reorder the board, and the upload time of
      // a long-running hit says nothing about whether this source is alive.
      meta: metaParts.join(" · "),
      category,
    });
  }

  return items;
}

export async function fetchBilibili(
  sourceId: string,
  url: string,
  category: Category,
): Promise<RawArticle[]> {
  const res = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`bilibili ${sourceId}: HTTP ${res.status}`);
  return parseBilibiliRanking(await res.json(), sourceId, category);
}
