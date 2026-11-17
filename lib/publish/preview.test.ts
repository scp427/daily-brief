import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { buildWechatPreview } from "./preview";

function fixture(slug: string, markdown: string, imageBytes?: Buffer): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "db-preview-"));
  const articleDir = path.join(dir, "2026-01-02", "pieces", slug);
  fs.mkdirSync(path.join(articleDir, "assets"), { recursive: true });
  fs.writeFileSync(
    path.join(articleDir, "wechat.md"),
    `# 原标题\n\n${markdown}\n`,
    "utf8",
  );
  fs.writeFileSync(
    path.join(articleDir, "wechat.json"),
    JSON.stringify({
      title: "原标题",
      platform: "wechat",
      platform_label: "微信公众号",
      piece: "topic",
      words: 2000,
      model: "test",
      duration_ms: 1,
      sources: [],
      images: [{ ref: "IMG1", sourceUrl: "https://x/1.jpg", relPath: "assets/01.jpg" }],
      warnings: [],
      created_at: "2026-01-02T00:00:00.000Z",
    }),
    "utf8",
  );
  if (imageBytes) fs.writeFileSync(path.join(articleDir, "assets", "01.jpg"), imageBytes);
  return dir;
}

test("renders the draft body with inline images and the stored title", () => {
  const dir = fixture(
    "topic-a",
    ["## 第一节", "", "正文。", "", "![图](assets/01.jpg)"].join("\n"),
    Buffer.from([0xff, 0xd8, 0xff]),
  );
  const preview = buildWechatPreview({
    dir,
    date: "2026-01-02",
    slug: "topic-a",
    theme: "journal",
  });
  assert.equal(preview.title, "原标题");
  assert.equal(preview.theme, "journal");
  assert.doesNotMatch(preview.html, /^# 原标题/);
  assert.match(preview.html, /data:image\/jpeg;base64,/);
  assert.deepEqual(preview.skipped, []);
});

test("skips a figure whose file is missing instead of emitting a broken image", () => {
  const dir = fixture("topic-b", ["正文。", "", "![图](assets/02.jpg)"].join("\n"));
  const preview = buildWechatPreview({
    dir,
    date: "2026-01-02",
    slug: "topic-b",
    theme: "brief",
  });
  assert.doesNotMatch(preview.html, /<img/);
  assert.deepEqual(preview.skipped, ["assets/02.jpg"]);
});

test("reports a missing piece", () => {
  const dir = fixture("topic-c", "正文。");
  assert.throws(
    () => buildWechatPreview({ dir, date: "2026-01-02", slug: "nope", theme: "plain" }),
    /没有找到稿件/,
  );
});

test("rejects an unknown theme", () => {
  const dir = fixture("topic-d", "正文。");
  assert.throws(
    () => buildWechatPreview({ dir, date: "2026-01-02", slug: "topic-d", theme: "nope" }),
    /未知的公众号版式/,
  );
});
