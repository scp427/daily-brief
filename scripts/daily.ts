import "./_env";

import fs from "node:fs";
import path from "node:path";

import { sources, REPORT_LOCALE } from "../lib/sources/registry";
import { channelOptionsFromEnv } from "../lib/sources/channel";
import { describeError, fetchWithStatus } from "../lib/sources/run";
import {
  generateDailyReport,
  type ArticleInput,
} from "../lib/ai/pipeline";
import { getModelTag, validateBackendCredentials } from "../lib/ai/llm";
import {
  enrichGithubTrendingSummaries,
  enrichIntroSummaries,
  enrichNewsSummaries,
  enrichTrendingPapersSummaries,
  enrichXViralSummaries,
} from "../lib/ai/enrich";
import { categories, dropsSports } from "../lib/categories";
import {
  PAGE_SIZE,
  PRESERVE_FETCH_ORDER_SOURCES,
  isSportsArticle,
  renderMarkdown,
} from "../lib/output/render";
import { writeHtml } from "../lib/output/store";
import { analyzeWatchlist } from "../lib/trading/runner";
import { fetchCryptoFearGreed } from "../lib/trading/fear-greed";
import { fetchCryptoGlobal } from "../lib/trading/coingecko";
import { generateTradingCommentary } from "../lib/ai/trading-commentary";
import type { TradingSection } from "../lib/ai/pipeline";
import { todayKey } from "../lib/utils";
import type { SourceDef } from "../lib/sources/types";
import {
  buildNotifySummary,
  createChannels,
  loadNotifyConfig,
  notifyReport,
} from "../lib/notify";

const OUTPUT_DIR = "daily_reports";

async function fetchAll(): Promise<ArticleInput[]> {
  const articles: ArticleInput[] = [];
  const enabled = sources.filter((s) => s.enabled !== false);
  const channel = channelOptionsFromEnv();
  for (const source of enabled) {
    try {
      const { items } = await fetchWithStatus(source, "daily", channel);
      console.log(`  ${source.id.padEnd(20)} ${items.length}`);
      articles.push(...items.map((it) => ({ ...it, source: source.name })));
    } catch (e) {
      console.error(`  ${source.id.padEnd(20)} FAILED — ${describeError(e)}`);
    }
  }
  return articles;
}

type PromptStyle = "gh" | "papers" | "xViral" | "news" | "intro";

/** Sources whose items get a dedicated prompt under `enrich: "auto"`. */
const DEDICATED_STYLE: Record<string, PromptStyle> = {
  "github-trending": "gh",
  "huggingface-papers": "papers",
  "attentionvc-ai": "xViral",
};

/** Items per LLM call; keeps a batch inside the provider's response budget. */
const ENRICH_BATCH = 20;

function mergedLimitOf(source: SourceDef): number | undefined {
  return categories
    .find((c) => c.id === source.category)
    ?.subcategories.find(
      (s) => s.id === source.subcategory && s.mergeLimit !== undefined,
    )?.mergeLimit;
}

/**
 * Resolve which prompt summarises a source: an explicit `enrich` wins, and
 * `auto` maps the dedicated feeds to their prompt plus merged subcategories
 * to the generic news prompt.
 */
function resolvePromptStyle(source: SourceDef): PromptStyle | undefined {
  const chosen = source.enrich ?? "auto";
  if (chosen === "off") return undefined;
  if (chosen === "news" || chosen === "intro") return chosen;
  return (
    DEDICATED_STYLE[source.id] ??
    (mergedLimitOf(source) !== undefined ? "news" : undefined)
  );
}

/**
 * Items in the order the renderer will show them: fetcher order for the
 * rank-preserving sources, newest first otherwise.
 */
function orderedItems(
  source: SourceDef,
  articles: ArticleInput[],
): ArticleInput[] {
  const own = articles.filter((a) => a.sourceId === source.id);
  if (PRESERVE_FETCH_ORDER_SOURCES.has(source.id)) return own;
  return [...own].sort(
    (a, b) => (b.publishedAt?.getTime() ?? 0) - (a.publishedAt?.getTime() ?? 0),
  );
}

