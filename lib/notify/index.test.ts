import assert from "node:assert/strict";
import test from "node:test";

import { createChannels, notifyReport } from "./index";
import type { NotifyConfig } from "./config";
import type { NotifyChannel, NotifySummary } from "./types";

const SUMMARY: NotifySummary = {
  date: "2026-11-17",
  headline: "今日头条",
  overview: "总览正文",
  bullets: [],
};

const CONFIG: NotifyConfig = {
  enabled: true,
  channels: ["email"],
  email: {
    host: "smtp.example.com",
    port: 465,
    secure: true,
    from: "brief@example.com",
    to: ["me@example.com"],
    subjectPrefix: "[每日简报]",
  },
  maxBullets: 6,
  baseUrl: "",
};

test("notifyReport sends nothing when disabled", async () => {
  const calls: string[] = [];
  const channel: NotifyChannel = { id: "spy", send: async () => void calls.push("sent") };
  await notifyReport(SUMMARY, { ...CONFIG, enabled: false }, [channel]);
  assert.deepEqual(calls, []);
});

test("notifyReport keeps going after a channel throws", async () => {
  const calls: string[] = [];
  const failing: NotifyChannel = {
    id: "broken",
    send: async () => {
      throw new Error("smtp timeout");
    },
  };
  const ok: NotifyChannel = { id: "healthy", send: async () => void calls.push("healthy") };
  await notifyReport(SUMMARY, CONFIG, [failing, ok]);
  assert.deepEqual(calls, ["healthy"]);
});

test("createChannels fails loud when the SMTP password is missing", () => {
  assert.throws(() => createChannels(CONFIG, {}), /缺少环境变量 NOTIFY_SMTP_PASS/);
});

test("createChannels builds an email channel when the password is present", () => {
  const channels = createChannels(CONFIG, { NOTIFY_SMTP_PASS: "secret" });
  assert.deepEqual(channels.map((c) => c.id), ["email"]);
});
