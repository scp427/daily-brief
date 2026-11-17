import * as cheerio from "cheerio";

import { curlFetch, proxyConfigured } from "./curl-fetch";
import type { Category, RawArticle } from "./types";

/**
 * YouTube channel feed — https://www.youtube.com/feeds/videos.xml?channel_id=…
 *
 * Not routed through rss.ts: the video description and view count live inside
 * the `media:` namespace, and the summariser needs the description as source
 * material. The feed endpoint takes a channel id, so the configured url is the
 * full feed url and the id is whatever the operator pasted into it.
 *
 * youtube.com is unreachable from a mainland host, so these sources carry no
 * `domestic` flag and are fetched by the overseas snapshot runner.
 */

const HEADERS: Record<string, string> = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
  Accept: "application/atom+xml, application/xml, text/xml, */*",
};

/** 1.2M / 34.5K — international suffixes so zh and en reports share one format. */
function formatCount(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return "";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

export function parseYoutubeFeed(
  xml: string,
  sourceId: string,
  category: Category,
): RawArticle[] {
  const $ = cheerio.load(xml, { xmlMode: true });
  const items: RawArticle[] = [];

  $("entry").each((_, entry) => {
    const el = $(entry);
    const title = el.find("title").first().text().trim();
    const url =
      el.find('link[rel="alternate"]').attr("href")?.trim() ||
      el.find("link").first().attr("href")?.trim() ||
      "";
    if (!title || !url) return;

    const description =
      el.find("media\\:group media\\:description").first().text().trim() ||
      el.find("media\\:description").first().text().trim();
    const views = Number(el.find("media\\:statistics").attr("views"));
    const published = el.find("published").first().text().trim();

    items.push({
      sourceId,
      title,
      url,
      excerpt: description.slice(0, 300),
      publishedAt: published ? new Date(published) : undefined,
      meta: Number.isFinite(views) && views > 0 ? `▶ ${formatCount(views)}` : "",
      category,
    });
  });

  return items;
}

export async function fetchYoutube(
  sourceId: string,
  feedUrl: string,
  category: Category,
): Promise<RawArticle[]> {
  const xml = proxyConfigured()
    ? await curlFetch(feedUrl, HEADERS)
    : await fetch(feedUrl, {
        headers: HEADERS,
        signal: AbortSignal.timeout(20000),
      }).then((r) => {
        if (!r.ok) throw new Error(`youtube ${sourceId}: HTTP ${r.status}`);
        return r.text();
      });

  return parseYoutubeFeed(xml, sourceId, category);
}
