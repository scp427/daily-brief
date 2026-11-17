import "./_env";

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { getModelTag } from "../lib/ai/llm";
import { ArticleFetchError, fetchArticleBody } from "../lib/publish/article-body";
import type { ArticleBody } from "../lib/publish/article-body";
import { collectImageUrls, downloadAssets, rewriteImageRefs } from "../lib/publish/assets";
import type { Asset } from "../lib/publish/assets";
import { resolvePicks } from "../lib/publish/picks";
import { getPlatform, parsePlatformList, resolveShape } from "../lib/publish/platforms";
import type { DraftShape, Platform, PieceType } from "../lib/publish/platforms";
import { writeDraft } from "../lib/publish/write";
import { todayKey } from "../lib/utils";

const REPORTS_DIR = "daily_reports";

/**
 * Materialise the day's operator-selected articles and write one draft per
 * requested platform.
 *
 * Selection is manual by design: the operator browses the day's report and
 * passes URLs (or unambiguous title substrings). Bodies and figures are
 * cached inside the article directory, so re-running with another platform
 * costs one LLM call and no refetching.
 *
 * Usage:
 *   npm run wechat -- <url-or-title-substring>... [--platform=wechat,weibo]
 *   npm run wechat -- 2026-11-16 <url-or-title-substring>... [--force]
 *
 * Output per article under daily_reports/<date>/wechat/<slug>/:
 *   <platform>.md     — draft for review
 *   <platform>.json   — title, word count, model, figures, warnings
 *   assets/           — downloaded figures referenced from the draft
 */

interface SidecarArticle {
  title: string;
  url: string;
  source?: string;
  summary?: string;
  excerpt?: string;
  category?: string;
}

interface DraftMeta {
  title: string;
  platform: string;
  platform_label: string;
  piece: PieceType;
  words: number;
  model: string;
  duration_ms: number;
  source_title: string;
  source_url: string;
  source_name: string | null;
  images: Asset[];
  warnings: string[];
  created_at: string;
}

function isDateKey(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function loadSidecar(date: string): SidecarArticle[] {
  const file = path.join(REPORTS_DIR, date, `${date}-articles.json`);
  if (!fs.existsSync(file)) {
    throw new Error(
      `找不到 ${file}。先跑当天的主流程（npm run daily）再选稿。`,
    );
  }
  const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as {
    articles?: SidecarArticle[];
  };
  if (!Array.isArray(parsed.articles) || parsed.articles.length === 0) {
    throw new Error(`${file} 里没有 articles 数组或为空。`);
  }
  return parsed.articles;
}

function loadBodies(file: string): Record<string, ArticleBody> {
  if (!fs.existsSync(file)) return {};
  return JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, ArticleBody>;
}

/** Stable per-article directory name: readable source plus a URL fingerprint. */
function articleSlug(article: SidecarArticle): string {
  let host = "article";
  try {
    host = new URL(article.url).hostname.replace(/^www\./, "");
  } catch {
    // Keep the fallback host so the directory name stays printable.
  }
  const prefix = host.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "");
  const digest = crypto.createHash("sha1").update(article.url).digest("hex").slice(0, 6);
  return `${prefix || "article"}-${digest}`;
}

function printBodySummary(body: ArticleBody, cached: boolean): void {
  const flag = cached ? "（缓存）" : "";
  console.log(
    `\n— ${body.title}${flag}\n  ${body.charCount} 字 · ${body.blocks.length} 块 · ${body.images.length} 张正文图 · og:image ${body.ogImage ? "有" : "无"}\n  ${body.blocks[0]?.slice(0, 90) ?? ""}`,
  );
}

