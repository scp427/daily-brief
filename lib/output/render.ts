import type {
  ArticleInput,
  BriefItem,
  DailyReport,
  TradingSection,
} from "../ai/pipeline";
import type { WatchlistPick } from "../ai/trading-commentary";
import {
  buildPanels,
  categoryIds,
  categoryLabel,
  displayLimitFor,
  dropsSports,
  mergedLimitFor,
  subcategoryLabel,
  subLimitFor,
  summaryStyleOf,
  SUBCATEGORY_ORDER,
  type Panel,
} from "../categories";
import { REPORT_LOCALE, sources } from "../sources/registry";
import { getReportTz } from "../utils";
import { REPORT_CSS, THEME_BOOTSTRAP_SCRIPT } from "./styles";
import { CLIENT_SCRIPT } from "./client";
import type { Category, SourceDef } from "../sources/types";
import { V2EX_OFF_TOPIC_RE } from "../sources/v2ex";
import { pairingViolation } from "./pairing";
import type { TickerAnalysis } from "../trading/signals";
import {
  getAssetGroupLabels,
  ASSET_GROUP_ORDER,
  type AssetGroup,
} from "../trading/watchlist";

// ----- i18n -----

/**
 * Localized UI strings. `t` resolves to TEXTS_ZH or TEXTS_EN at module
 * init based on REPORT_LOCALE. All hardcoded display text routes through
 * this object so adding a third locale = adding one more table.
 */
const TEXTS_ZH = {
  siteTitle: "每日简报",
  emptySource: "该源今日无内容。",
  emptyCategory: "该分类今日无内容。",
  emptyGroup: "该组今日无数据。",
  allSubTab: "全部",
  moreHint: "下滑加载更多（还有 {n} 页）",
  moreLoading: "加载中…",
  moreError: "加载失败，点击重试",
  footer: "内容均来自原媒体，本站仅作摘要整理与回链。",
  summaryLabelNews: "中文摘要",
  summaryLabelIntro: "中文介绍",
  tradingMarketOverview: "市场总览",
  tradingTodayFocus: "今日关注",
  tradingAllAssets: "全部资产",
  tradingRiskCaveat: "风险提示",
  widgetCryptoFearGreed: "加密恐慌贪婪",
  widgetCryptoCap: "加密总市值",
  widgetBtcDom: "BTC 主导率",
  widgetVolume24h: "24h 成交量",
  widgetActiveCoins: "活跃币",
  ticker5d: "5 日",
  tickerVs52wHigh: "距 52w 高",
  tickerTrend: "趋势",
  tickerMacd: "MACD / 信号",
  signalToday: "今天",
  signalDaysAgoSuffix: "天前",
  trendBullish: "多头",
  trendBearish: "空头",
  trendNeutral: "中性",
  mdTodayOverview: "今日总览",
  mdEditorNote: "编辑短评",
  mdTodayKeywords: "今日关键词",
  mdImportance: "重要度",
  archiveLink: "历史归档",
  themeLabel: "外观",
  themeLight: "亮色",
  themeDark: "暗色",
  themePaper: "纸张",
  densityLabel: "密度",
  densityComfortable: "舒适",
  densityCompact: "紧凑",
  statArticles: "今日收录",
  statSources: "数据源",
  statGenerated: "生成于",
  heroEyebrow: "今日速览",
  topPicks: "重点速递",
  backToTop: "回到顶部",
  ariaTablist: "内容板块",
};

const TEXTS_EN: typeof TEXTS_ZH = {
  siteTitle: "Daily Brief",
  emptySource: "No content from this source today.",
  emptyCategory: "No content in this category today.",
  emptyGroup: "No data for this group today.",
  allSubTab: "All",
  moreHint: "Scroll for more ({n} pages left)",
  moreLoading: "Loading…",
  moreError: "Load failed — tap to retry",
  footer:
    "Content sourced from original publishers; this site provides summary and backlinks only.",
  summaryLabelNews: "Summary",
  summaryLabelIntro: "Summary",
  tradingMarketOverview: "Market Overview",
  tradingTodayFocus: "Today's Focus",
  tradingAllAssets: "All Assets",
  tradingRiskCaveat: "Risk Disclaimer",
  widgetCryptoFearGreed: "Crypto Fear/Greed",
  widgetCryptoCap: "Crypto Market Cap",
  widgetBtcDom: "BTC Dominance",
  widgetVolume24h: "24h Volume",
  widgetActiveCoins: "Active coins",
  ticker5d: "5d",
  tickerVs52wHigh: "vs 52w High",
  tickerTrend: "Trend",
  tickerMacd: "MACD / Signal",
  signalToday: "today",
  signalDaysAgoSuffix: "d ago",
  trendBullish: "Bullish",
  trendBearish: "Bearish",
  trendNeutral: "Neutral",
  mdTodayOverview: "Today's Overview",
  mdEditorNote: "Editor's Note",
  mdTodayKeywords: "Keywords",
  mdImportance: "Importance",
  archiveLink: "Archive",
  themeLabel: "Theme",
  themeLight: "Light",
  themeDark: "Dark",
  themePaper: "Paper",
  densityLabel: "Density",
  densityComfortable: "Roomy",
  densityCompact: "Compact",
  statArticles: "Stories",
  statSources: "Sources",
  statGenerated: "Generated",
  heroEyebrow: "Today at a glance",
  topPicks: "Top stories",
  backToTop: "Back to top",
  ariaTablist: "Sections",
};

const STR = REPORT_LOCALE === "en" ? TEXTS_EN : TEXTS_ZH;
const ASSET_GROUP_LABELS_LOCALIZED = getAssetGroupLabels(REPORT_LOCALE);

// ----- types -----

export type SourceGroup = {
  sourceId: string;
  sourceName: string;
  items: ArticleInput[];
};

