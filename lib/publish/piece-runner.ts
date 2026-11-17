import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { getModelTag } from "../ai/llm";
import type { BriefItem } from "../ai/pipeline";
import { readArticles, readReport } from "../output/store";
import { ArticleFetchError, fetchArticleBody } from "./article-body";
import type { ArticleBody } from "./article-body";
import {
  MAX_FIGURES,
  collectImageUrls,
  downloadAssets,
  rewriteImageRefs,
} from "./assets";
import type { Asset } from "./assets";
import { collectDigestItems, writeDigestDraft } from "./digest";
import type { DigestItem } from "./digest";
import { reviewDraftAt } from "./drafts";
import type { ReviewRoot } from "./drafts";
import { resolvePicks } from "./picks";
import { getPlatform, resolveShape } from "./platforms";
import type { DraftShape, PieceType } from "./platforms";
import type { ReviewReport } from "./review";
import { writeTopicDraft } from "./topic";
import type { TopicSource } from "./topic";

/**
 * Write one aggregated piece: a theme article over several chosen articles, or
 * a roundup over the day's briefs.
 *
 * Both the CLI (`npm run piece`) and the admin page run this, so the file
 * layout, the material handed to review and the warnings are identical no
 * matter which entry point the operator used.
 *
 * A failed fetch aborts the whole piece: a theme article written from five of
 * six sources argues from material the operator did not choose, and a roundup
 * that dropped an item silently looks complete.
 */

const PLATFORM = getPlatform("wechat");

export interface PieceRequest {
  /** Report tree root, normally `daily_reports`. */
  dir: string;
  date: string;
  kind: Exclude<PieceType, "article">;
  /** Subject for a theme article. */
  topic?: string;
  /** Categories for a roundup. */
  categories?: string[];
  /** Title substrings or urls selecting the theme article's sources. */
  queries?: string[];
  /** Rewrite a piece that already exists on disk. */
  force?: boolean;
  /** Review the draft right after writing it. */
  review?: boolean;
}

export interface PieceMeta {
  title: string;
  platform: string;
  platform_label: string;
  piece: PieceType;
  words: number;
  model: string;
  duration_ms: number;
  sources: Array<{ title: string; source: string | null; url: string }>;
  /** Present for a theme article. */
  topic?: string;
  /** Present for a roundup. */
  categories?: string[];
  images: Asset[];
  warnings: string[];
  created_at: string;
  /** 最近一次推进草稿箱的结果；再次推送走 draft/update。 */
  draft?: {
    media_id: string;
    theme: string;
    thumb_media_id: string;
    pushed_at: string;
  };
}

export interface MaterialsFile {
  kind: PieceType;
  generated_at: string;
  /** Material blocks exactly as they entered the writing prompt. */
  blocks: string[];
  sources: Array<{ title: string; source: string | null; url: string }>;
  truncated: number[];
}

export interface PieceResult {
  slug: string;
  articleDir: string;
  markdownPath: string;
  meta: PieceMeta;
  markdown: string;
  review: ReviewReport | null;
  warnings: string[];
}

export type PieceOutcome =
  | { skipped: true; slug: string; markdownPath: string }
  | { skipped: false; result: PieceResult };

export interface PieceHooks {
  /** Current step, for a progress label. */
  onStage?: (stage: string) => void;
  /** One progress line. */
  onLog?: (line: string) => void;
}

/** Readable slug from the subject, plus a fingerprint so two subjects never collide. */
export function topicSlug(topic: string): string {
  const readable = topic
    .replace(/[^\p{Letter}\p{Number}]+/gu, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 20);
  const digest = crypto.createHash("sha1").update(topic).digest("hex").slice(0, 6);
  return `topic-${readable || "untitled"}-${digest}`;
}

export function pieceDir(dir: string, date: string, slug: string): string {
  return path.join(dir, date, "pieces", slug);
}

function loadCache<T>(file: string): T | null {
  return fs.existsSync(file) ? (JSON.parse(fs.readFileSync(file, "utf8")) as T) : null;
}

function writePiece(
  articleDir: string,
  shape: DraftShape,
  meta: Omit<PieceMeta, "platform" | "platform_label" | "piece" | "model" | "created_at">,
  markdown: string,
  materials: MaterialsFile,
): PieceMeta {
  const output: PieceMeta = {
    ...meta,
    platform: shape.platform,
    platform_label: PLATFORM.label,
    piece: shape.piece,
    model: getModelTag(),
    created_at: new Date().toISOString(),
  };
  fs.writeFileSync(
    path.join(articleDir, `${PLATFORM.id}.md`),
    `# ${meta.title}\n\n${markdown}\n`,
    "utf8",
  );
  fs.writeFileSync(
    path.join(articleDir, `${PLATFORM.id}.json`),
    `${JSON.stringify(output, null, 2)}\n`,
    "utf8",
  );
  fs.writeFileSync(
    path.join(articleDir, "materials.json"),
    `${JSON.stringify(materials, null, 2)}\n`,
    "utf8",
  );
  return output;
}

