import "./_env";

import fs from "node:fs";
import path from "node:path";

import { REPORTS_DIR } from "../lib/publish/drafts";
import { WechatMpClient, loadWechatMpConfig } from "../lib/publish/channels/wechat-mp";
import { pushWechatDraft } from "../lib/publish/wechat-push";
import { getWechatTheme, renderWechatHtml } from "../lib/publish/wechat-html";
import { pieceDir, readPieceDetail } from "../lib/publish/piece-runner";
import { todayKey } from "../lib/utils";

/**
 * Push a reviewed draft into the WeChat MP draft box.
 *
 * Only the draft box: publishing needs a different endpoint and account
 * permission, so a human opens the draft in the MP console and sends it.
 *
 * Usage:
 *   npm run push -- <slug>                     # today's piece
 *   npm run push -- 2026-11-17 <slug>
 *   npm run push -- <slug> --theme=brief --force
 *   npm run push -- <slug> --dry-run           # html only, no credentials read
 *   npm run push -- --probe                    # is publishing allowed for this account?
 */

const USAGE = `用法：
  npm run push -- [YYYY-MM-DD] <slug> [--theme=journal|brief|plain] [--force] [--dry-run]
  npm run push -- --probe`;

function isDateKey(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const dateArg = argv.find(isDateKey);
  const date = dateArg ?? todayKey();
  const force = argv.includes("--force");
  const dryRun = argv.includes("--dry-run");
  const probe = argv.includes("--probe");
  const themeArg = argv.find((a) => a.startsWith("--theme="))?.slice("--theme=".length);
  const positional = argv.filter((a) => !a.startsWith("--") && a !== dateArg);
  const unknownFlags = argv.filter(
    (a) =>
      a.startsWith("--") &&
      !["--force", "--dry-run", "--probe"].includes(a) &&
      !a.startsWith("--theme="),
  );
  if (unknownFlags.length > 0) {
    throw new Error(`未知参数：${unknownFlags.join(" ")}\n${USAGE}`);
  }

  if (probe) {
    const allowed = await new WechatMpClient(loadWechatMpConfig()).probePublish();
    console.log(
      allowed
        ? "[push] 这个号可以调用发布接口。"
        : "[push] 这个号没有发布接口权限（48001），只能写草稿箱。",
    );
    return;
  }

  const slug = positional[0];
  if (!slug) throw new Error(USAGE);

  if (dryRun) {
    const detail = readPieceDetail(REPORTS_DIR, date, slug);
    if (!detail) throw new Error(`没有找到稿件 ${slug}（${date}）`);
    const theme = getWechatTheme(
      themeArg ?? (detail.meta.piece === "digest" ? "brief" : "journal"),
    );
    const articleDir = pieceDir(REPORTS_DIR, date, slug);
    const body = detail.markdown.replace(/^#\s+.*\n+/, "");
    const html = renderWechatHtml({
      markdown: body,
      theme,
      resolveImage: (target) =>
        fs.existsSync(path.join(articleDir, target))
          ? `file://${path.join(articleDir, target)}`
          : "",
    });
    console.log(`[push] dry-run ${slug} · ${theme.id} · ${html.length} 字符`);
    process.stdout.write(`${html}\n`);
    return;
  }

  console.log(`[push] ${date} ${slug}${themeArg ? ` · ${themeArg}` : ""}`);
  const config = loadWechatMpConfig();
  const result = await pushWechatDraft(
    { dir: REPORTS_DIR, date, slug, theme: themeArg, force },
    new WechatMpClient(config),
    config.cover,
  );
  console.log(
    `[push] ${result.reused ? "已更新草稿" : "已新建草稿"} ${result.draftId} · ${result.theme} · ${result.images} 图`,
  );
  console.log("[push] 到公众号后台的草稿箱打开检查，再决定是否发布。");
}

main().catch((error: unknown) => {
  console.error(`[push] ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