export type SubGroup = {
  id: string;
  name: string;
  sources: SourceGroup[];
};

export type RawByCategory = Record<string, SubGroup[]>;

// ----- labels & ordering -----

/**
 * Sources whose fetcher returns items already sorted by an engagement/heat
 * algorithm we want to preserve. groupRaw skips its default date-desc sort
 * for these so the final render reflects the source's own ranking.
 */
const PRESERVE_FETCH_ORDER_SOURCES = new Set([
  "attentionvc-ai",
  "huggingface-papers",
]);


/**
 * Politics sources (especially Al Jazeera / BBC / The Diplomat) regularly
 * mix in World Cup / Olympic / football coverage. Filter at the title level
 * so the merged "国际要闻" stream stays politics-only.
 *
 * Pattern is intentionally specific — avoid generic words like "team" or
 * "match" that overlap with diplomacy headlines.
 */
const POLITICS_SPORTS_RE =
  /\b(World\s*Cup|Olympics?|UEFA|FIFA|NBA|NFL|NHL|MLB|ATP|WTA|Premier\s*League|Bundesliga|La\s*Liga|Serie\s*A|Champions\s*League|Eurovision|Wimbledon|Grand\s*Slam|F1|Formula\s*1|Ronaldo|Messi|Mbappe|Beckham|Lukaku|Mitoma|sportsman|footballer|squad)\b|世界杯|奥运|残奥|冬奥|欧冠|英超|西甲|意甲|德甲|网球|足球|篮球|高尔夫|棒球|板球|橄榄球/i;

export function isSportsArticle(title: string): boolean {
  return POLITICS_SPORTS_RE.test(title);
}

// ----- grouping -----

export function groupRaw(
  articles: ArticleInput[],
  registry: SourceDef[],
): RawByCategory {
  // Buckets are the categories declared in categories.config.json; each
  // source's articles land in the bucket its *current* config entry names.
  const subcatOf = new Map<string, string | undefined>();
  const catOf = new Map<string, string>();
  for (const s of registry) {
    subcatOf.set(s.id, s.subcategory);
    catOf.set(s.id, s.category);
  }
  // Drop articles from sources that have since been disabled — important
  // when scripts/render.ts re-renders against a stale sidecar that still
  // contains the disabled sources' fetched data.
  const enabledIds = new Set(
    registry.filter((s) => s.enabled !== false).map((s) => s.id),
  );

  type Bucket = { sourceName: string; items: ArticleInput[] };
  const buckets: Record<string, Map<string, Bucket>> = {};
  for (const id of categoryIds) buckets[id] = new Map();
  // Pre-seed empty buckets for every enabled source so an L3 tab survives a
  // day that source returned nothing (a transient LinuxDo Cloudflare block
  // would otherwise drop the tab as if the forum no longer existed). A
  // subcategory whose sources are all empty still disappears, because panels
  // drop empty subgroups when they are built.
  for (const s of registry) {
    if (s.enabled === false) continue;
    if (!buckets[s.category]) continue;
    if (!buckets[s.category].has(s.id)) {
      buckets[s.category].set(s.id, { sourceName: s.name, items: [] });
    }
  }

  // Bucket by the source's current category: a sidecar written before the
  // source was retagged would otherwise drop its articles into the category
  // the source has left. Only articles of removed sources fall back to the
  // category recorded at fetch time.
  const unmappedCategories = new Set<string>();

  for (const a of articles) {
    if (!enabledIds.has(a.sourceId)) continue;
    const cat = catOf.get(a.sourceId) ?? a.category;
    const bucket = buckets[cat];
    if (!bucket) {
      unmappedCategories.add(cat);
      continue;
    }
    if (dropsSports(cat) && isSportsArticle(a.title)) continue;
    if (
      (a.sourceId === "v2ex-hot" || a.sourceId === "linuxdo") &&
      V2EX_OFF_TOPIC_RE.test(a.title)
    )
      continue;
    let b = bucket.get(a.sourceId);
    if (!b) {
      b = { sourceName: a.source, items: [] };
      bucket.set(a.sourceId, b);
    }
    b.items.push(a);
  }

  if (unmappedCategories.size > 0) {
    console.warn(
      `[render] ignored articles in undeclared categories: ${[...unmappedCategories].join(", ")}`,
    );
  }

  for (const cat of Object.keys(buckets)) {
    for (const [id, b] of buckets[cat].entries()) {
      if (PRESERVE_FETCH_ORDER_SOURCES.has(id)) continue;
      b.items.sort(
        (a, b) =>
          (b.publishedAt?.getTime() ?? 0) - (a.publishedAt?.getTime() ?? 0),
      );
    }
  }

  function toSourceGroup(
    sourceId: string,
    b: Bucket,
    limit: number | undefined,
  ): SourceGroup {
    return {
      sourceId,
      sourceName: b.sourceName,
      items: limit ? b.items.slice(0, limit) : b.items,
    };
  }

  function sortByRegistry(list: SourceGroup[]): SourceGroup[] {
    return [...list].sort((a, b) => {
      const ia = registry.findIndex((s) => s.id === a.sourceId);
      const ib = registry.findIndex((s) => s.id === b.sourceId);
      return ia - ib;
    });
  }

  const out: RawByCategory = {};
  for (const cat of Object.keys(buckets)) out[cat] = [];

  for (const cat of Object.keys(buckets)) {
    const order = SUBCATEGORY_ORDER[cat];
    if (!order) {
      // Flat: one synthetic subgroup with every source.
      const sources: SourceGroup[] = [];
      for (const [id, b] of buckets[cat].entries()) {
        sources.push(toSourceGroup(id, b, undefined));
      }
      out[cat] = sources.length
        ? [{ id: "all", name: categoryLabel(cat), sources: sortByRegistry(sources) }]
        : [];
      continue;
    }
    // Subcategory split: bucket each source under its registered subcategory.
    // A source whose subcategory is missing or undeclared would otherwise be
    // dropped without a trace, so the config error surfaces here instead.
    for (const id of buckets[cat].keys()) {
      const violation = pairingViolation(cat, id, subcatOf.get(id), order);
      if (violation !== undefined) throw new Error(violation);
    }
    const subs: SubGroup[] = [];
    for (const subId of order) {
      const mergeLimit = mergedLimitFor(cat, subId);
      if (mergeLimit !== undefined) {
        // Merge: flatten all sources under this subcategory into a single
        // time-sorted SourceGroup. Articles keep their `source` field so
        // the renderer can label them.
        const flat: ArticleInput[] = [];
        for (const [id, b] of buckets[cat].entries()) {
          if (subcatOf.get(id) === subId) flat.push(...b.items);
        }
        if (flat.length === 0) continue;
        flat.sort(
          (a, b) =>
            (b.publishedAt?.getTime() ?? 0) - (a.publishedAt?.getTime() ?? 0),
        );
        subs.push({
          id: subId,
          name: subcategoryLabel(subId),
          sources: [
            {
              sourceId: "_merged",
              sourceName: subcategoryLabel(subId),
              items: flat.slice(0, mergeLimit),
            },
          ],
        });
        continue;
      }

      const limit = displayLimitFor(cat, subId);
      // Each source takes its own cap first, then all sources of this
      // subcategory share one budget so the sub-tab never exceeds subLimitFor().
      let budget = subLimitFor(cat, subId);
      const sources: SourceGroup[] = [];
      for (const [id, b] of buckets[cat].entries()) {
        if (subcatOf.get(id) !== subId) continue;
        const group = toSourceGroup(id, b, limit);
        if (group.items.length > budget) group.items = group.items.slice(0, budget);
        budget -= group.items.length;
        sources.push(group);
      }
      if (sources.length === 0) continue;
      subs.push({
        id: subId,
        name: subcategoryLabel(subId),
        sources: sortByRegistry(sources),
      });
    }
    out[cat] = subs;
  }

  return out;
}