async function fetchMissingBodies(
  picked: Array<{ title: string; url: string; source: string }>,
  bodiesPath: string,
  cached: Record<string, ArticleBody>,
  hooks: PieceHooks,
): Promise<Record<string, ArticleBody>> {
  const bodies = { ...cached };
  for (const article of picked) {
    if (bodies[article.url]) continue;
    try {
      bodies[article.url] = await fetchArticleBody(article.url);
    } catch (error) {
      const message =
        error instanceof ArticleFetchError
          ? error.message
          : error instanceof Error
            ? error.message
            : String(error);
      throw new Error(`抓取失败，未写作：${article.title} — ${message}`);
    }
    fs.writeFileSync(bodiesPath, `${JSON.stringify(bodies, null, 2)}\n`, "utf8");
    hooks.onLog?.(`取回正文：${article.title}（${bodies[article.url].charCount} 字）`);
  }
  return bodies;
}

async function runTopic(
  req: PieceRequest & { topic: string; queries: string[] },
  hooks: PieceHooks,
): Promise<PieceOutcome> {
  const shape = resolveShape(PLATFORM.id, "topic");
  const slug = topicSlug(req.topic);
  const articleDir = pieceDir(req.dir, req.date, slug);
  const markdownPath = path.join(articleDir, `${PLATFORM.id}.md`);
  if (fs.existsSync(markdownPath) && !req.force) {
    return { skipped: true, slug, markdownPath };
  }

  hooks.onStage?.("选稿");
  const articles = readArticles(req.dir, req.date);
  const { picked, problems } = resolvePicks(articles, req.queries);
  if (problems.length > 0) {
    throw new Error(`选稿有问题，未执行：\n\n${problems.join("\n\n")}`);
  }
  if (picked.length === 0) throw new Error("没有解析出任何条目。");

  fs.mkdirSync(articleDir, { recursive: true });
  hooks.onStage?.("抓取正文");
  const bodiesPath = path.join(articleDir, "bodies.json");
  const bodies = await fetchMissingBodies(
    picked,
    bodiesPath,
    loadCache<Record<string, ArticleBody>>(bodiesPath) ?? {},
    hooks,
  );

  const sources: TopicSource[] = picked.map((article) => {
    const body = bodies[article.url];
    return { title: article.title, source: article.source, url: article.url, blocks: body.blocks };
  });

  hooks.onStage?.("下载配图");
  // Each source may contribute a few figures; the merged set stays within the
  // per-article limit so the prompt's IMG list remains truthful.
  const figureUrls = [
    ...new Set(sources.flatMap((s) => collectImageUrls(bodies[s.url], 3))),
  ].slice(0, MAX_FIGURES);
  const { assets, warnings: assetWarnings } = await downloadAssets(
    figureUrls,
    path.join(articleDir, "assets"),
    "assets",
    sources[0].url,
  );

  hooks.onStage?.("写作");
  const draft = await writeTopicDraft(shape, {
    topic: req.topic,
    sources,
    assets,
  });
  const material: MaterialsFile = {
    kind: "topic",
    generated_at: new Date().toISOString(),
    blocks: [draft.material.text],
    sources: sources.map((s) => ({ title: s.title, source: s.source, url: s.url })),
    truncated: draft.material.truncated,
  };
  const warnings = [...assetWarnings, ...draft.warnings];
  const meta = writePiece(
    articleDir,
    shape,
    {
      title: draft.title,
      words: draft.words,
      duration_ms: draft.durationMs,
      sources: material.sources,
      topic: req.topic,
      images: assets,
      warnings,
    },
    rewriteImageRefs(draft.markdown, assets),
    material,
  );
  hooks.onLog?.(
    `${slug} → ${draft.words} 字 · ${sources.length} 篇材料 · ${assets.length} 图 · ${draft.durationMs}ms`,
  );

  const review = req.review
    ? await reviewPiece(req.dir, req.date, slug, hooks)
    : null;
  return {
    skipped: false,
    result: { slug, articleDir, markdownPath, meta, markdown: draft.markdown, review, warnings },
  };
}

async function runDigest(
  req: PieceRequest & { categories: string[] },
  hooks: PieceHooks,
): Promise<PieceOutcome> {
  const shape = resolveShape(PLATFORM.id, "digest");
  const slug = `digest-${req.date}`;
  const articleDir = pieceDir(req.dir, req.date, slug);
  const markdownPath = path.join(articleDir, `${PLATFORM.id}.md`);
  if (fs.existsSync(markdownPath) && !req.force) {
    return { skipped: true, slug, markdownPath };
  }

  hooks.onStage?.("选条");
  const report = readReport(req.dir, req.date);
  const { items, warnings: selectionWarnings } = collectDigestItems(
    report.briefs,
    req.categories,
  );
  fs.mkdirSync(articleDir, { recursive: true });

  hooks.onStage?.("写作");
  const draft = await writeDigestDraft(shape, items);
  const sources = items.map((item: BriefItem) => ({
    title: item.title,
    source: item.source,
    url: item.url,
  }));
  const material: MaterialsFile = {
    kind: "digest",
    generated_at: new Date().toISOString(),
    blocks: [draft.material.text],
    sources,
    truncated: [],
  };
  const warnings = [...selectionWarnings, ...draft.warnings];
  const meta = writePiece(
    articleDir,
    shape,
    {
      title: draft.title,
      words: draft.words,
      duration_ms: draft.durationMs,
      sources,
      categories: req.categories,
      images: [],
      warnings,
    },
    draft.markdown,
    material,
  );
  hooks.onLog?.(
    `${slug} → ${draft.words} 字 · ${items.length} 条 · ${draft.durationMs}ms`,
  );

  const review = req.review
    ? await reviewPiece(req.dir, req.date, slug, hooks)
    : null;
  return {
    skipped: false,
    result: { slug, articleDir, markdownPath, meta, markdown: draft.markdown, review, warnings },
  };
}

