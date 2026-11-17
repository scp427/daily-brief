/**
 * Fetch and localise the figures that go with a draft.
 *
 * Figures live in the same directory tree as the draft and are referenced by
 * relative path: every target platform re-uploads images from local files, so
 * an external URL in the markdown is a broken image everywhere.
 */

import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";

import type { ArticleBody } from "./article-body";

const execFileP = promisify(execFile);

/** Figures kept per article; feeds rarely carry more than a handful of usable ones. */
export const MAX_FIGURES = 8;

/** WeChat accepts images up to 5 MB; larger figures need manual compression. */
const PUBLISH_MAX_BYTES = 5 * 1024 * 1024;

const EXTENSION_BY_TYPE: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
};

export interface Asset {
  ref: string;
  sourceUrl: string;
  /** Path relative to the draft directory, e.g. `assets/01.jpg`. */
  relPath: string;
}

export interface AssetResult {
  assets: Asset[];
  warnings: string[];
}

/** Cover image first, then body figures, de-duplicated and capped. */
export function collectImageUrls(body: ArticleBody, max = MAX_FIGURES): string[] {
  const seen = new Set<string>();
  const urls: string[] = [];
  for (const url of [body.ogImage, ...body.images]) {
    if (!url) continue;
    // Two renditions of one original (crop sizes differ) are a single figure.
    const key = originalFromProxy(url) ?? url;
    if (seen.has(key)) continue;
    seen.add(key);
    urls.push(url);
    if (urls.length >= max) break;
  }
  return urls;
}

/** Point every `![alt](IMGn)` at its downloaded file. */
export function rewriteImageRefs(
  markdown: string,
  assets: Asset[],
): string {
  const byRef = new Map(assets.map((a) => [a.ref, a.relPath]));
  return markdown.replace(
    /!\[([^\]]*)\]\((IMG\d+)\)/g,
    (whole, alt: string, ref: string) => {
      const relPath = byRef.get(ref);
      return relPath ? `![${alt}](${relPath})` : whole;
    },
  );
}

// Some CDNs (NPR's brightspot, for one) answer 403 to a curl without a
// User-Agent and serve the rendition only when Referer names the article.
const BROWSER_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

/**
 * Image proxies such as NPR's brightspot serve a rendition from a resize
 * endpoint and keep the untouched original in the `url` query parameter. The
 * resize endpoint rejects direct requests, so the original is the fallback.
 */
export function originalFromProxy(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  const inner = parsed.searchParams.get("url");
  if (!inner) return null;
  if (inner.startsWith("https://")) return inner;
  if (inner.startsWith("http://")) return `https://${inner.slice("http://".length)}`;
  return null;
}

async function downloadOne(
  url: string,
  fileBase: string,
  referer?: string,
): Promise<Asset["relPath"]> {
  const tmp = `${fileBase}.part`;
  const args = ["-fsSL", "-m", "30", "--compressed", "-A", BROWSER_UA];
  if (referer) args.push("-e", referer);
  args.push("-o", tmp, "-w", "%{content_type}", url);
  let stdout: string;
  try {
    ({ stdout } = await execFileP("curl", args, { maxBuffer: 1024 * 1024 }));
  } catch (error) {
    // curl leaves a truncated .part behind on timeout or 4xx; a retry would
    // otherwise read it as a finished download.
    fs.rmSync(tmp, { force: true });
    throw error;
  }
  const contentType = stdout.trim().toLowerCase().split(";")[0];
  const ext = EXTENSION_BY_TYPE[contentType];
  if (!ext) {
    fs.rmSync(tmp, { force: true });
    throw new Error(`不是受支持的图片类型（${contentType || "未知"}）`);
  }
  const finalPath = `${fileBase}.${ext}`;
  fs.renameSync(tmp, finalPath);
  return path.basename(finalPath);
}

export async function downloadAssets(
  urls: string[],
  assetsDir: string,
  assetsRelDir = "assets",
  referer?: string,
): Promise<AssetResult> {
  const assets: Asset[] = [];
  const warnings: string[] = [];
  if (urls.length === 0) return { assets, warnings };
  fs.mkdirSync(assetsDir, { recursive: true });
  for (const [i, url] of urls.entries()) {
    const ref = `IMG${i + 1}`;
    const fileBase = path.join(assetsDir, String(i + 1).padStart(2, "0"));
    const candidates = [url];
    const proxied = originalFromProxy(url);
    if (proxied) candidates.push(proxied);

    let fileName: string | null = null;
    let from = url;
    let lastError = "";
    for (const candidate of candidates) {
      try {
        fileName = await downloadOne(candidate, fileBase, referer);
        from = candidate;
        break;
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error);
      }
    }
    if (!fileName) {
      // A missing figure degrades the piece but does not invalidate the text;
      // the caller prints every warning so nothing is silently dropped.
      warnings.push(`${ref} 下载失败：${lastError}（${url}）`);
      continue;
    }
    assets.push({ ref, sourceUrl: from, relPath: `${assetsRelDir}/${fileName}` });

    const bytes = fs.statSync(path.join(assetsDir, fileName)).size;
    if (bytes > PUBLISH_MAX_BYTES) {
      const mb = (bytes / 1024 / 1024).toFixed(1);
      warnings.push(`${ref} 体积 ${mb}MB 超过公众号 5MB 上限，发布前需压缩`);
    }
  }
  return { assets, warnings };
}
