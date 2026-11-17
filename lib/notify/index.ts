/**
 * 通知入口。渠道构造与投递分开：
 *
 * - `createChannels` 校验凭据，配置不全时抛错——调用方在管线启动阶段执行它。
 * - `notifyReport` 只负责投递；单个渠道失败降级为警告，不影响其余渠道，
 *   也不影响已经写完的报告。
 */

import type { NotifyConfig } from "./config";
import { createEmailChannel } from "./email";
import type { NotifyChannel, NotifySummary } from "./types";

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function createChannels(
  config: NotifyConfig,
  env: NodeJS.ProcessEnv = process.env,
): NotifyChannel[] {
  // 关闭时不需要凭据：把开关关掉不该因为没配密码而让每日管线启动失败。
  if (!config.enabled) return [];
  return config.channels.map((id) => {
    if (id === "email") {
      if (config.email === undefined) {
        throw new Error("notify.config.json 启用了 email 渠道，但缺少 .email 段");
      }
      const pass = env.NOTIFY_SMTP_PASS;
      if (pass === undefined || pass === "") {
        throw new Error("缺少环境变量 NOTIFY_SMTP_PASS（邮箱 SMTP 授权码）");
      }
      return createEmailChannel(config.email, pass);
    }
    throw new Error(`未知推送渠道 '${id}'`);
  });
}

export async function notifyReport(
  summary: NotifySummary,
  config: NotifyConfig,
  channels: NotifyChannel[],
): Promise<void> {
  if (!config.enabled) {
    console.log("[notify] disabled in notify.config.json — skipped");
    return;
  }
  for (const channel of channels) {
    try {
      await channel.send(summary);
      console.log(`[notify] ${channel.id} sent (${summary.date})`);
    } catch (e) {
      console.warn(`[notify] ${channel.id} failed: ${describeError(e)}`);
    }
  }
}

export { loadNotifyConfig } from "./config";
export type { EmailConfig, NotifyConfig } from "./config";
export { buildNotifySummary } from "./summary";
export type { NotifyChannel, NotifySummary } from "./types";
