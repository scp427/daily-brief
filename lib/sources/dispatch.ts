import { fetchAttentionVc } from "./attentionvc";
import { fetchBilibili } from "./bilibili";
import { fetchDouyin } from "./douyin";
import { fetchGithubTrending } from "./github-trending";
import { fetchHackerNews } from "./hackernews";
import { fetchHuggingfacePapers } from "./huggingface-papers";
import { fetchLinuxDo } from "./linuxdo";
import { fetchRss } from "./rss";
import { fetchV2ex } from "./v2ex";
import { fetchYoutube } from "./youtube";
import { fetchZhihu } from "./zhihu";
import type { RawArticle, SourceDef } from "./types";

/**
 * Single dispatcher used by daily.ts, dry-run.ts, and the cron route.
 * Add a new branch here when introducing a non-RSS fetcher. Families that
 * repeat per channel or board dispatch on an id prefix, so `youtube-<slug>`
 * and `bilibili-<slug>` need no code change per source.
 */
export async function fetchSource(source: SourceDef): Promise<RawArticle[]> {
  if (source.id === "hackernews") return fetchHackerNews(source.id);
  if (source.id === "github-trending") return fetchGithubTrending(source.id);
  if (source.id === "v2ex-hot") return fetchV2ex(source.id);
  if (source.id === "linuxdo") return fetchLinuxDo(source.id);
  if (source.id === "attentionvc-ai") return fetchAttentionVc(source.id);
  if (source.id === "huggingface-papers") return fetchHuggingfacePapers(source.id, source.keywords);
  if (source.id === "zhihu-hot") return fetchZhihu(source.id, source.category);
  if (source.id === "douyin-hot") return fetchDouyin(source.id, source.category);
  if (source.id.startsWith("bilibili-"))
    return fetchBilibili(source.id, source.url, source.category);
  if (source.id.startsWith("youtube-"))
    return fetchYoutube(source.id, source.url, source.category);
  return fetchRss(source.id, source.url, source.category, {
    useCurl: source.useCurl,
  });
}
