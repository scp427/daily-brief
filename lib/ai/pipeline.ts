import { jsonrepair } from "jsonrepair";
import { LlmIncompleteResponseError } from "./errors";
import { runLlm } from "./llm";
import { extractJson } from "./json-util";
import { buildDigestSystemPrompt } from "./prompts";
import { categories, categoryIds, REPORT_LOCALE } from "../categories";
import type { RawArticle } from "../sources/types";

const SYSTEM_PROMPT_DIGEST = buildDigestSystemPrompt(REPORT_LOCALE);

export interface BriefItem {
  title: string;
  url: string;
  source: string;
  summary: string;
  importance: number;
}

/** One per-category paragraph of the daily overview. */
export interface OverviewSection {
  /** Category id from categories.config.json. */
  category: string;
  text: string;
}

export interface DailyReport {
  hero_headline: string;
  /** Lead-in paragraph shown above the per-category overview sections. */
  daily_overview: string;
  /** Absent on reports written before per-category overviews existed. */
  overview_sections?: OverviewSection[];
  /** Digest briefs keyed by category id (see categories.config.json). */
  briefs: Record<string, BriefItem[]>;
  editor_note: string;
  keywords: string[];
  /** Optional trading-signals section, present when scripts/daily.ts ran successfully. */
  trading?: TradingSection;
}

import type { TickerAnalysis } from "../trading/signals";
import type { CryptoGlobalStats } from "../trading/coingecko";
import type { FearGreedSnapshot } from "../trading/fear-greed";
import type { TradingCommentary } from "./trading-commentary";

export interface TradingSection extends TradingCommentary {
  generated_at: string;
  tickers: TickerAnalysis[];
  crypto_fear_greed?: FearGreedSnapshot;
  crypto_global?: CryptoGlobalStats;
}

export interface ArticleInput extends RawArticle {
  source: string;
}

const MAX_AGE_DAYS = 14;

/**
 * Pick `limit` items from `items` so every source gets a fair shot.
 *
 * Why this exists: the previous `slice(0, limit)` honored insertion order,
 * which is the source-iteration order in daily.ts. That gave whichever
 * source came first 100% of the quota — e.g. all 25 tech slots filled by
 * Hacker News before GitHub Trending / Solidot / V2EX / 阮一峰 got a turn.
 *
 * Strategy: drop items older than MAX_AGE_DAYS, group by sourceId,
 * sort each bucket newest-first, then round-robin one item per source
 * until we hit the limit. Sources with fewer items naturally drop out
 * and others absorb the slack.
 */
function selectRoundRobin(
  items: ArticleInput[],
  limit: number,
): ArticleInput[] {
  const cutoff = Date.now() - MAX_AGE_DAYS * 86_400_000;
  const fresh = items.filter(
    (it) => !it.publishedAt || it.publishedAt.getTime() >= cutoff,
  );

  const bySource = new Map<string, ArticleInput[]>();
  for (const it of fresh) {
    const arr = bySource.get(it.sourceId) ?? [];
    arr.push(it);
    bySource.set(it.sourceId, arr);
  }
  for (const arr of bySource.values()) {
    arr.sort(
      (a, b) =>
        (b.publishedAt?.getTime() ?? 0) - (a.publishedAt?.getTime() ?? 0),
    );
  }

  const buckets = Array.from(bySource.values());
  const out: ArticleInput[] = [];
  let madeProgress = true;
  while (out.length < limit && madeProgress) {
    madeProgress = false;
    for (const b of buckets) {
      if (b.length === 0) continue;
      out.push(b.shift()!);
      madeProgress = true;
      if (out.length >= limit) break;
    }
  }
  return out;
}

/**
 * Keep the report publishable when both digest-generation attempts return
 * malformed/truncated JSON. The HTML view is driven by the raw article
 * sidecar, while this fallback preserves useful Markdown/JSON brief items
 * using summaries that earlier enrichment stages already produced.
 */
export function buildFallbackDailyReport(
  articles: ArticleInput[],
): DailyReport {
  const grouped: Record<string, ArticleInput[]> = {};
  for (const id of categoryIds) grouped[id] = [];
  for (const article of articles) {
    (grouped[article.category] ??= []).push(article);
  }

  const toBriefs = (category: string): BriefItem[] =>
    selectRoundRobin(
      grouped[category] ?? [],
      categories.find((c) => c.id === category)?.fallbackLimit ?? 3,
    ).map((article) => {
      const summary =
        article.summary?.trim() ||
        article.excerpt?.trim() ||
        article.title.trim();
      return {
        title: article.title,
        url: article.url,
        source: article.source,
        summary: summary.slice(0, 400),
        importance: 5,
      };
    });

  const briefs: Record<string, BriefItem[]> = {};
  for (const id of categoryIds) briefs[id] = toBriefs(id);

  return {
    hero_headline: "",
    daily_overview: "",
    briefs,
    editor_note: "",
    keywords: [],
  };
}

