import fs from "node:fs";
import path from "node:path";

import { getModelTag } from "../ai/llm";
import type { ArticleBody } from "./article-body";
import {
  PLATFORM_IDS,
  getPieceType,
  getPlatform,
  resolveShape,
} from "./platforms";
import type { Platform } from "./platforms";
import { reviewDraft } from "./review";
import type { Finding, ReviewReport } from "./review";

/**
 * On-disk layout of the drafts written for one day, and the review that checks
 * them against the material they were written from.
 *
 * Two kinds of draft share a date: `wechat/<slug>/` written from a single
 * fetched article (material in the root `bodies.json`), and `pieces/<slug>/`
 * written from several sources or from the day's briefs (material in that
 * slug's `materials.json`). A draft whose material is gone cannot be
 * fact-checked, so it is reported as a failure rather than reviewed for
 * mechanics alone.
 */

export const REPORTS_DIR = "daily_reports";
/** Material files a draft directory may carry beside the platform-named ones. */
const MATERIAL_STEMS = ["materials", "picks", "bodies"];

export interface DraftMeta {
  title: string;
  platform: string;
  /** Draft kind, which selects the length and structure targets review applies. */
  piece: string;
  /** Set for a single-source rewrite; names the entry in `bodies.json`. */
  source_url?: string;
}

export interface ReviewRoot {
  dir: string;
  label: string;
  /** Single-source material, keyed by article url. Empty for `pieces/`. */
  bodies: Record<string, ArticleBody>;
}

export interface StoredReview extends ReviewReport {
  date: string;
  slug: string;
  title: string;
  model: string;
  reviewed_at: string;
}

export interface ReviewRequest {
  dir: string;
  date: string;
  root: ReviewRoot;
  slug: string;
  platform: Platform;
  force: boolean;
}

export interface ReviewHit {
  status: "reviewed" | "skipped" | "revise";
  /** Absolute path of `<platform>.review.json`. */
  reviewPath: string;
  report: ReviewReport | null;
}

function readJson<T>(file: string): T {
  return JSON.parse(fs.readFileSync(file, "utf8")) as T;
}

function clip(text: string, max: number): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max)}…` : flat;
}

/** Drafts are stored as `# 标题` followed by the body written for the platform. */
export function stripTitle(markdown: string): string {
  const lines = markdown.split("\n");
  if (!lines[0]?.startsWith("# ")) {
    throw new Error("草稿首行不是 `# 标题`，无法定位正文。");
  }
  return lines.slice(1).join("\n").trim();
}

/**
 * Material a `pieces/` draft was written from.
 *
 * `materials.json` stores the blocks exactly as they entered the writing
 * prompt, so review sees the same truncation the writer did.
 */
export function readPieceMaterial(articleDir: string, label: string): string[] {
  const file = path.join(articleDir, "materials.json");
  if (!fs.existsSync(file)) {
    throw new Error(`${label}：缺少 ${file}，无法核对事实`);
  }
  const parsed = readJson<{ blocks?: unknown }>(file);
  if (!Array.isArray(parsed.blocks) || parsed.blocks.length === 0) {
    throw new Error(`${file} 里没有 blocks 数组，无法核对事实。`);
  }
  const blocks = parsed.blocks.filter((b): b is string => typeof b === "string");
  if (blocks.length !== parsed.blocks.length) {
    throw new Error(`${file} 的 blocks 含非字符串条目。`);
  }
  return blocks;
}

/**
 * Platforms that have a draft in this directory.
 *
 * Any other `.json` is an error: a typo in the file name would otherwise look
 * like a draft that simply has nothing to review.
 */
export function listDraftPlatforms(articleDir: string, label: string): Platform[] {
  const platforms: Platform[] = [];
  for (const file of fs.readdirSync(articleDir).sort()) {
    if (!file.endsWith(".json")) continue;
    const stem = file.slice(0, -".json".length);
    if (stem.endsWith(".review")) continue;
    if (PLATFORM_IDS.some((id) => id === stem)) {
      platforms.push(getPlatform(stem));
      continue;
    }
    if (MATERIAL_STEMS.includes(stem)) continue;
    throw new Error(`${label}：无法识别的文件 ${file}，草稿文件名必须是平台 id`);
  }
  return platforms;
}

