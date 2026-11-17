/**
 * 公众号预览：把已生成的草稿渲染成推送时的 HTML，图片内联成 data URL。
 *
 * 推送时图片必须换成微信自己的 url，预览拿不到那个 url，所以这里用 data URL
 * 把同一份 HTML 的渲染结果本地呈现出来；超大的图不入内联，改由调用方提示。
 */

import fs from "node:fs";
import path from "node:path";

import { pieceDir, readPieceDetail } from "./piece-runner";
import { getWechatTheme, renderWechatHtml } from "./wechat-html";

/** 单图超过这个体积就不内联，预览里留空并记入 `skipped`。 */
export const MAX_INLINE_IMAGE_BYTES = 1_500_000;

const MIME: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".gif": "image/gif",
  ".webp": "image/webp",
};

export interface WechatPreview {
  theme: string;
  title: string;
  html: string;
  /** md 里的相对路径 → data URL。 */
  images: Record<string, string>;
  /** 拿不到或超过内联上限的图。 */
  skipped: string[];
}

export interface PreviewInput {
  dir: string;
  date: string;
  slug: string;
  /** 空表示按稿型选：主题稿用刊物版，汇总稿用简报版。 */
  theme?: string;
}

export function buildWechatPreview(input: PreviewInput): WechatPreview {
  const detail = readPieceDetail(input.dir, input.date, input.slug);
  if (!detail) {
    throw new Error(`没有找到稿件 ${input.slug}（${input.date}）`);
  }
  const theme = getWechatTheme(
    input.theme ?? (detail.meta.piece === "digest" ? "brief" : "journal"),
  );
  const articleDir = pieceDir(input.dir, input.date, input.slug);
  const images: Record<string, string> = {};
  const skipped: string[] = [];

  const resolveImage = (target: string): string => {
    const cached = images[target];
    if (cached !== undefined) return cached;
    const file = path.join(articleDir, target);
    const mime = MIME[path.extname(file).toLowerCase()];
    if (!fs.existsSync(file) || mime === undefined) {
      skipped.push(target);
      return "";
    }
    if (fs.statSync(file).size > MAX_INLINE_IMAGE_BYTES) {
      skipped.push(target);
      return "";
    }
    const data = `data:${mime};base64,${fs.readFileSync(file).toString("base64")}`;
    images[target] = data;
    return data;
  };

  // 文稿第一行是 `# 标题`，标题在 meta 里单独给出，正文从第二段开始。
  const body = detail.markdown.replace(/^#\s+.*\n+/, "");
  return {
    theme: theme.id,
    title: detail.meta.title,
    html: renderWechatHtml({ markdown: body, theme, resolveImage }),
    images,
    skipped,
  };
}