/**
 * Keep only sections naming a declared category with non-empty text. LLM
 * output is a real boundary: an unknown id would render as a bare id.
 */
export function normalizeOverviewSections(raw: unknown): OverviewSection[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((entry) => {
    const item = entry as { category?: unknown; text?: unknown };
    if (typeof item.category !== "string" || !categoryIds.includes(item.category)) {
      return [];
    }
    if (typeof item.text !== "string" || !item.text.trim()) return [];
    return [{ category: item.category, text: item.text.trim() }];
  });
}

function isRecoverableDigestOutputError(error: unknown): boolean {
  return (
    error instanceof SyntaxError ||
    error instanceof LlmIncompleteResponseError
  );
}

async function callOnce(userPayloadJson: string): Promise<DailyReport> {
  // Claude Code CLI's built-in system prompt biases the model toward
  // conversational markdown output. Anchor the format expectation in the
  // user message (instruction recency wins) *and* explicitly demand every
  // schema field be populated — without this Sonnet has been observed to
  // emit a JSON shell with empty arrays to "satisfy" a JSON-only ask.
  const userPrompt =
    REPORT_LOCALE === "en"
      ? [
          "**Output language: ENGLISH ONLY.** Every string value in the JSON — hero_headline, daily_overview, every brief's title/summary, editor_note, keywords — must be written entirely in English. No Chinese characters anywhere.",
          "",
          "Your task: generate today's daily brief from the candidate news below. **The response MUST be a single valid JSON object** — starts with `{`, ends with `}`, no markdown, no code fences, no explanations.",
          "",
          "The JSON must contain every field non-empty (briefs arrays per the system-prompt counts):",
          "  - hero_headline: 10-25 word headline of the day",
          "  - daily_overview: **60-100 word** lead-in that frames the day",
          `  - overview_sections: one entry per category, in this order: ${categories.map((c) => c.id).join(", ")}. Each entry is {"category": "<id>", "text": "<40-60 word summary of that domain>"}`,
          ...categories.map(
            (c) => `  - ${c.id}_briefs: **${c.digestCount}** ${c.labelEn} BriefItems`,
          ),
          "  - editor_note: 30-60 word editor's note",
          "  - keywords: 5-8 keywords",
          "",
          "BriefItem fields: title, url (copied verbatim from candidate), source, summary, importance (1-10).",
          "**Quote rule (important!)**: For any quotation INSIDE a JSON string, use single quotes ' or curly quotes '\" — **never** raw double quotes \", which break JSON parsing.",
          "No trailing commas.",
          "",
          `Candidate news (JSON array, ${userPayloadJson.length} chars):`,
          userPayloadJson,
        ].join("\n")
      : [
          "你的任务：根据下方候选新闻，生成一份当日简报，**响应必须是一个合法 JSON 对象**——以 `{` 开头，以 `}` 结尾，不要 markdown / 不要代码围栏 / 不要任何解释。",
          "",
          "JSON 必须包含全部字段且不能为空（briefs 数组按 system prompt 规定的条数填充）：",
          "  - hero_headline: 10-25 字的当日一句话头条",
          "  - daily_overview: **60-100 字** 的当日导语（先给全局）",
          `  - overview_sections: 每个大分类一条，顺序为 ${categories.map((c) => c.id).join(" / ")}，每条 {"category": "<分类 id>", "text": "<40-60 字的该领域概览>"}`,
          ...categories.map(
            (c) => `  - ${c.id}_briefs: **${c.digestCount} 条** ${c.labelZh} BriefItem`,
          ),
          "  - editor_note: 30-60 字的编辑短评",
          "  - keywords: 5-8 个关键词",
          "",
          "BriefItem 字段：title、url（必须从候选条目原样选取）、source、summary、importance(1-10)。",
          "**引号规则（重要！）**：JSON 字符串内的中文引用请使用**中文全角引号**「」或者 “”，**绝对不要**用英文双引号 \" —— 那会导致 JSON 解析失败。例：写 商务部回应「内卷」 而不是 商务部回应\"内卷\"。",
          "不要使用单引号、不要末尾多余逗号。",
          "",
          "候选新闻（JSON 数组，共 " + userPayloadJson.length + " 字符）：",
          userPayloadJson,
        ].join("\n");
  const { text } = await runLlm({
    systemPrompt: SYSTEM_PROMPT_DIGEST,
    userPrompt,
    jsonMode: true,
  });
  const cleaned = extractJson(text);
  let parsed: Partial<DailyReport>;
  try {
    parsed = JSON.parse(cleaned) as Partial<DailyReport>;
  } catch (strictErr) {
    // LLMs routinely emit JSON with unescaped quotes inside Chinese
    // strings (e.g. 商务部回应"内卷"). jsonrepair fixes most of these
    // mechanically before we ever surface a failure.
    try {
      const repaired = jsonrepair(cleaned);
      parsed = JSON.parse(repaired) as Partial<DailyReport>;
      console.warn("[pipeline] JSON.parse failed but jsonrepair recovered");
    } catch {
      try {
        const fs = await import("node:fs");
        fs.mkdirSync("logs", { recursive: true });
        const ts = new Date().toISOString().replace(/[:.]/g, "-");
        fs.writeFileSync(`logs/claude-raw-${ts}.txt`, text, "utf8");
        fs.writeFileSync(`logs/claude-cleaned-${ts}.txt`, cleaned, "utf8");
        console.warn(
          `[pipeline] both JSON.parse and jsonrepair failed; raw at logs/claude-raw-${ts}.txt`,
        );
      } catch {
        // best-effort logging
      }
      throw strictErr;
    }
  }
  const rawBriefs = parsed as unknown as Record<string, unknown>;
  const briefs: Record<string, BriefItem[]> = {};
  for (const category of categories) {
    const field = rawBriefs[`${category.id}_briefs`];
    if (field !== undefined && !Array.isArray(field)) {
      throw new SyntaxError(
        `digest field '${category.id}_briefs' must be an array`,
      );
    }
    briefs[category.id] = (field as BriefItem[] | undefined) ?? [];
  }

  const overview_sections = normalizeOverviewSections(
    (parsed as { overview_sections?: unknown }).overview_sections,
  );

  return {
    hero_headline: parsed.hero_headline ?? "",
    daily_overview: parsed.daily_overview ?? "",
    ...(overview_sections.length ? { overview_sections } : {}),
    briefs,
    editor_note: parsed.editor_note ?? "",
    keywords: parsed.keywords ?? [],
  };
}

