import "./_env";

/**
 * 用已生成的报告手动发一次概览通知。
 *
 *   npm run notify -- [YYYY-MM-DD]           # 按 notify.config.json 发送
 *   npm run notify -- [YYYY-MM-DD] --dry-run # 只打印，不连 SMTP
 *
 * 复用与 `scripts/daily.ts` 相同的配置、概览裁剪与渠道构造，所以这里能寄到
 * 的邮件就是每日管线会寄出的那一封。
 */

import {
  buildNotifySummary,
  createChannels,
  loadNotifyConfig,
  notifyReport,
} from "../lib/notify";
import { renderEmail } from "../lib/notify/email";
import { readReport } from "../lib/output/store";
import { todayKey } from "../lib/utils";

const OUTPUT_DIR = "daily_reports";
const USAGE = `用法：
  npm run notify -- [YYYY-MM-DD] [--dry-run]`;

function isDateKey(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const dryRun = argv.includes("--dry-run");
  const unknown = argv.filter((a) => a.startsWith("--") && a !== "--dry-run");
  if (unknown.length > 0) throw new Error(`未知参数：${unknown.join(" ")}\n${USAGE}`);

  const date = argv.find((a) => !a.startsWith("--")) ?? todayKey();
  if (!isDateKey(date)) throw new Error(`${USAGE}\n日期无效：${date}`);

  const config = loadNotifyConfig();
  const summary = buildNotifySummary(date, readReport(OUTPUT_DIR, date), config);

  if (dryRun) {
    const { subject, text } = renderEmail(summary, config.email?.subjectPrefix ?? "");
    console.log(`Subject: ${subject}\n`);
    console.log(text);
    console.log("\n[notify] dry-run — nothing sent");
    return;
  }

  if (!config.enabled) {
    console.log("[notify] 开关是关闭的：把 notify.config.json 的 enabled 改成 true 再发。");
    return;
  }
  await notifyReport(summary, config, createChannels(config));
}

main().catch((e) => {
  console.error("[notify] FAILED:", e);
  process.exit(1);
});
