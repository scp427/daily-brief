import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import type { WechatDraftArticle } from "./channels/wechat-mp";
import { assetTargets, pushWechatDraft, summarize } from "./wechat-push";
import type { DraftClient } from "./wechat-push";

interface FakeClient extends DraftClient {
  uploaded: string[];
  articles: WechatDraftArticle[];
  updates: Array<{ mediaId: string; article: WechatDraftArticle }>;
}

function fakeClient(): FakeClient {
  const client: FakeClient = {
    uploaded: [],
    articles: [],
    updates: [],
    async uploadContentImage(file: string) {
      client.uploaded.push(file);
      return `https://mmbiz.example/${path.basename(file)}`;
    },
    async uploadCover() {
      return "thumb-1";
    },
    async draftAdd(article: WechatDraftArticle) {
      client.articles.push(article);
      return "draft-1";
    },
    async draftUpdate(mediaId: string, article: WechatDraftArticle) {
      client.updates.push({ mediaId, article });
    },
  };
  return client;
}

function fixture(options: {
  verdict?: "pass" | "needs_work" | null;
  draft?: { media_id: string; thumb_media_id: string };
  withImage?: boolean;
}): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "db-push-"));
  const articleDir = path.join(dir, "2026-01-02", "pieces", "topic-a");
  fs.mkdirSync(path.join(articleDir, "assets"), { recursive: true });
  const body = ["导语**加粗**一句话。", "", "## 第一节", "", "正文。"].join("\n");
  fs.writeFileSync(
    path.join(articleDir, "wechat.md"),
    `# 原标题\n\n${body}${options.withImage ? "\n\n![图](assets/01.jpg)" : ""}\n`,
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
      images: [],
      warnings: [],
      created_at: "2026-01-02T00:00:00.000Z",
      ...(options.draft
        ? {
            draft: {
              media_id: options.draft.media_id,
              theme: "journal",
              thumb_media_id: options.draft.thumb_media_id,
              pushed_at: "2026-01-02T00:00:00.000Z",
            },
          }
        : {}),
    }),
    "utf8",
  );
  if (options.withImage) {
    fs.writeFileSync(path.join(articleDir, "assets", "01.jpg"), Buffer.from([0xff]));
  }
  if (options.verdict !== null) {
    fs.writeFileSync(
      path.join(articleDir, "wechat.review.json"),
      JSON.stringify({
        platform: "wechat",
        piece: "topic",
        verdict: options.verdict ?? "pass",
        mechanical: [],
        facts: [],
        warnings: [],
        durationMs: 1,
      }),
      "utf8",
    );
  }
  return dir;
}

test("summarize takes the first paragraph without markdown marks", () => {
  assert.equal(summarize("# 标题\n\n导语**重点**。\n\n## 节\n\n正文。"), "导语重点。");
  assert.equal(summarize("甲".repeat(200)).length, 121);
});

test("assetTargets deduplicates figure targets in order", () => {
  assert.deepEqual(
    assetTargets("![a](assets/01.jpg)\n\n![b](assets/02.jpg)\n\n![c](assets/01.jpg)"),
    ["assets/01.jpg", "assets/02.jpg"],
  );
});

test("pushes a new draft with the article html and cover", async () => {
  const dir = fixture({ withImage: true });
  const client = fakeClient();
  const result = await pushWechatDraft(
    { dir, date: "2026-01-02", slug: "topic-a" },
    client,
    "/covers/default.png",
  );
  assert.equal(result.draftId, "draft-1");
  assert.equal(result.theme, "journal");
  assert.equal(result.images, 1);
  assert.equal(client.uploaded.length, 1);
  assert.match(client.articles[0].content, /https:\/\/mmbiz\.example\/01\.jpg/);
  assert.equal(client.articles[0].thumb_media_id, "thumb-1");
  assert.equal(client.articles[0].digest, "导语加粗一句话。");

  const meta = JSON.parse(
    fs.readFileSync(path.join(dir, "2026-01-02", "pieces", "topic-a", "wechat.json"), "utf8"),
  );
  assert.equal(meta.draft.media_id, "draft-1");
});

test("reuses the stored cover and updates the existing draft", async () => {
  const dir = fixture({ draft: { media_id: "draft-old", thumb_media_id: "thumb-old" } });
  const client = fakeClient();
  const result = await pushWechatDraft(
    { dir, date: "2026-01-02", slug: "topic-a", theme: "brief" },
    client,
    "/covers/default.png",
  );
  assert.equal(result.reused, true);
  assert.equal(result.draftId, "draft-old");
  assert.equal(client.articles.length, 0);
  assert.equal(client.updates.length, 1);
  assert.equal(client.updates[0].mediaId, "draft-old");
  assert.equal(client.updates[0].article.thumb_media_id, "thumb-old");
});

test("refuses to push a draft the reviewer wants changed", async () => {
  const dir = fixture({ verdict: "needs_work" });
  await assert.rejects(
    () => pushWechatDraft({ dir, date: "2026-01-02", slug: "topic-a" }, fakeClient(), "/c"),
    /审阅结论是"需要修改"/,
  );
});

test("refuses a draft that was never reviewed", async () => {
  const dir = fixture({ verdict: null });
  await assert.rejects(
    () => pushWechatDraft({ dir, date: "2026-01-02", slug: "topic-a" }, fakeClient(), "/c"),
    /还没有审阅结果/,
  );
});

test("force pushes despite a failing review", async () => {
  const dir = fixture({ verdict: "needs_work" });
  const client = fakeClient();
  const result = await pushWechatDraft(
    { dir, date: "2026-01-02", slug: "topic-a", force: true },
    client,
    "/c",
  );
  assert.equal(result.draftId, "draft-1");
});

test("a missing figure file fails loudly", async () => {
  const dir = fixture({});
  const articleDir = path.join(dir, "2026-01-02", "pieces", "topic-a");
  fs.writeFileSync(
    path.join(articleDir, "wechat.md"),
    "# 原标题\n\n正文。\n\n![图](assets/09.jpg)\n",
    "utf8",
  );
  await assert.rejects(
    () => pushWechatDraft({ dir, date: "2026-01-02", slug: "topic-a" }, fakeClient(), "/c"),
    /正文引用了不存在的图片：assets\/09\.jpg/,
  );
});