export async function generateDailyReport(
  articles: ArticleInput[],
  callDigest: (userPayloadJson: string) => Promise<DailyReport> = callOnce,
): Promise<{ report: DailyReport; tokensUsed: number }> {
  const grouped: Record<string, ArticleInput[]> = {};
  for (const id of categoryIds) grouped[id] = [];
  for (const a of articles) {
    (grouped[a.category] ??= []).push(a);
  }

  const compact = categories.flatMap((c) =>
    selectRoundRobin(grouped[c.id] ?? [], c.payloadLimit),
  );

  const userPayload = compact.map((a, i) => ({
    n: i + 1,
    title: a.title,
    url: a.url,
    source: a.source,
    category: a.category,
    excerpt: (a.excerpt ?? "").slice(0, 200),
    published: a.publishedAt?.toISOString() ?? "",
  }));
  const userPayloadJson = JSON.stringify(userPayload);

  let report: DailyReport;
  try {
    report = await callDigest(userPayloadJson);
  } catch (firstErr) {
    // One retry covers transient provider interruptions and occasional
    // narration/malformed JSON on the first response.
    console.warn(
      `[pipeline] first digest call failed, retrying: ${
        firstErr instanceof Error ? firstErr.message : String(firstErr)
      }`,
    );
    try {
      report = await callDigest(userPayloadJson);
    } catch (secondErr) {
      if (
        isRecoverableDigestOutputError(firstErr) &&
        isRecoverableDigestOutputError(secondErr)
      ) {
        console.warn(
          "[pipeline] digest output invalid after 2 attempts; using enriched-article fallback",
        );
        report = buildFallbackDailyReport(articles);
      } else {
        // Auth, quota, networking, and configuration failures remain fatal;
        // silently publishing through those would hide actionable problems.
        throw secondErr;
      }
    }
  }

  report.overview_sections = normalizeOverviewSections(report.overview_sections);
  if (report.overview_sections.length === 0) delete report.overview_sections;

  // Max subscription has no per-call token meter — we expose 0 for schema
  // compatibility; consumers should treat 0 as "metric not available".
  return { report, tokensUsed: 0 };
}