// ----- HTML helpers -----

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatDate(d: Date | undefined): string {
  if (!d) return "";
  try {
    // zh: "05/20 16:00"  · en: "May 20, 4:00 PM" → keep 24h en-GB style "20/05 16:00"
    const localeTag = REPORT_LOCALE === "en" ? "en-GB" : "zh-CN";
    return d.toLocaleString(localeTag, {
      timeZone: getReportTz(),
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
  } catch {
    return "";
  }
}

// ----- raw article renderers -----

/**
 * Every article carries its own subcategory and source, so a merged "全部"
 * list stays readable: the tags are the only record of which L2 tab an item
 * came from once the lists are flattened together.
 */
function renderArticleHtml(a: ArticleInput, subId?: string): string {
  const title = escapeHtml(a.title);
  const url = escapeHtml(a.url);
  const excerpt = a.excerpt ? escapeHtml(a.excerpt) : "";
  // Backwards-compat: old sidecar JSON files may carry `cnSummary` instead.
  const summaryText = a.summary ?? (a as unknown as { cnSummary?: string }).cnSummary;
  const summary = summaryText ? escapeHtml(summaryText) : "";
  const meta = a.meta ? escapeHtml(a.meta) : "";
  const time = formatDate(a.publishedAt);
  const categoryTag = subId
    ? `<span class="tag tag-cat">${escapeHtml(subcategoryLabel(subId))}</span>`
    : "";
  const sourceTag = a.source
    ? `<span class="tag tag-src">${escapeHtml(a.source)}</span>`
    : "";
  const tagLine = [
    categoryTag,
    sourceTag,
    time ? `<span class="article-time">${time}</span>` : "",
  ]
    .filter(Boolean)
    .join("");
  // News-style summary label for finance/politics, project-intro style for GH/tech.
  const summaryLabel =
    summaryStyleOf(a.category) === "news"
      ? STR.summaryLabelNews
      : STR.summaryLabelIntro;
  return `<article class="article">
  <h3 class="article-title"><a href="${url}" target="_blank" rel="noopener noreferrer">${title}</a></h3>
  ${tagLine ? `<p class="article-tags">${tagLine}</p>` : ""}
  ${meta ? `<p class="article-stats">${meta}</p>` : ""}
  ${excerpt ? `<p class="article-excerpt">${excerpt}</p>` : ""}
  ${summary ? `<p class="article-summary"><span class="summary-label">${summaryLabel}</span> ${summary}</p>` : ""}
</article>`;
}

/** Articles rendered inline per list; the rest load on scroll. */
export const PAGE_SIZE = 20;

function splitPages<T>(items: T[], size = PAGE_SIZE): T[][] {
  const pages: T[][] = [];
  for (let i = 0; i < items.length; i += size) pages.push(items.slice(i, i + size));
  return pages;
}

/** Identifies the list a fragment belongs to; panels reuse a category's subgroups. */
interface ListCtx {
  panel: string;
  cat: string;
  date: string;
}

/** Relative path of a list's overflow fragment, published beside the report. */
export function overflowPath(
  date: string,
  panel: string,
  sub?: string,
  sourceId?: string,
): string {
  const parts = [panel, sub ?? "all"];
  if (sourceId) parts.push(sourceId);
  return `${date}-overflow/${parts.join("__")}.html`;
}

function moreSlot(
  ctx: ListCtx,
  sub: string | undefined,
  sourceId: string | undefined,
  pages: number,
): string {
  if (pages <= 0) return "";
  const src = escapeHtml(overflowPath(ctx.date, ctx.panel, sub, sourceId));
  return `\n    <button type="button" class="more-slot" data-src="${src}" data-hint="${escapeHtml(STR.moreHint)}" data-loading="${escapeHtml(STR.moreLoading)}" data-error="${escapeHtml(STR.moreError)}">${STR.moreHint.replace("{n}", String(pages))}</button>`;
}

function renderSourceContent(
  ctx: ListCtx,
  subId: string,
  source: SourceGroup,
  isActive: boolean,
): string {
  const pages = splitPages(source.items);
  const first = pages[0] ?? [];
  const body =
    first.length === 0
      ? `<p class="empty">${STR.emptySource}</p>`
      : first.map((a) => renderArticleHtml(a, subId)).join("\n");
  return `<div role="tabpanel" class="source-content${isActive ? " active" : ""}" data-source-content="${escapeHtml(source.sourceId)}" data-sub="${escapeHtml(subId)}" data-cat="${ctx.cat}">
    ${body}${moreSlot(ctx, subId, source.sourceId, pages.length - 1)}
  </div>`;
}

function renderSourceTabs(
  category: string,
  subId: string,
  sources: SourceGroup[],
): string {
  // Single-source L2s (X 推文 / GitHub Trending) skip the L3 row — the L2 tab
  // label already identifies the dataset. L3 only earns its row when there
  // are ≥2 sources to switch between (e.g. 社区讨论 V2EX vs LinuxDo).
  if (sources.length < 2) return "";
  return `<nav class="source-tabs" role="tablist">${sources
    .map(
      (s, i) =>
        `<button role="tab" type="button" aria-selected="${i === 0}" data-hash="#${escapeHtml(category)}/${escapeHtml(subId)}/${escapeHtml(s.sourceId)}" class="source-tab${i === 0 ? " active" : ""}" data-source="${escapeHtml(s.sourceId)}" data-sub="${escapeHtml(subId)}" data-cat="${category}">${escapeHtml(s.sourceName)}<span class="count">${s.items.length}</span></button>`,
    )
    .join("")}</nav>`;
}

function renderSubContent(
  ctx: ListCtx,
  sub: SubGroup,
  isActive: boolean,
): string {
  return `<div role="tabpanel" id="subcontent-${escapeHtml(ctx.panel)}-${escapeHtml(sub.id)}" class="sub-content${isActive ? " active" : ""}" data-sub-content="${escapeHtml(sub.id)}" data-cat="${ctx.cat}">
    ${renderSourceTabs(ctx.cat, sub.id, sub.sources)}
    <div class="source-contents">
      ${sub.sources.map((s, i) => renderSourceContent(ctx, sub.id, s, i === 0)).join("\n")}
    </div>
  </div>`;
}

/** Tab key of the merged list; not a subcategory id, so nothing collides. */
const ALL_SUB_TAB = "__all";

/**
 * Raw subgroups a panel renders, in config order. A subcategory with nothing
 * to show is dropped: an empty tab costs a click and reports nothing.
 */
function subsOfPanel(panel: Panel, raw: RawByCategory): SubGroup[] {
  if (panel.kind !== "category" || !panel.sourceCategory) return [];
  const all = raw[panel.sourceCategory] ?? [];
  const allowed = new Set(panel.subcategories ?? []);
  return all.filter((s) => allowed.has(s.id) && subItemCount(s) > 0);
}

function subItemCount(sub: SubGroup): number {
  return sub.sources.reduce((n, src) => n + src.items.length, 0);
}

/**
 * Every article of a panel, newest first, capped at the subcategory budget.
 * Undated items sort last: -1 sorts below any real timestamp and keeps the
 * comparator free of NaN when two items share it.
 */
function mergeEntries(
  category: Category,
  subs: SubGroup[],
): { article: ArticleInput; subId: string }[] {
  const entries: { article: ArticleInput; subId: string }[] = [];
  for (const sub of subs) {
    for (const source of sub.sources) {
      for (const article of source.items) entries.push({ article, subId: sub.id });
    }
  }
  entries.sort(
    (x, y) =>
      (y.article.publishedAt?.getTime() ?? -1) -
      (x.article.publishedAt?.getTime() ?? -1),
  );
  return entries.slice(0, subLimitFor(category, undefined));
}

function renderAllSubContent(ctx: ListCtx, subs: SubGroup[]): string {
  const pages = splitPages(mergeEntries(ctx.cat, subs));
  const first = pages[0] ?? [];
  const body =
    first.length === 0
      ? `<p class="empty">${STR.emptyCategory}</p>`
      : first
          .map(({ article, subId }) => renderArticleHtml(article, subId))
          .join("\n");
  return `<div role="tabpanel" id="subcontent-${escapeHtml(ctx.panel)}-__all" class="sub-content active" data-sub-content="${ALL_SUB_TAB}" data-cat="${ctx.cat}">
    ${body}${moreSlot(ctx, undefined, undefined, pages.length - 1)}
  </div>`;
}

function renderRawCategoryPanel(ctx: ListCtx, subs: SubGroup[]): string {
  if (subs.length === 0) {
    return `<p class="empty">${STR.emptyCategory}</p>`;
  }
  if (subs.length === 1) {
    return renderSubContent(ctx, subs[0], true);
  }
  const total = subs.reduce((n, s) => n + subItemCount(s), 0);
  const subTabs = [
    `<button role="tab" type="button" aria-selected="true" id="sub-${escapeHtml(ctx.panel)}-__all" aria-controls="subcontent-${escapeHtml(ctx.panel)}-__all" data-hash="#${escapeHtml(ctx.panel)}/__all" class="sub-tab active" data-sub="${ALL_SUB_TAB}" data-cat="${ctx.cat}">${STR.allSubTab}<span class="count">${total}</span></button>`,
    ...subs.map(
      (s) =>
        `<button role="tab" type="button" aria-selected="false" id="sub-${escapeHtml(ctx.panel)}-${escapeHtml(s.id)}" aria-controls="subcontent-${escapeHtml(ctx.panel)}-${escapeHtml(s.id)}" data-hash="#${escapeHtml(ctx.panel)}/${escapeHtml(s.id)}" class="sub-tab" data-sub="${escapeHtml(s.id)}" data-cat="${ctx.cat}">${escapeHtml(s.name)}<span class="count">${subItemCount(s)}</span></button>`,
    ),
  ].join("");
  const panels = [
    renderAllSubContent(ctx, subs),
    ...subs.map((s) => renderSubContent(ctx, s, false)),
  ].join("\n");
  return `<nav class="sub-tabs" role="tablist">${subTabs}</nav>\n<div class="sub-contents">${panels}</div>`;
}

export interface OverflowFile {
  /** Path relative to the report's date directory. */
  name: string;
  html: string;
}

function pagesHtml(pages: string[][]): string {
  return pages
    .map(
      (page, i) =>
        `\n<section class="more-page" data-page="${i + 2}" hidden>\n${page.join("\n")}\n</section>`,
    )
    .join("");
}

/**
 * Fragments holding everything past the first page of each list. Written next
 * to the report so a scroll can fetch one small file instead of the page
 * carrying every article up front.
 */
export function renderOverflowFiles(raw: RawByCategory, date: string): OverflowFile[] {
  const out: OverflowFile[] = [];
  // Panels carve the raw subgroups differently (tech main vs 社区讨论), so the
  // fragment is keyed by panel: two panels sharing a category must not write
  // the same file.
  for (const panel of buildPanels()) {
    if (panel.kind !== "category" || !panel.sourceCategory) continue;
    const subs = subsOfPanel(panel, raw);
    if (subs.length === 0) continue;
    const ctx: ListCtx = { panel: panel.id, cat: panel.sourceCategory, date };
    if (subs.length > 1) {
      const pages = splitPages(mergeEntries(ctx.cat, subs));
      if (pages.length > 1) {
        out.push({
          name: overflowPath(date, panel.id),
          html: pagesHtml(
            pages
              .slice(1)
              .map((page) => page.map(({ article, subId }) => renderArticleHtml(article, subId))),
          ),
        });
      }
    }
    for (const sub of subs) {
      for (const source of sub.sources) {
        const pages = splitPages(source.items);
        if (pages.length <= 1) continue;
        out.push({
          name: overflowPath(date, panel.id, sub.id, source.sourceId),
          html: pagesHtml(
            pages.slice(1).map((page) => page.map((a) => renderArticleHtml(a, sub.id))),
          ),
        });
      }
    }
  }
  return out;
}

// ----- top-level renderer -----

/** Per-panel identity colors, injected as --panel-accent on tabs and panels. */
const PANEL_ACCENTS: Record<string, string> = {
  tech: "#378add",
  trading: "#7f77dd",
  politics: "#ef9f27",
  finance: "#639922",
  community: "#d4537e",
};

function panelAccent(id: string): string {
  return PANEL_ACCENTS[id] ?? "#3454d1";
}

function weekdayOf(date: string): string {
  try {
    return new Date(`${date}T12:00:00`).toLocaleDateString(
      REPORT_LOCALE === "en" ? "en-US" : "zh-CN",
      { weekday: "long", timeZone: getReportTz() },
    );
  } catch {
    return "";
  }
}

export function renderHtml(
  report: DailyReport,
  raw: RawByCategory,
  date: string,
): string {
  const trading = report.trading;

  const sumItems = (subs: SubGroup[]) =>
    subs.reduce(
      (n, sg) => n + sg.sources.reduce((m, s) => m + s.items.length, 0),
      0,
    );

  // Panels come from categories.config.json: each category owns a main panel
  // (minus subcategories carved into extra panels) plus any extra panel that
  // reuses its raw subgroups under a different tab.
  const visiblePanels = buildPanels().filter(
    (p) => p.kind === "category" || trading !== undefined,
  );

  const subsOf = (panel: Panel): SubGroup[] => subsOfPanel(panel, raw);

  const panelCount = (panel: Panel): number =>
    panel.kind === "trading" ? (trading?.tickers.length ?? 0) : sumItems(subsOf(panel));

  const renderedPanels = visiblePanels.map((panel) => {
    if (panel.kind === "trading") {
      return { panel, count: panelCount(panel), body: renderTradingPanel(trading!) };
    }
    if (!panel.sourceCategory) {
      throw new Error(`panel '${panel.id}' has no sourceCategory`);
    }
    return {
      panel,
      count: panelCount(panel),
      body: renderRawCategoryPanel(
        { panel: panel.id, cat: panel.sourceCategory, date },
        subsOf(panel),
      ),
    };
  });

  const totalArticles = Object.values(raw).reduce((n, subs) => n + sumItems(subs), 0);
  const enabledSources = sources.filter((s) => s.enabled !== false).length;
  const generatedAt = trading?.generated_at
    ? formatDate(new Date(trading.generated_at))
    : formatDate(new Date());

  const topBriefs = Object.entries(report.briefs)
    .filter(([id]) => visiblePanels.some((p) => p.id === id))
    .flatMap(([, items]) => items)
    .sort((a, b) => b.importance - a.importance)
    .slice(0, 3);

  const heroHtml = [
    report.hero_headline
      ? `<h2 class="hero-headline">${escapeHtml(report.hero_headline)}</h2>`
      : "",
    report.daily_overview
      ? `<div class="overview-card"><span class="eyebrow">${STR.mdTodayOverview}</span><p class="overview-text">${escapeHtml(report.daily_overview)}</p></div>`
      : "",
    report.keywords.length
      ? `<div class="keywords">${report.keywords.map((k) => `<span class="keyword">#${escapeHtml(k)}</span>`).join("")}</div>`
      : "",
    report.editor_note
      ? `<div class="editor-card"><span class="eyebrow">${STR.mdEditorNote}</span><p class="editor-text">${escapeHtml(report.editor_note)}</p></div>`
      : "",
  ].join("\n  ");

  const briefsHtml = topBriefs.length
    ? `<section class="digest-category">
  <div class="category-header"><h2 class="category-title">${STR.topPicks}</h2></div>
  <div class="brief-list">
    ${topBriefs
      .map((b) => {
        const rank = b.importance >= 8 ? "high" : b.importance >= 6 ? "mid" : "low";
        return `<div class="brief">
      <div class="brief-head">
        <span class="brief-source">${escapeHtml(b.source)}</span>
        <span class="brief-rank ${rank}">${b.importance}/10</span>
      </div>
      <h3 class="brief-title"><a href="${escapeHtml(b.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(b.title)}</a></h3>
      <p class="brief-summary">${escapeHtml(b.summary)}</p>
    </div>`;
      })
      .join("\n    ")}
  </div>
</section>`
    : "";

  return `<!doctype html>
<html lang="${REPORT_LOCALE === "en" ? "en" : "zh-CN"}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<title>${STR.siteTitle} · ${date}</title>
${THEME_BOOTSTRAP_SCRIPT}
<style>${REPORT_CSS}</style>
</head>
<body>
<main>
  <div class="toolbar">
    <div class="brand-row">
      <span class="brand-mark" aria-hidden="true"></span>
      <span class="brand-name">${STR.siteTitle}</span>
      <span class="brand-sub">Daily Brief</span>
    </div>
    <div class="toolbar-actions">
      <span class="eyebrow">${STR.themeLabel}</span>
      <div class="segmented" role="group" aria-label="${STR.themeLabel}">
        <button type="button" data-theme-set="light" aria-pressed="true">${STR.themeLight}</button>
        <button type="button" data-theme-set="dark" aria-pressed="false">${STR.themeDark}</button>
        <button type="button" data-theme-set="paper" aria-pressed="false">${STR.themePaper}</button>
      </div>
      <span class="eyebrow">${STR.densityLabel}</span>
      <div class="segmented" role="group" aria-label="${STR.densityLabel}">
        <button type="button" data-density-set="comfortable" aria-pressed="true">${STR.densityComfortable}</button>
        <button type="button" data-density-set="compact" aria-pressed="false">${STR.densityCompact}</button>
      </div>
      ${process.env.WEB_MODE === "true" ? `<a class="toolbar-link archive-link" href="../archive.html">${STR.archiveLink}</a>` : ""}
    </div>
  </div>

  <header class="report-header">
    <div>
      <h1 class="report-title">${date}<span class="date-weekday">${weekdayOf(date)}</span></h1>
    </div>
    <div class="stat-strip">
      <div class="stat"><span class="stat-label">${STR.statArticles}</span><span class="stat-value">${totalArticles}</span></div>
      <div class="stat"><span class="stat-label">${STR.statSources}</span><span class="stat-value">${enabledSources}</span></div>
      <div class="stat"><span class="stat-label">${STR.statGenerated}</span><span class="stat-value">${generatedAt.slice(-5)}</span></div>
    </div>
  </header>

  ${heroHtml ? `<section class="hero-card">\n  ${heroHtml}\n</section>` : ""}
  ${briefsHtml}

  <nav class="tabs" role="tablist" aria-label="${STR.ariaTablist}">
    ${renderedPanels.map(({ panel, count }, i) => `<button role="tab" type="button" aria-selected="${i === 0}" id="tab-${escapeHtml(panel.id)}" aria-controls="panel-${escapeHtml(panel.id)}" data-hash="#${escapeHtml(panel.id)}" style="--panel-accent:${panelAccent(panel.id)}" class="tab${i === 0 ? " active" : ""}" data-tab="${escapeHtml(panel.id)}">${escapeHtml(panel.label)}<span class="count">${count}</span></button>`).join("\n    ")}
  </nav>

  ${renderedPanels.map(({ panel, body }, i) => `<section role="tabpanel" aria-labelledby="tab-${escapeHtml(panel.id)}" id="panel-${escapeHtml(panel.id)}" class="panel${i === 0 ? " active" : ""}" data-panel="${escapeHtml(panel.id)}" style="--panel-accent:${panelAccent(panel.id)}">
    ${body}
  </section>`).join("\n  ")}

  <footer>
    <span>${STR.footer}</span>
    <button type="button" class="back-to-top">↑ ${STR.backToTop}</button>
  </footer>
</main>
${CLIENT_SCRIPT}
</body>
</html>`;
}

// ----- trading panel -----

const SIGNAL_TONE: Record<string, "bull" | "bear" | "caution"> = {
  "golden-cross": "bull",
  "macd-bull-cross": "bull",
  "above-sma50-sma200": "bull",
  "near-52w-high": "bull",
  "death-cross": "bear",
  "macd-bear-cross": "bear",
  "below-sma50-sma200": "bear",
  "near-52w-low": "bear",
  "rsi-overbought": "caution",
  "rsi-oversold": "caution",
};

const TREND_LABEL: Record<TickerAnalysis["trend"], string> = {
  bullish: STR.trendBullish,
  bearish: STR.trendBearish,
  neutral: STR.trendNeutral,
};

function stanceClass(stance: string): "bull" | "bear" | "neutral" {
  // Supports both legacy ("看多"/"看空") and current ("偏上行"/"偏下行")
  // stance values. The current values were chosen to avoid Sonnet's
  // "no investment advice" guardrail; rendering keeps both readable.
  if (/多|涨|上行|bull/i.test(stance)) return "bull";
  if (/空|跌|下行|bear/i.test(stance)) return "bear";
  return "neutral";
}

function fmtNum(n: number | null | undefined, dp = 2): string {
  if (n == null || !Number.isFinite(n)) return "—";
  // Use thousand separators only for prices >= 1000
  const abs = Math.abs(n);
  if (abs >= 1000) return n.toFixed(dp).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return n.toFixed(dp);
}

function fmtPct(n: number, dp = 2): string {
  const sign = n >= 0 ? "+" : "";
  return `${sign}${n.toFixed(dp)}%`;
}

function renderPickCard(p: WatchlistPick): string {
  const cls = stanceClass(p.stance);
  const symbol = escapeHtml(p.symbol);
  const name = escapeHtml(p.display_name ?? p.symbol);
  const stance = escapeHtml(p.stance);
  const rationale = escapeHtml(p.rationale ?? "");
  return `<div class="trading-pick stance-${cls}">
    <header class="pick-head">
      <div class="pick-symbol-block">
        <span class="pick-symbol">${symbol}</span>
        <span class="pick-name">${name}</span>
      </div>
      <span class="pick-stance pick-stance-${cls}">${stance}</span>
    </header>
    <p class="pick-rationale">${rationale}</p>
  </div>`;
}

/** Mini trend line built from real SMA 200 → 50 → 20 → spot values. */
function trendSparkline(t: TickerAnalysis): string {
  const values = [t.sma200, t.sma50, t.sma20, t.currentPrice].filter(
    (v): v is number => v != null && Number.isFinite(v),
  );
  if (values.length < 2) return "";
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const w = 62;
  const h = 22;
  const pad = 2;
  const points = values
    .map((v, i) => {
      const x = pad + (i * (w - 2 * pad)) / (values.length - 1);
      const y = h - pad - ((v - min) / span) * (h - 2 * pad);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  const rising = values[values.length - 1] >= values[0];
  const stroke = rising ? "var(--down)" : "var(--up)";
  return `<svg class="sparkline" viewBox="0 0 ${w} ${h}" role="img" aria-label="${STR.tickerTrend}"><polyline points="${points}" fill="none" stroke="${stroke}" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
}

function renderTickerCard(t: TickerAnalysis): string {
  const trendCls = t.trend;
  const priceCls = t.pct1Day >= 0 ? "positive" : "negative";
  const pct5Cls = t.pct5Day >= 0 ? "positive" : "negative";
  const signals = t.signals
    .map((s) => {
      const tone = SIGNAL_TONE[s.type] ?? "caution";
      const ageSuffix =
        s.daysAgo !== undefined
          ? ` <span class="signal-age">(${s.daysAgo === 0 ? STR.signalToday : `${s.daysAgo} ${STR.signalDaysAgoSuffix}`})</span>`
          : "";
      return `<span class="signal-pill tone-${tone}">${escapeHtml(s.label)}${ageSuffix}</span>`;
    })
    .join("");
  const currencyPrefix = t.currency === "USD" ? "$" : t.currency === "HKD" ? "HK$" : t.currency === "CNY" ? "¥" : "";
  return `<div class="ticker-card">
    <header class="ticker-head">
      <div class="ticker-id">
        <h3 class="ticker-symbol">${escapeHtml(t.symbol)}</h3>
        <p class="ticker-name">${escapeHtml(t.displayName)}</p>
      </div>
      <div class="ticker-price-block">
        <span class="ticker-price">${currencyPrefix}${fmtNum(t.currentPrice)}</span>
        <span class="pct-pill ${priceCls}">${fmtPct(t.pct1Day)}</span>
        ${trendSparkline(t)}
      </div>
    </header>
    <dl class="ticker-indicators">
      <div><dt>${STR.ticker5d}</dt><dd class="${pct5Cls}">${fmtPct(t.pct5Day)}</dd></div>
      <div><dt>${STR.tickerVs52wHigh}</dt><dd>${fmtPct(t.pct52WeekHigh, 1)}</dd></div>
      <div><dt>RSI(14)</dt><dd class="rsi-${t.rsiState}">${fmtNum(t.rsi14, 1)}</dd></div>
      <div><dt>${STR.tickerTrend}</dt><dd class="trend-${trendCls}">${TREND_LABEL[t.trend]}</dd></div>
      <div><dt>SMA 20 / 50 / 200</dt><dd>${fmtNum(t.sma20)} / ${fmtNum(t.sma50)} / ${fmtNum(t.sma200)}</dd></div>
      <div><dt>${STR.tickerMacd}</dt><dd>${fmtNum(t.macd, 3)} / ${fmtNum(t.macdSignal, 3)}</dd></div>
    </dl>
    ${signals ? `<div class="ticker-signals">${signals}</div>` : ""}
  </div>`;
}

function fearGreedTone(value: number): "fear-extreme" | "fear" | "neutral" | "greed" | "greed-extreme" {
  if (value <= 24) return "fear-extreme";
  if (value <= 44) return "fear";
  if (value <= 55) return "neutral";
  if (value <= 74) return "greed";
  return "greed-extreme";
}

function fmtBigUsd(n: number): string {
  if (n >= 1e12) return `$${(n / 1e12).toFixed(2)} T`;
  if (n >= 1e9) return `$${(n / 1e9).toFixed(1)} B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(1)} M`;
  return `$${n.toFixed(0)}`;
}

/** Semicircle gauge for the Fear & Greed index (0–100). */
function fearGauge(value: number, tone: string): string {
  const clamped = Math.max(0, Math.min(100, value));
  const stroke =
    tone === "fear-extreme" || tone === "fear"
      ? "var(--up)"
      : tone === "neutral"
        ? "var(--muted)"
        : "var(--down)";
  const arc = 113.1;
  const filled = ((clamped / 100) * arc).toFixed(1);
  return `<svg class="fear-gauge" viewBox="0 0 88 50" role="img" aria-label="Fear and Greed ${clamped}">
    <path class="gauge-track" d="M 8 44 A 36 36 0 0 1 80 44"/>
    <path class="gauge-fill" d="M 8 44 A 36 36 0 0 1 80 44" stroke="${stroke}" stroke-dasharray="${filled} ${arc}"/>
  </svg>`;
}

function renderCryptoWidgets(t: TradingSection): string {
  const fg = t.crypto_fear_greed;
  const cg = t.crypto_global;
  if (!fg && !cg) return "";
  const items: string[] = [];
  if (fg) {
    const tone = fearGreedTone(fg.value);
    items.push(`<div class="crypto-widget fg-${tone}">
      <div class="widget-label">${STR.widgetCryptoFearGreed}</div>
      ${fearGauge(fg.value, tone)}
      <div class="widget-sub">${fg.value} · ${escapeHtml(fg.classificationCn)}</div>
    </div>`);
  }
  if (cg) {
    const tone = cg.marketCapChangePct24h >= 0 ? "positive" : "negative";
    items.push(`<div class="crypto-widget">
      <div class="widget-label">${STR.widgetCryptoCap}</div>
      <div class="widget-value">${fmtBigUsd(cg.totalMarketCapUsd)}</div>
      <div class="widget-sub ${tone}">${fmtPct(cg.marketCapChangePct24h)} / 24h</div>
    </div>`);
    items.push(`<div class="crypto-widget">
      <div class="widget-label">${STR.widgetBtcDom}</div>
      <div class="widget-value">${cg.btcDominance.toFixed(1)}%</div>
      <div class="widget-sub">ETH ${cg.ethDominance.toFixed(1)}%</div>
    </div>`);
    items.push(`<div class="crypto-widget">
      <div class="widget-label">${STR.widgetVolume24h}</div>
      <div class="widget-value">${fmtBigUsd(cg.total24hVolumeUsd)}</div>
      <div class="widget-sub">${STR.widgetActiveCoins} ${cg.activeCryptocurrencies.toLocaleString()}</div>
    </div>`);
  }
  return `<div class="crypto-widgets">${items.join("")}</div>`;
}

function renderTradingPanel(trading: TradingSection): string {
  const tickers = trading.tickers;
  const groupCounts: Record<AssetGroup, number> = {
    "us-equity": 0,
    crypto: 0,
    "china-equity": 0,
    "commodity-fx": 0,
    macro: 0,
  };
  for (const t of tickers) groupCounts[t.group as AssetGroup] = (groupCounts[t.group as AssetGroup] ?? 0) + 1;

  const groupTabs = ASSET_GROUP_ORDER.map(
    (g, i) =>
      `<button role="tab" type="button" aria-selected="${i === 0}" data-hash="#trading/group/${g}" class="trading-group-tab${i === 0 ? " active" : ""}" data-group="${g}">${escapeHtml(ASSET_GROUP_LABELS_LOCALIZED[g])}<span class="count">${groupCounts[g] ?? 0}</span></button>`,
  ).join("");

  const groupPanels = ASSET_GROUP_ORDER.map((g, i) => {
    const groupTickers = tickers.filter((t) => t.group === g);
    // Crypto sub-tab carries an extra header widget panel (F&G + global stats)
    const cryptoWidgets =
      g === "crypto" ? renderCryptoWidgets(trading) : "";
    return `<div role="tabpanel" class="trading-group-content${i === 0 ? " active" : ""}" data-group="${g}">
      ${cryptoWidgets}
      ${groupTickers.length === 0 ? `<p class="empty">${STR.emptyGroup}</p>` : groupTickers.map(renderTickerCard).join("")}
    </div>`;
  }).join("");

  const overview = escapeHtml(trading.market_overview ?? "");
  const risk = escapeHtml(trading.risk_caveat ?? "");

  return `<section class="trading-overview-card">
    <span class="eyebrow">${STR.tradingMarketOverview}</span>
    <p class="overview-text trading-overview-text">${overview}</p>
  </section>

  ${
    trading.watchlist.length > 0
      ? `<section class="trading-watchlist">
    <h2 class="category-title trading-section-title">${STR.tradingTodayFocus}</h2>
    <div class="trading-picks">
      ${trading.watchlist.map(renderPickCard).join("\n")}
    </div>
  </section>`
      : ""
  }

  <section class="trading-tickers">
    <h2 class="category-title trading-section-title">${STR.tradingAllAssets}</h2>
    <nav class="trading-group-tabs" role="tablist">${groupTabs}</nav>
    <div class="trading-group-contents">${groupPanels}</div>
  </section>

  ${
    risk
      ? `<section class="trading-risk">
    <span class="eyebrow">${STR.tradingRiskCaveat}</span>
    <p>${risk}</p>
  </section>`
      : ""
  }`;
}

// ----- markdown -----

function renderBriefMarkdown(b: BriefItem): string {
  const importance = Number.isFinite(b.importance) ? b.importance : 0;
  return `### [${b.title}](${b.url})\n${b.source} · ${STR.mdImportance} ${importance}/10\n\n${b.summary}\n`;
}

function renderSectionMarkdown(title: string, briefs: BriefItem[]): string {
  if (briefs.length === 0) return "";
  return `## ${title}\n\n${briefs.map(renderBriefMarkdown).join("\n")}\n`;
}

export function renderMarkdown(report: DailyReport, date: string): string {
  const blocks: string[] = [];
  blocks.push(`# ${STR.siteTitle} · ${date}\n`);
  if (report.hero_headline) blocks.push(`> ${report.hero_headline}\n`);
  if (report.daily_overview) {
    blocks.push(`## ${STR.mdTodayOverview}\n\n${report.daily_overview}\n`);
  }
  for (const id of categoryIds) {
    blocks.push(
      renderSectionMarkdown(categoryLabel(id), report.briefs[id] ?? []),
    );
  }
  if (report.editor_note) {
    blocks.push(`## ${STR.mdEditorNote}\n\n${report.editor_note}\n`);
  }
  if (report.keywords.length > 0) {
    blocks.push(
      `## ${STR.mdTodayKeywords}\n\n${report.keywords.map((k) => `\`#${k}\``).join(" ")}\n`,
    );
  }
  return blocks.filter(Boolean).join("\n");
}
