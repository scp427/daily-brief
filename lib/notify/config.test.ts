import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { loadNotifyConfig } from "./config";

function writeConfig(value: unknown): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "db-notify-cfg-"));
  const file = path.join(dir, "notify.config.json");
  fs.writeFileSync(file, JSON.stringify(value), "utf8");
  return file;
}

const EMAIL = {
  host: "smtp.example.com",
  port: 465,
  secure: true,
  from: "brief@example.com",
  to: ["me@example.com"],
};

test("loadNotifyConfig applies defaults for optional fields", () => {
  const config = loadNotifyConfig(
    writeConfig({ enabled: false, channels: [], email: EMAIL }),
  );
  assert.equal(config.enabled, false);
  assert.equal(config.maxBullets, 6);
  assert.equal(config.baseUrl, "");
  assert.equal(config.email?.subjectPrefix, "[每日简报]");
});

test("loadNotifyConfig rejects missing or non-boolean enabled", () => {
  assert.throws(() => loadNotifyConfig(writeConfig({ channels: [] })), /\.enabled 必须是布尔值/);
  assert.throws(
    () => loadNotifyConfig(writeConfig({ enabled: "yes", channels: [] })),
    /\.enabled 必须是布尔值/,
  );
});

test("loadNotifyConfig rejects unknown channels and missing email section", () => {
  assert.throws(
    () => loadNotifyConfig(writeConfig({ enabled: true, channels: ["sms"] })),
    /未知渠道 'sms'/,
  );
  assert.throws(
    () => loadNotifyConfig(writeConfig({ enabled: true, channels: ["email"] })),
    /缺少该段配置/,
  );
});

test("loadNotifyConfig validates email fields", () => {
  const base = { enabled: true, channels: ["email"] };
  assert.throws(
    () => loadNotifyConfig(writeConfig({ ...base, email: { ...EMAIL, port: 0 } })),
    /\.email\.port 必须是 1-65535 的整数/,
  );
  assert.throws(
    () => loadNotifyConfig(writeConfig({ ...base, email: { ...EMAIL, to: [] } })),
    /\.email\.to 必须是非空数组/,
  );
  assert.throws(
    () => loadNotifyConfig(writeConfig({ ...base, email: { ...EMAIL, host: "" } })),
    /\.email\.host 必须是非空字符串/,
  );
});

test("loadNotifyConfig rejects a baseUrl without scheme and strips trailing slash", () => {
  assert.throws(
    () => loadNotifyConfig(writeConfig({ enabled: false, channels: [], baseUrl: "example.com" })),
    /必须以 http:\/\/ 或 https:\/\//,
  );
  const config = loadNotifyConfig(
    writeConfig({ enabled: false, channels: [], baseUrl: "https://example.com/brief/" }),
  );
  assert.equal(config.baseUrl, "https://example.com/brief");
  assert.equal(
    loadNotifyConfig(writeConfig({ enabled: false, channels: [], baseUrl: "" })).baseUrl,
    "",
  );
});

test("loadNotifyConfig fails on a missing file", () => {
  assert.throws(
    () => loadNotifyConfig(path.join(os.tmpdir(), "db-notify-does-not-exist.json")),
    /从 notify\.config\.example\.json 复制/,
  );
});