function capOf(source: SourceDef, style: PromptStyle): number | undefined {
  if (source.maxItems !== undefined) return source.maxItems;
  if (style === "news") return mergedLimitOf(source);
  if (style === "papers" || style === "xViral") return PAGE_SIZE;
  return undefined;
}

function callStyle(
  style: PromptStyle,
  items: ArticleInput[],
): Promise<Map<string, string>> {
  switch (style) {
    case "gh":
      return enrichGithubTrendingSummaries(items);
    case "papers":
      return enrichTrendingPapersSummaries(items);
    case "xViral":
      return enrichXViralSummaries(
        items.map((a) => ({
          url: a.url,
          title: a.title,
          excerpt: a.excerpt,
          // Author handle is part of the URL — it tells the model whose claim it is.
          author: a.url.match(/x\.com\/([^/]+)\//)?.[1] ?? "",
        })),
      );
    case "news":
      return enrichNewsSummaries(items);
    case "intro":
      return enrichIntroSummaries(items);
  }
}

/**
 * Summarise the items each source will actually display. Merged
 * subcategories are summarised as the merged timeline (post-merge limit);
 * every other source is capped independently. Sources already in the target
 * language are skipped unless they use a dedicated prompt.
 */
async function enrichArticles(articles: ArticleInput[]): Promise<void> {
  const byId = new Map(sources.map((s) => [s.id, s]));
  const groups = new Map<PromptStyle, ArticleInput[]>();
  const add = (style: PromptStyle, items: ArticleInput[]): void => {
    if (items.length === 0) return;
    groups.set(style, [...(groups.get(style) ?? []), ...items]);
  };

  const mergedSourceIds = new Set<string>();
  for (const category of categories) {
    for (const sub of category.subcategories) {
      if (sub.mergeLimit === undefined) continue;
      const members = sources.filter(
        (s) =>
          s.enabled !== false &&
          s.category === category.id &&
          s.subcategory === sub.id,
      );
      if (members.length === 0) continue;
      const style = members
        .map(resolvePromptStyle)
        .find((st) => st === "news" || st === "intro");
      if (!style) continue;
      for (const s of members) mergedSourceIds.add(s.id);
      const merged = members
        .flatMap((s) => {
          const own = orderedItems(s, articles);
          return s.maxItems === undefined ? own : own.slice(0, s.maxItems);
        })
        .filter((a) => !dropsSports(category.id) || !isSportsArticle(a.title))
        .sort(
          (a, b) =>
            (b.publishedAt?.getTime() ?? 0) - (a.publishedAt?.getTime() ?? 0),
        )
        .slice(0, sub.mergeLimit)
        .filter(
          (a) => (byId.get(a.sourceId)?.lang ?? "en") !== REPORT_LOCALE,
        );
      add(style, merged);
    }
  }

  for (const source of sources) {
    if (source.enabled === false || mergedSourceIds.has(source.id)) continue;
    const style = resolvePromptStyle(source);
    if (!style) continue;
    if (
      (style === "news" || style === "intro") &&
      (source.lang ?? "en") === REPORT_LOCALE
    )
      continue;
    let items = orderedItems(source, articles);
    if (dropsSports(source.category)) {
      items = items.filter((a) => !isSportsArticle(a.title));
    }
    const cap = capOf(source, style);
    add(style, cap === undefined ? items : items.slice(0, cap));
  }

  for (const [style, items] of groups) {
    for (let i = 0; i < items.length; i += ENRICH_BATCH) {
      const chunk = items.slice(i, i + ENRICH_BATCH);
      console.log(
        `[daily] enriching ${chunk.length} ${style} items with ${REPORT_LOCALE} summaries…`,
      );
      const t0 = Date.now();
      const summaries = await callStyle(style, chunk);
      for (const a of chunk) {
        const summary = summaries.get(a.url);
        if (summary) a.summary = summary;
      }
      console.log(
        `[daily] ${style} enrichment done in ${((Date.now() - t0) / 1000).toFixed(1)}s, matched ${summaries.size}/${chunk.length}`,
      );
    }
  }
}

/**
 * Pull daily OHLCV from Yahoo for every ticker in the watchlist, compute
 * indicators + signals, then ask Sonnet for a market overview + a
 * picks-to-watch list. Returns null if no ticker came back.
 */
async function runTrading(): Promise<TradingSection | null> {
  console.log(`[daily] analyzing watchlist + crypto context (Yahoo / alt.me / CoinGecko)…`);
  const t0 = Date.now();
  const [tickers, cryptoFearGreed, cryptoGlobal] = await Promise.all([
    analyzeWatchlist(),
    fetchCryptoFearGreed(),
    fetchCryptoGlobal(),
  ]);
  console.log(
    `[daily] indicators ready in ${((Date.now() - t0) / 1000).toFixed(1)}s — ${tickers.length} tickers` +
      (cryptoFearGreed ? `, F&G ${cryptoFearGreed.value}` : ", F&G ✗") +
      (cryptoGlobal
        ? `, BTC dom ${cryptoGlobal.btcDominance.toFixed(1)}%`
        : ", CG ✗"),
  );
  if (tickers.length === 0) return null;
  console.log(`[daily] generating trading commentary with ${getModelTag()}…`);
  const t1 = Date.now();
  const commentary = await generateTradingCommentary({
    tickers,
    cryptoFearGreed: cryptoFearGreed ?? undefined,
    cryptoGlobal: cryptoGlobal ?? undefined,
  });
  console.log(
    `[daily] trading commentary ready in ${((Date.now() - t1) / 1000).toFixed(1)}s`,
  );
  return {
    ...commentary,
    tickers,
    crypto_fear_greed: cryptoFearGreed ?? undefined,
    crypto_global: cryptoGlobal ?? undefined,
    generated_at: new Date().toISOString(),
  };
}

async function main() {
  // Fail fast on misconfigured backend before we spend 30s fetching
  // 500+ articles only to discover the LLM has no credentials.
  validateBackendCredentials();
  // Notify config is validated here too: a typo in notify.config.json must
  // surface before the 5-8 minute run, not after the report is written.
  const notifyConfig = loadNotifyConfig();
  const notifyChannels = createChannels(notifyConfig);

  const date = todayKey();
  console.log(`[daily] ${date} — fetching sources…\n`);
  const articles = await fetchAll();
  console.log(`\n[daily] total articles: ${articles.length}`);
  if (articles.length === 0) {
    throw new Error("no articles fetched — aborting");
  }

  await enrichArticles(articles);

  // Trading signals: Yahoo fetch + indicators + commentary. Non-fatal —
  // if it errors, we still ship the news digest.
  let trading: TradingSection | null = null;
  try {
    trading = await runTrading();
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn(`[daily] trading section failed: ${msg}`);
  }

  console.log(`[daily] generating digest with ${getModelTag()}…`);
  const t0 = Date.now();
  const { report } = await generateDailyReport(articles);
  if (trading) report.trading = trading;
  console.log(`[daily] digest ready in ${((Date.now() - t0) / 1000).toFixed(1)}s`);

  const dateDir = path.join(OUTPUT_DIR, date);
  fs.mkdirSync(dateDir, { recursive: true });
  const base = path.join(dateDir, date);
  fs.writeFileSync(`${base}.json`, JSON.stringify(report, null, 2), "utf8");
  // Sidecar with all fetched articles + LLM-attached summary, so
  // scripts/render.ts can rebuild HTML/MD for UI iteration without
  // re-fetching or re-calling the LLM.
  fs.writeFileSync(
    `${base}-articles.json`,
    JSON.stringify({ date, articles }, null, 2),
    "utf8",
  );
  writeHtml(OUTPUT_DIR, date, report, articles, sources);
  if (process.env.OUTPUT_MARKDOWN === "true") {
    fs.writeFileSync(`${base}.md`, renderMarkdown(report, date), "utf8");
    console.log(`[daily] wrote ${base}.{json,html,md,articles.json}`);
  } else {
    console.log(`[daily] wrote ${base}.{json,html,articles.json}`);
  }

  // Delivery is a side effect of a finished report: a broken SMTP server must
  // not turn a successful run into a failed one.
  try {
    await notifyReport(buildNotifySummary(date, report, notifyConfig), notifyConfig, notifyChannels);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn(`[daily] notify failed: ${msg}`);
  }

  console.log(`[daily] done.`);
}

main().catch((e) => {
  console.error(`[daily] FAILED:`, e);
  process.exit(1);
});
