import assert from "node:assert/strict";
import test from "node:test";

import type { EmailConfig } from "./config";
import { createEmailChannel, renderEmail, type MailMessage } from "./email";
import type { NotifySummary } from "./types";

const SUMMARY: NotifySummary = {
  date: "2026-11-17",
  headline: "今日头条",
  overview: "总览正文",
  bullets: ["技术动态：技术头条"],
  trading: "美股走强",
  url: "https://example.com/brief/2026-11-17/2026-11-17.html",
};

const EMAIL: EmailConfig = {
  host: "smtp.example.com",
  port: 465,
  secure: true,
  from: "brief@example.com",
  to: ["me@example.com", "other@example.com"],
  subjectPrefix: "[每日简报]",
};

function capture(): { transport: { sendMail: (m: MailMessage) => Promise<unknown> }; sent: MailMessage[] } {
  const sent: MailMessage[] = [];
  return {
    sent,
    transport: {
      async sendMail(message) {
        sent.push(message);
        return { accepted: [message.to] };
      },
    },
  };
}

test("renderEmail includes every section and escapes HTML", () => {
  const { subject, text, html } = renderEmail({ ...SUMMARY, overview: "a <b> & c" }, "[每日简报]");
  assert.match(subject, /^\[每日简报\] 2026-11-17 今日头条$/);
  assert.match(text, /要点\n- 技术动态：技术头条/);
  assert.match(text, /行情\n美股走强/);
  assert.match(text, /全文：https:\/\/example\.com/);
  assert.match(html, /a &lt;b&gt; &amp; c/);
  assert.match(html, /href="https:\/\/example\.com/);
});

test("renderEmail truncates a long headline in the subject", () => {
  const { subject } = renderEmail({ ...SUMMARY, headline: "长".repeat(60) }, "[简报]");
  assert.equal(subject, `[简报] 2026-11-17 ${"长".repeat(40)}…`);
});

test("createEmailChannel sends from/to from config", async () => {
  const { transport, sent } = capture();
  await createEmailChannel(EMAIL, "secret", transport).send(SUMMARY);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].from, "brief@example.com");
  assert.equal(sent[0].to, "me@example.com, other@example.com");
  assert.match(sent[0].subject, /今日头条/);
});
