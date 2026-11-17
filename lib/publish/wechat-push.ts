/**
 * 把一篇已审阅的草稿推进公众号草稿箱。
 *
 * 正文图必须先换成微信自己的 url（草稿箱不认本地路径），封面必须先有
 * thumb_media_id，两项都成功才写草稿；任何一步失败都不留下半成品。
 */

import fs from "node:fs";
import path from "node:path";

import { pieceDir, readPieceDetail } from "./piece-runner";
import type { PieceMeta } from "./piece-runner";
import type { WechatDraftArticle } from "./channels/wechat-mp";
import { getWechatTheme, renderWechatHtml } from "./wechat-html";

/** 推送只需要客户端的这四个方法，测试不必起 HTTP。 */
export interface DraftClient {
  uploadContentImage(file: string): Promise<string>;
  uploadCover(file: string): Promise<string>;
  draftAdd(article: WechatDraftArticle): Promise<string>;
  draftUpdate(mediaId: string, article: WechatDraftArticle): Promise<void>;
}

export interface PushInput {
  dir: string;
  date: string;
  slug: string;
  theme?: string;
  /** 审阅未通过时仍然推送。 */
  force?: boolean;
}

export interface PushResult {
  draftId: string;
  theme: string;
  images: number;
  reused: boolean;
}

const FIGURE = /!\[[^\]]*\]\(([^)\s]+)\)/g;

export function assetTargets(markdown: string): string[] {
  const seen = new Set<string>();
  for (const match of markdown.matchAll(FIGURE)) seen.add(match[1]);
  return [...seen];
}

/** 草稿摘要：第一段正文，去掉 markdown 记号。 */
export function summarize(markdown: string, max = 120): string {
  const first =
    markdown
      .split(/\n{2,}/)
      .map((block) => block.trim())
      .find((block) => block !== "" && !block.startsWith("#") && !block.startsWith("!")) ??
    "";
  const plain = first.replace(/\n/g, "").replace(/\*\*/g, "");
  return plain.length <= max ? plain : `${plain.slice(0, max)}…`;
}

export async function pushWechatDraft(
  input: PushInput,
  client: DraftClient,
  coverPath: string,
): Promise<PushResult> {
  const detail = readPieceDetail(input.dir, input.date, input.slug);
  if (!detail) {
    throw new Error(`没有找到稿件 ${input.slug}（${input.date}）`);
  }
  if (!input.force) {
    const verdict = detail.review?.verdict ?? "missing";
    if (verdict !== "pass") {
      throw new Error(
        verdict === "missing"
          ? `稿件还没有审阅结果，先跑 review 再推送，或加 --force。`
          : `审阅结论是"需要修改"，改完重推，或加 --force。`,
      );
    }
  }

  const articleDir = pieceDir(input.dir, input.date, input.slug);
  const theme = getWechatTheme(
    input.theme ?? (detail.meta.piece === "digest" ? "brief" : "journal"),
  );

  const urls = new Map<string, string>();
  for (const target of assetTargets(detail.markdown)) {
    const file = path.join(articleDir, target);
    if (!fs.existsSync(file)) {
      throw new Error(`正文引用了不存在的图片：${target}`);
    }
    urls.set(target, await client.uploadContentImage(file));
  }

  const body = detail.markdown.replace(/^#\s+.*\n+/, "");
  const content = renderWechatHtml({
    markdown: body,
    theme,
    resolveImage: (target) => urls.get(target) ?? "",
  });

  const previous = detail.meta.draft;
  const thumbMediaId = previous?.thumb_media_id ?? (await client.uploadCover(coverPath));
  const article: WechatDraftArticle = {
    title: detail.meta.title,
    digest: summarize(body),
    content,
    thumb_media_id: thumbMediaId,
  };

  const reused = previous !== undefined;
  const draftId = reused
    ? (await client.draftUpdate(previous.media_id, article), previous.media_id)
    : await client.draftAdd(article);

  const meta: PieceMeta = {
    ...detail.meta,
    draft: {
      media_id: draftId,
      theme: theme.id,
      thumb_media_id: thumbMediaId,
      pushed_at: new Date().toISOString(),
    },
  };
  fs.writeFileSync(
    path.join(articleDir, `${meta.platform}.json`),
    `${JSON.stringify(meta, null, 2)}\n`,
    "utf8",
  );

  return { draftId, theme: theme.id, images: urls.size, reused };
}