/** Review a just-written piece; a review failure must not discard the draft. */
async function reviewPiece(
  dir: string,
  date: string,
  slug: string,
  hooks: PieceHooks,
): Promise<ReviewReport | null> {
  hooks.onStage?.("审阅");
  const root: ReviewRoot = {
    dir: path.join(dir, date, "pieces"),
    label: "pieces",
    bodies: {},
  };
  try {
    const hit = await reviewDraftAt({
      dir,
      date,
      root,
      slug,
      platform: PLATFORM,
      force: true,
    });
    if (hit.report) {
      hooks.onLog?.(
        `审阅：${hit.report.verdict}（机械 ${hit.report.mechanical.length} · 事实 ${hit.report.facts.length}）`,
      );
    }
    return hit.report;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    hooks.onLog?.(`审阅失败（草稿已保存）：${message}`);
    return null;
  }
}

export async function runPiece(
  req: PieceRequest,
  hooks: PieceHooks = {},
): Promise<PieceOutcome> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(req.date)) {
    throw new Error(`日期必须是 YYYY-MM-DD，收到 '${req.date}'`);
  }
  if (req.kind === "topic") {
    const topic = req.topic?.trim();
    if (!topic) throw new Error("主题稿需要 --topic=。");
    const queries = req.queries ?? [];
    if (queries.length === 0) throw new Error("主题稿至少需要一个 <url|标题子串>。");
    return runTopic({ ...req, topic, queries }, hooks);
  }
  const categories = (req.categories ?? []).map((c) => c.trim()).filter(Boolean);
  if (categories.length === 0) throw new Error("资讯汇总需要 --category=。");
  return runDigest({ ...req, categories }, hooks);
}

export interface PieceSummary {
  slug: string;
  title: string;
  piece: PieceType;
  words: number;
  created_at: string;
  /** Verdict from the stored review, when one has run. */
  verdict: string | null;
  /** Present when the draft could not be parsed. */
  error?: string;
}

/** Pieces already on disk for a date, newest first, with their verdicts. */
export function listPieces(dir: string, date: string): PieceSummary[] {
  const piecesDir = path.join(dir, date, "pieces");
  if (!fs.existsSync(piecesDir)) return [];
  const summaries: PieceSummary[] = [];
  for (const slug of fs.readdirSync(piecesDir).sort()) {
    const articleDir = path.join(piecesDir, slug);
    if (!fs.statSync(articleDir).isDirectory()) continue;
    const metaPath = path.join(articleDir, `${PLATFORM.id}.json`);
    if (!fs.existsSync(metaPath)) continue;
    try {
      const meta = JSON.parse(fs.readFileSync(metaPath, "utf8")) as PieceMeta;
      const reviewPath = path.join(articleDir, `${PLATFORM.id}.review.json`);
      const verdict = fs.existsSync(reviewPath)
        ? (JSON.parse(fs.readFileSync(reviewPath, "utf8")) as ReviewReport).verdict
        : null;
      summaries.push({
        slug,
        title: meta.title,
        piece: meta.piece,
        words: meta.words,
        created_at: meta.created_at,
        verdict,
      });
    } catch (error) {
      summaries.push({
        slug,
        title: slug,
        piece: "topic",
        words: 0,
        created_at: "",
        verdict: null,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return summaries.reverse();
}

export interface PieceDetail {
  slug: string;
  markdown: string;
  meta: PieceMeta;
  review: ReviewReport | null;
}

/** One stored piece, with its review verdict when one has run. */
export function readPieceDetail(dir: string, date: string, slug: string): PieceDetail | null {
  const articleDir = pieceDir(dir, date, slug);
  const markdownPath = path.join(articleDir, `${PLATFORM.id}.md`);
  const metaPath = path.join(articleDir, `${PLATFORM.id}.json`);
  if (!fs.existsSync(markdownPath) || !fs.existsSync(metaPath)) return null;
  const reviewPath = path.join(articleDir, `${PLATFORM.id}.review.json`);
  return {
    slug,
    markdown: fs.readFileSync(markdownPath, "utf8"),
    meta: JSON.parse(fs.readFileSync(metaPath, "utf8")) as PieceMeta,
    review: fs.existsSync(reviewPath)
      ? (JSON.parse(fs.readFileSync(reviewPath, "utf8")) as ReviewReport)
      : null,
  };
}
