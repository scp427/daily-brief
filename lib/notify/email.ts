/**
 * 邮件渠道：把概览渲染成纯文本 + 内联样式 HTML，经 SMTP 投递。
 *
 * `MailTransport` 只暴露 `sendMail`，测试注入假实现即可，不碰网络。
 */

import nodemailer from "nodemailer";

import type { EmailConfig } from "./config";
import type { NotifyChannel, NotifySummary } from "./types";

export interface MailMessage {
  from: string;
  to: string;
  subject: string;
  text: string;
  html: string;
}

export interface MailTransport {
  sendMail(message: MailMessage): Promise<unknown>;
}

const HEADLINE_IN_SUBJECT_MAX = 40;

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function shorten(value: string, max: number): string {
  const trimmed = value.trim();
  return trimmed.length <= max ? trimmed : `${trimmed.slice(0, max)}…`;
}

const STR =
  process.env.REPORT_LOCALE === "en"
    ? { overview: "Overview", trading: "Markets", readMore: "Read the full brief", footer: "Sent automatically by Daily Brief" }
    : { overview: "今日总览", trading: "行情", readMore: "阅读全文", footer: "由 Daily Brief 自动发送" };

/** Wraps a block of per-category overview text; email clients need tables, not flex. */
function overviewRow(label: string, text: string): string {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse">
  <tr>
    <td style="width:84px;vertical-align:top;padding:0 12px 14px 0">
      <span style="display:inline-block;font-size:12px;font-weight:700;color:#c2413a;white-space:nowrap">${escapeHtml(label)}</span>
    </td>
    <td style="vertical-align:top;padding:0 0 14px">
      <p style="margin:0;font-size:14px;line-height:1.8;color:#4a5162">${escapeHtml(text)}</p>
    </td>
  </tr>
</table>`;
}

export function renderEmail(
  summary: NotifySummary,
  subjectPrefix: string,
): { subject: string; text: string; html: string } {
  const subject = `${subjectPrefix} ${summary.date} ${shorten(summary.headline, HEADLINE_IN_SUBJECT_MAX)}`;

  const textParts = [summary.headline];
  if (summary.overview) textParts.push(summary.overview);
  if (summary.sections?.length) {
    textParts.push(
      summary.sections.map((s) => `${s.label}\n${s.text}`).join("\n\n"),
    );
  } else if (summary.bullets.length > 0) {
    textParts.push(`要点\n${summary.bullets.map((b) => `- ${b}`).join("\n")}`);
  }
  if (summary.trading) textParts.push(`${STR.trading}\n${summary.trading}`);
  if (summary.url) textParts.push(`全文：${summary.url}`);
  const text = textParts.join("\n\n");

  const blocks: string[] = [];
  if (summary.overview) {
    blocks.push(
      `<p style="margin:0 0 16px;font-size:15px;line-height:1.8;color:#3b4150">${escapeHtml(summary.overview)}</p>`,
    );
  }
  if (summary.sections?.length) {
    blocks.push(
      `<div style="border-top:1px solid #eceff3;padding-top:16px">${summary.sections
        .map((s) => overviewRow(s.label, s.text))
        .join("")}</div>`,
    );
  } else if (summary.bullets.length > 0) {
    blocks.push(
      `<div style="border-top:1px solid #eceff3;padding-top:16px"><p style="margin:0 0 8px;font-size:12px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#9aa3b2">${STR.overview}</p><ul style="margin:0 0 16px;padding-left:20px;font-size:14px;line-height:1.8;color:#4a5162">${summary.bullets
        .map((b) => `<li style="margin-bottom:4px">${escapeHtml(b)}</li>`)
        .join("")}</ul></div>`,
    );
  }
  if (summary.trading) {
    blocks.push(
      `<div style="background:#f7f8fa;border-radius:10px;padding:14px 16px;margin:0 0 18px"><p style="margin:0 0 6px;font-size:12px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#6b7280">${STR.trading}</p><p style="margin:0;font-size:14px;line-height:1.8;color:#4a5162">${escapeHtml(summary.trading)}</p></div>`,
    );
  }
  if (summary.url) {
    blocks.push(
      `<a href="${escapeHtml(summary.url)}" style="display:inline-block;background:#1f2430;color:#ffffff;text-decoration:none;font-size:14px;font-weight:600;padding:11px 22px;border-radius:999px">${STR.readMore}</a>`,
    );
  }

  const html = `<div style="margin:0;padding:24px 12px;background:#f4f5f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','PingFang SC',sans-serif">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:640px;margin:0 auto;background:#ffffff;border-radius:14px;overflow:hidden;border-collapse:separate">
  <tr>
    <td style="background:#1f2430;padding:26px 28px 22px">
      <p style="margin:0;font-size:11px;font-weight:600;letter-spacing:.14em;text-transform:uppercase;color:#8f99a8">Daily Brief · ${escapeHtml(summary.date)}</p>
      <p style="margin:10px 0 0;font-size:21px;line-height:1.45;font-weight:600;color:#ffffff">${escapeHtml(summary.headline)}</p>
    </td>
  </tr>
  <tr>
    <td style="padding:22px 28px 4px">${blocks.join("")}</td>
  </tr>
  <tr>
    <td style="padding:6px 28px 24px">
      <p style="margin:0;font-size:12px;color:#9aa3b2">${STR.footer} · ${escapeHtml(summary.date)}</p>
    </td>
  </tr>
</table>
</div>`;

  return { subject, text, html };
}

export function createSmtpTransport(config: EmailConfig, pass: string): MailTransport {
  const transport = nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure,
    auth: { user: config.from, pass },
  });
  return {
    sendMail: (message) => transport.sendMail(message),
  };
}

export function createEmailChannel(
  config: EmailConfig,
  pass: string,
  transport: MailTransport = createSmtpTransport(config, pass),
): NotifyChannel {
  return {
    id: "email",
    async send(summary) {
      const { subject, text, html } = renderEmail(summary, config.subjectPrefix);
      await transport.sendMail({
        from: config.from,
        to: config.to.join(", "),
        subject,
        text,
        html,
      });
    },
  };
}
