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

export function renderEmail(
  summary: NotifySummary,
  subjectPrefix: string,
): { subject: string; text: string; html: string } {
  const subject = `${subjectPrefix} ${summary.date} ${shorten(summary.headline, HEADLINE_IN_SUBJECT_MAX)}`;

  const textParts = [summary.headline, summary.overview];
  if (summary.bullets.length > 0) {
    textParts.push(`要点\n${summary.bullets.map((b) => `- ${b}`).join("\n")}`);
  }
  if (summary.trading) textParts.push(`行情\n${summary.trading}`);
  if (summary.url) textParts.push(`全文：${summary.url}`);
  const text = textParts.join("\n\n");

  const htmlParts = [
    `<p style="font-size:20px;font-weight:600;margin:0 0 12px">${escapeHtml(summary.headline)}</p>`,
    `<p style="margin:0 0 16px">${escapeHtml(summary.overview)}</p>`,
  ];
  if (summary.bullets.length > 0) {
    const items = summary.bullets.map((b) => `<li>${escapeHtml(b)}</li>`).join("");
    htmlParts.push(
      `<p style="font-weight:600;margin:0 0 6px">要点</p><ul style="margin:0 0 16px;padding-left:20px">${items}</ul>`,
    );
  }
  if (summary.trading) {
    htmlParts.push(
      `<p style="font-weight:600;margin:0 0 6px">行情</p><p style="margin:0 0 16px">${escapeHtml(summary.trading)}</p>`,
    );
  }
  if (summary.url) {
    htmlParts.push(
      `<p style="margin:0"><a href="${escapeHtml(summary.url)}">阅读全文</a></p>`,
    );
  }
  const html = `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;line-height:1.7;color:#1b1b1b;max-width:640px">${htmlParts.join("")}</div>`;

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