async function writeOne(
  article: SidecarArticle,
  body: ArticleBody,
  platform: Platform,
  articleDir: string,
  force: boolean,
): Promise<boolean> {
  const shape: DraftShape = resolveShape(platform.id, "article");
  const mdPath = path.join(articleDir, `${platform.id}.md`);
  if (fs.existsSync(mdPath) && !force) {
    console.log(`  ${platform.label}：已存在 ${mdPath}（加 --force 重写）`);
    return false;
  }

  const { assets, warnings: assetWarnings } = await downloadAssets(
    collectImageUrls(body),
    path.join(articleDir, "assets"),
    "assets",
    body.url,
  );
  const draft = await writeDraft(shape, {
    title: body.title,
    source: article.source ?? null,
    url: body.url,
    blocks: body.blocks,
    assets,
  });
  const markdown = rewriteImageRefs(draft.markdown, assets);
  const warnings = [...assetWarnings, ...draft.warnings];

  fs.writeFileSync(mdPath, `# ${draft.title}\n\n${markdown}\n`, "utf8");
  const meta: DraftMeta = {
    title: draft.title,
    platform: platform.id,
    platform_label: platform.label,
    piece: shape.piece,
    words: draft.words,
    model: getModelTag(),
    duration_ms: draft.durationMs,
    source_title: body.title,
    source_url: body.url,
    source_name: article.source ?? null,
    images: assets,
    warnings,
    created_at: new Date().toISOString(),
  };
  fs.writeFileSync(
    path.join(articleDir, `${platform.id}.json`),
    JSON.stringify(meta, null, 2),
    "utf8",
  );

  console.log(
    `  ${platform.label}：${draft.words} 字 · ${assets.length} 图 · ${draft.durationMs}ms · ${mdPath}`,
  );
  for (const warning of warnings) console.log(`    ! ${warning}`);
  return true;
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const dateFromArgs = argv.find(isDateKey);
  const date = dateFromArgs ?? todayKey();
  const platformArg = argv.find((a) => a.startsWith("--platform="));
  const force = argv.includes("--force");
  const unknownFlags = argv.filter(
    (a) => a.startsWith("--") && a !== "--force" && !a.startsWith("--platform="),
  );
  if (unknownFlags.length > 0) {
    throw new Error(
      `未知参数：${unknownFlags.join(" ")}\n用法：npm run wechat -- [YYYY-MM-DD] <url|标题子串>... [--platform=wechat,weibo,xiaohongshu] [--force]`,
    );
  }
  const platforms = platformArg
    ? parsePlatformList(platformArg.slice("--platform=".length))
    : [getPlatform("wechat")];
  const queries = argv.filter(
    (a) => a !== dateFromArgs && !a.startsWith("--platform=") && a !== "--force",
  );

  if (queries.length === 0) {
    throw new Error(
      "用法：npm run wechat -- [YYYY-MM-DD] <url|标题子串>... [--platform=wechat,weibo,xiaohongshu] [--force]\n" +
        `选稿依据当天的 daily_reports/<date>/<date>.html 报告页面。默认平台：wechat。`,
    );
  }

  const articles = loadSidecar(date);
  const { picked, problems } = resolvePicks(articles, queries);
  if (problems.length > 0) {
    // Abort rather than write a partial selection: a pick that silently
    // disappears is exactly the editorial mistake this step must not make.
    throw new Error(`选稿有问题，未执行：\n\n${problems.join("\n\n")}`);
  }
  if (picked.length === 0) throw new Error("没有解析出任何条目。");

  const outDir = path.join(REPORTS_DIR, date, "wechat");
  fs.mkdirSync(outDir, { recursive: true });
  const picksPath = path.join(outDir, "picks.json");
  fs.writeFileSync(
    picksPath,
    JSON.stringify(
      {
        date,
        picked_at: new Date().toISOString(),
        platforms: platforms.map((p) => p.id),
        articles: picked.map((a) => ({
          title: a.title,
          url: a.url,
          source: a.source ?? null,
          category: a.category ?? null,
        })),
      },
      null,
      2,
    ),
    "utf8",
  );

  const bodiesPath = path.join(outDir, "bodies.json");
  const bodies = loadBodies(bodiesPath);
  const failures: string[] = [];

  console.log(
    `[wechat] ${date} — 选中 ${picked.length} 条，平台：${platforms.map((p) => p.label).join(" / ")}`,
  );
  for (const [index, article] of picked.entries()) {
    const label = `[${index + 1}/${picked.length}] ${article.title}`;
    let body = bodies[article.url];
    if (!body) {
      try {
        body = await fetchArticleBody(article.url);
        bodies[article.url] = body;
        // Persist per article so a later failure does not discard earlier work.
        fs.writeFileSync(bodiesPath, JSON.stringify(bodies, null, 2), "utf8");
        console.log(`\n${label}`);
        printBodySummary(body, false);
      } catch (error) {
        const message =
          error instanceof ArticleFetchError
            ? error.message
            : error instanceof Error
              ? error.message
              : String(error);
        failures.push(`${article.title} — ${message}`);
        console.error(`\n✗ ${label}\n  ${message}`);
        continue;
      }
    } else {
      console.log(`\n${label}`);
      printBodySummary(body, true);
    }

    const articleDir = path.join(outDir, articleSlug(article));
    fs.mkdirSync(articleDir, { recursive: true });
    try {
      for (const platform of platforms) {
        await writeOne(article, body, platform, articleDir, force);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      failures.push(`${article.title} — 写作失败：${message}`);
      console.error(`  ✗ 写作失败：${message}`);
    }
  }

  console.log(
    `\n[wechat] picks → ${picksPath}\n[wechat] bodies → ${bodiesPath}（${Object.keys(bodies).length} 条已缓存）\n[wechat] 草稿 → ${outDir}/<source-slug>/<platform>.md`,
  );
  if (failures.length > 0) {
    throw new Error(
      `${failures.length} 处失败：\n  · ${failures.join("\n  · ")}`,
    );
  }
}

main().catch((error) => {
  console.error(`[wechat] FAILED:`, error instanceof Error ? error.message : error);
  process.exit(1);
});
