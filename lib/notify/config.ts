/**
 * `notify.config.json` 的读取与校验。
 *
 * 开关与渠道写在这份可提交的配置里；SMTP 授权码只从环境变量
 * `NOTIFY_SMTP_PASS` 读，不进仓库。
 */

import fs from "node:fs";

export interface EmailConfig {
  host: string;
  port: number;
  secure: boolean;
  from: string;
  to: string[];
  subjectPrefix: string;
}

export interface NotifyConfig {
  enabled: boolean;
  channels: string[];
  email?: EmailConfig;
  maxBullets: number;
  /** 空字符串时邮件不附全文链接。 */
  baseUrl: string;
}

export const NOTIFY_CONFIG_PATH = "notify.config.json";
export const KNOWN_CHANNELS = ["email"] as const;
export const DEFAULT_MAX_BULLETS = 6;
export const DEFAULT_SUBJECT_PREFIX = "[每日简报]";

function fail(at: string, message: string): never {
  throw new Error(`notify.config.json${at} ${message}`);
}

function requireBoolean(value: unknown, at: string): boolean {
  if (typeof value !== "boolean") fail(at, "必须是布尔值");
  return value;
}

function requireString(value: unknown, at: string): string {
  if (typeof value !== "string" || value === "") fail(at, "必须是非空字符串");
  return value;
}

function parseEmail(raw: unknown): EmailConfig {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    fail(".email", "必须是对象");
  }
  const record: Record<string, unknown> = { ...raw };
  const port = record.port;
  if (typeof port !== "number" || !Number.isInteger(port) || port < 1 || port > 65535) {
    fail(".email.port", "必须是 1-65535 的整数");
  }
  const to = record.to;
  if (!Array.isArray(to) || to.length === 0) {
    fail(".email.to", "必须是非空数组");
  }
  const recipients = to.map((entry, i) => requireString(entry, `.email.to[${i}]`));
  const secure = record.secure === undefined ? false : requireBoolean(record.secure, ".email.secure");
  const subjectPrefix =
    record.subjectPrefix === undefined
      ? DEFAULT_SUBJECT_PREFIX
      : requireString(record.subjectPrefix, ".email.subjectPrefix");
  return {
    host: requireString(record.host, ".email.host"),
    port,
    secure,
    from: requireString(record.from, ".email.from"),
    to: recipients,
    subjectPrefix,
  };
}

function parseBaseUrl(raw: unknown): string {
  if (raw === undefined) return "";
  if (typeof raw !== "string") fail(".baseUrl", "必须是字符串");
  if (raw === "") return "";
  if (!/^https?:\/\//.test(raw)) fail(".baseUrl", "必须以 http:// 或 https:// 开头");
  return raw.replace(/\/+$/, "");
}

export function loadNotifyConfig(file = NOTIFY_CONFIG_PATH): NotifyConfig {
  if (!fs.existsSync(file)) {
    throw new Error(
      `缺少 ${file}。从 notify.config.example.json 复制一份再改；不启用推送就把 enabled 写成 false。`,
    );
  }
  let raw: unknown;
  try {
    raw = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    throw new Error(`${file} 不是合法 JSON：${detail}`);
  }
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new Error(`${file} 顶层必须是对象`);
  }
  const record: Record<string, unknown> = { ...raw };

  const enabled = requireBoolean(record.enabled, ".enabled");

  const channels = record.channels;
  if (!Array.isArray(channels)) fail(".channels", "必须是数组");
  const ids = channels.map((entry, i) => requireString(entry, `.channels[${i}]`));
  for (const id of ids) {
    if (!KNOWN_CHANNELS.includes(id as (typeof KNOWN_CHANNELS)[number])) {
      fail(".channels", `包含未知渠道 '${id}'，可选：${KNOWN_CHANNELS.join(", ")}`);
    }
  }

  const email = record.email === undefined ? undefined : parseEmail(record.email);
  if (ids.includes("email") && email === undefined) {
    fail(".email", "在 channels 里启用了 email，但缺少该段配置");
  }

  const maxBullets =
    record.maxBullets === undefined
      ? DEFAULT_MAX_BULLETS
      : (() => {
          const value = record.maxBullets;
          if (typeof value !== "number" || !Number.isInteger(value) || value < 1) {
            fail(".maxBullets", "必须是正整数");
          }
          return value;
        })();

  return { enabled, channels: ids, email, maxBullets, baseUrl: parseBaseUrl(record.baseUrl) };
}