/** Draft roots present for a date, in the order the CLI reports them. */
export function listReviewRoots(dir: string, date: string): ReviewRoot[] {
  const roots: ReviewRoot[] = [];
  const wechatDir = path.join(dir, date, "wechat");
  if (fs.existsSync(wechatDir)) {
    const bodiesPath = path.join(wechatDir, "bodies.json");
    if (!fs.existsSync(bodiesPath)) {
      throw new Error(`找不到 ${bodiesPath}，无法核对事实。`);
    }
    roots.push({
      dir: wechatDir,
      label: "wechat",
      bodies: readJson<Record<string, ArticleBody>>(bodiesPath),
    });
  }
  const piecesDir = path.join(dir, date, "pieces");
  if (fs.existsSync(piecesDir)) {
    roots.push({ dir: piecesDir, label: "pieces", bodies: {} });
  }
  if (roots.length === 0) {
    throw new Error(
      `找不到 ${path.join(dir, date, "wechat")} 或 ${piecesDir}。先跑 npm run wechat 或 npm run piece。`,
    );
  }
  return roots;
}

function draftMaterial(
  root: ReviewRoot,
  articleDir: string,
  meta: DraftMeta,
  label: string,
): string[] {
  if (root.label === "pieces") return readPieceMaterial(articleDir, label);
  if (!meta.source_url) {
    throw new Error(`${label}：缺少 source_url，无法定位原文`);
  }
  const body = root.bodies[meta.source_url];
  if (!body) {
    throw new Error(`${label}：bodies.json 里没有 ${meta.source_url}，无法核对事实`);
  }
  return body.blocks;
}

/**
 * Review one draft and store the verdict beside it.
 *
 * The material is read from disk every time: a review that ran against a cached
 * copy could pass a draft the writer had already regenerated.
 */
export async function reviewDraftAt(req: ReviewRequest): Promise<ReviewHit> {
  const articleDir = path.join(req.root.dir, req.slug);
  const reviewPath = path.join(articleDir, `${req.platform.id}.review.json`);
  const label = `${req.root.label}/${req.slug}/${req.platform.id}`;
  if (fs.existsSync(reviewPath) && !req.force) {
    return { status: "skipped", reviewPath, report: null };
  }
  const meta = readJson<DraftMeta>(path.join(articleDir, `${req.platform.id}.json`));
  if (typeof meta.piece !== "string") {
    throw new Error(`${label}：${req.platform.id}.json 缺少 piece 字段，重新生成草稿`);
  }
  const shape = resolveShape(req.platform.id, getPieceType(meta.piece));
  const mdPath = path.join(articleDir, `${req.platform.id}.md`);
  if (!fs.existsSync(mdPath)) {
    throw new Error(`${label}：缺少草稿 ${mdPath}`);
  }
  const report = await reviewDraft({
    shape,
    markdown: stripTitle(fs.readFileSync(mdPath, "utf8")),
    blocks: draftMaterial(req.root, articleDir, meta, label),
  });
  const stored: StoredReview = {
    ...report,
    date: req.date,
    slug: req.slug,
    title: meta.title,
    model: getModelTag(),
    reviewed_at: new Date().toISOString(),
  };
  fs.writeFileSync(reviewPath, `${JSON.stringify(stored, null, 2)}\n`, "utf8");
  return {
    status: report.verdict === "pass" ? "reviewed" : "revise",
    reviewPath,
    report,
  };
}

function findingLine(finding: Finding): string {
  const quote = `「${clip(finding.quote, 50)}」${finding.problem}`;
  return finding.evidence
    ? `${finding.severity.padEnd(6)}${quote}（依据：${clip(finding.evidence, 90)}）`
    : `${finding.severity.padEnd(6)}${quote}`;
}

/** One line per finding, shared by the CLI output and the admin page log. */
export function describeFindings(report: ReviewReport): string[] {
  return [...report.mechanical, ...report.facts].map(findingLine);
}
