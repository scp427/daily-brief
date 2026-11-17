/**
 * Category id, declared in categories.config.json. Validation against the
 * declared set happens in lib/sources/config.ts, so the type stays open —
 * adding a category must not require a TypeScript change.
 */
export type Category = string;
export type SourceType = "rss" | "api" | "scrape";

/**
 * Which prompt summarises this source's items. `auto` picks the dedicated
 * prompt for GitHub/papers/X and the generic news prompt for merged
 * subcategories; `news` and `intro` force one generic prompt; `off` skips
 * enrichment entirely.
 */
export type EnrichStyle = "auto" | "news" | "intro" | "off";

export interface SourceDef {
  id: string;
  name: string;
  type: SourceType;
  url: string;
  category: Category;
  /**
   * Group key within a category. Render order/labels are defined per
   * category in lib/output/render.ts. Categories without a registered
   * order render flat (no L2 tabs).
   */
  subcategory?: string;
  /**
   * When true, the rss fetcher shells out to curl instead of using
   * Node's undici. Required for hosts that TLS-fingerprint Node
   * (Cloudflare's "Just a moment…" challenge — LinuxDo, Reddit, etc.)
   */
  useCurl?: boolean;
  enabled?: boolean;
  /**
   * True when the source can be fetched from mainland China directly.
   * Defaults to false: the source additionally goes through the overseas
   * snapshot pipeline (scripts/snapshot.ts on GitHub Actions), and a direct
   * attempt from a mainland host is expected to time out.
   */
  domestic?: boolean;
  /**
   * Source content language. Default treated as "en". When this equals
   * the active REPORT_LOCALE, the summary-enrichment step skips this
   * source — its content is already in the target language, so an LLM
   * "summary" would just be a slightly-shorter rewrite.
   */
  lang?: "zh" | "en";
  /**
   * Report locales this source participates in. Defaults to ["zh", "en"]
   * (both) when omitted. Set to ["zh"] for Chinese-only sources whose
   * content is meaningless to English-mode readers (V2EX/LinuxDo/etc.),
   * or ["en"] for English-community sources used to replace Chinese ones
   * when REPORT_LOCALE=en. The registry filters by REPORT_LOCALE at load.
   */
  locales?: ("zh" | "en")[];
  /**
   * Optional human-readable note explaining why a source is disabled or
   * any context useful for fork users. Ignored at runtime.
   */
  notes?: string;
  /**
   * Optional keyword filter list. When present, only items whose title or
   * body matches at least one keyword (case-insensitive) are kept.
   * Omit or leave empty to return all items unfiltered.
   */
  keywords?: string[];
  /**
   * Per-source display cap. Truncates this source's bucket before the
   * renderer applies subcategory budgets, and caps how many of its items
   * the summariser processes. Omit to inherit the subcategory limit.
   */
  maxItems?: number;
  /** Summary prompt style; see {@link EnrichStyle}. Defaults to "auto". */
  enrich?: EnrichStyle;
}

export interface RawArticle {
  sourceId: string;
  title: string;
  url: string;
  excerpt?: string;
  publishedAt?: Date;
  category: Category;
  /**
   * LLM-generated summary in the active REPORT_LOCALE language. For zh
   * reports this is the Chinese translation/summary of an English source;
   * for en reports it'd be the English summary of a non-English source.
   */
  summary?: string;
  /**
   * Structured one-line metadata to display above the excerpt — currently
   * used by GitHub Trending for "Language · ★stars · forks · stars today".
   */
  meta?: string;
}
