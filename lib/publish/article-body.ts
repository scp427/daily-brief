/**
 * Fetch and reduce one article page to the blocks a writer needs.
 *
 * The digest pipeline only ever sees a 300-char excerpt, which is enough to
 * rank a headline and useless for writing a long post. Long-form output
 * therefore re-fetches the source page and extracts the body here.
 *
 * Extraction is heuristic (cheerio, no readability dependency): pick the
 * densest candidate container, drop page chrome, keep block-level text in
 * document order. A page that yields too little text throws instead of
 * returning a thin body — silently falling back to the excerpt is what
 * produces plausible-but-invented prose downstream.
 */

import * as cheerio from "cheerio";

import { curlFetch, proxyConfigured } from "../sources/curl-fetch";

export class ArticleFetchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ArticleFetchError";
  }
}

export interface ArticleBody {
  url: string;
  title: string;
  ogImage: string | null;
  /** Body in reading order. Headings are prefixed with "## ". */
  blocks: string[];
  images: string[];
  charCount: number;
}

const CHROME = "script, style, noscript, iframe, form, svg, nav, header, footer, aside";

const CANDIDATES = [
  "article",
  "main",
  "[role=main]",
  ".post-content",
  ".article-content",
  ".entry-content",
  ".article-body",
  ".post-body",
  ".story-body",
  ".markdown-body",
  ".rich_media_content",
  ".cooked",
  "#main-outlet",
  "#content",
  ".content",
];

/** Container used when no candidate scores: still better than returning nothing. */
const BODY_REF: ContainerRef = { selector: "body", index: 0 };

const BLOCK_SELECTOR = "h2, h3, p, li, blockquote, pre";

interface ContainerRef {
  selector: string;
  index: number;
}

/** Below this the extraction is assumed to have hit a paywall or a bot wall. */
const MIN_CHAR_COUNT = 400;

const MIN_PROSE_LEN = 15;
const MIN_LIST_LEN = 8;
const MIN_IMAGE_EDGE = 200;

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

const HEADERS: Record<string, string> = {
  "User-Agent": UA,
  Accept: "text/html,application/xhtml+xml,*/*",
  "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
};

function normalize(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function absolute(src: string | undefined, base: string): string | null {
  const value = src?.trim();
  if (!value || value.startsWith("data:")) return null;
  try {
    return new URL(value, base).toString();
  } catch {
    return null;
  }
}

function metaContent(
  $: cheerio.CheerioAPI,
  selectors: string[],
): string | null {
  for (const selector of selectors) {
    const value = $(selector).first().attr("content")?.trim();
    if (value) return value;
  }
  return null;
}

/**
 * The best container is returned as a (selector, index) pair rather than the
 * Cheerio wrapper so the callers never have to name cheerio's generic
 * element type.
 */
function pickContainer($: cheerio.CheerioAPI): ContainerRef | null {
  let best: ContainerRef | null = null;
  let bestDensity = 0;
  for (const selector of CANDIDATES) {
    $(selector).each((index, el) => {
      const node = $(el);
      const density =
        node.find("p").text().length + node.find("h2, h3").text().length;
      if (density > bestDensity) {
        bestDensity = density;
        best = { selector, index };
      }
    });
  }
  return best;
}

function extractBlocks($: cheerio.CheerioAPI, ref: ContainerRef): string[] {
  const blocks: string[] = [];
  // Inside <body> the page is unfiltered, so list items are navigation
  // fragments far more often than article content.
  const selector =
    ref.selector === "body" ? "h2, h3, p, blockquote, pre" : BLOCK_SELECTOR;
  $(ref.selector)
    .eq(ref.index)
    .find(selector)
    .each((_, el) => {
    const node = $(el);
    const tag = el.tagName?.toLowerCase() ?? "";
    const text = normalize(node.text());
    if (!text) return;
    const isHeading = tag === "h2" || tag === "h3";
    const minimum = tag === "li" ? MIN_LIST_LEN : MIN_PROSE_LEN;
    if (!isHeading && text.length < minimum) return;
    const block = isHeading ? `## ${text}` : text;
    if (blocks[blocks.length - 1] === block) return;
    blocks.push(block);
  });
  return blocks;
}

function extractImages(
  $: cheerio.CheerioAPI,
  ref: ContainerRef,
  base: string,
): string[] {
  const images: string[] = [];
  $(ref.selector)
    .eq(ref.index)
    .find("img")
    .each((_, el) => {
    const node = $(el);
    const width = Number(node.attr("width") ?? 0);
    const height = Number(node.attr("height") ?? 0);
    if (width && height && (width < MIN_IMAGE_EDGE || height < MIN_IMAGE_EDGE)) {
      return;
    }
    const src =
      absolute(node.attr("src"), base) ?? absolute(node.attr("data-src"), base);
    if (src && !images.includes(src)) images.push(src);
  });
  return images;
}

export function extractArticle(html: string, url: string): ArticleBody {
  const $ = cheerio.load(html);
  const ogImage = absolute(
    metaContent($, [
      'meta[property="og:image"]',
      'meta[name="twitter:image"]',
    ]) ?? undefined,
    url,
  );
  const title =
    metaContent($, ['meta[property="og:title"]']) ||
    normalize($("h1").first().text());

  const pageTitle = normalize($("title").first().text());
  const resolvedTitle = title || pageTitle || new URL(url).hostname;

  $(CHROME).remove();
  const container = pickContainer($) ?? BODY_REF;
  const blocks = extractBlocks($, container);
  const images = extractImages($, container, url);
  const charCount = blocks.reduce((sum, b) => sum + b.length, 0);

  if (charCount < MIN_CHAR_COUNT) {
    const readable = normalize($("body").text()).length;
    const reason =
      readable < 300
        ? "页面可读文本极少，疑似反爬拦截或挑战页"
        : blocks.length === 0
          ? "页面有文本但不在段落结构中，疑似 JS 渲染或非文章页"
          : "正文过短，疑似付费墙或摘要页";
    const hint = pageTitle ? `，页面标题「${pageTitle.slice(0, 60)}」` : "";
    throw new ArticleFetchError(
      `${url}: ${reason}（正文 ${charCount} 字 < ${MIN_CHAR_COUNT}${hint}）`,
    );
  }

  return { url, title: resolvedTitle, ogImage, blocks, images, charCount };
}

/**
 * RSS feeds alone are fetched through curl when a proxy is set (see
 * lib/sources/rss.ts); article pages need the same treatment because the
 * overseas sources this project tracks are routinely TLS-fingerprinted.
 */
export async function fetchArticleBody(url: string): Promise<ArticleBody> {
  let html: string;
  try {
    if (proxyConfigured()) {
      html = await curlFetch(url, HEADERS, 25);
    } else {
      const response = await fetch(url, {
        headers: HEADERS,
        signal: AbortSignal.timeout(25_000),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      html = await response.text();
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new ArticleFetchError(`${url}: 抓取失败 — ${message}`);
  }
  return extractArticle(html, url);
}
