import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  WechatApiError,
  WechatMpClient,
  loadWechatMpConfig,
} from "./wechat-mp";

interface Call {
  url: string;
  body: unknown;
}

function makeFetch(
  reply: (url: string) => { errcode?: number; errmsg?: string } & Record<string, unknown>,
): { impl: typeof fetch; calls: Call[] } {
  const calls: Call[] = [];
  const impl = (async (url: string, init?: RequestInit) => {
    const text = typeof init?.body === "string" ? init.body : null;
    calls.push({ url, body: text === null ? null : JSON.parse(text) });
    return new Response(JSON.stringify(reply(url)), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as unknown as typeof fetch;
  return { impl, calls };
}

function config(): { app_id: string; app_secret: string; cover: string } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "db-wx-"));
  const cover = path.join(dir, "cover.png");
  fs.writeFileSync(cover, Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  return { app_id: "app", app_secret: "secret", cover };
}

test("loadWechatMpConfig names the missing key", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "db-wx-cfg-"));
  const file = path.join(dir, "wx.json");
  fs.writeFileSync(file, JSON.stringify({ app_id: "a" }), "utf8");
  assert.throws(() => loadWechatMpConfig(file), /缺少 app_secret/);
  assert.throws(
    () => loadWechatMpConfig(path.join(dir, "absent.json")),
    /缺少公众号凭据文件/,
  );
});

test("loadWechatMpConfig rejects a cover path that does not exist", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "db-wx-cfg-"));
  const file = path.join(dir, "wx.json");
  fs.writeFileSync(
    file,
    JSON.stringify({ app_id: "a", app_secret: "b", cover: "/nope/x.png" }),
    "utf8",
  );
  assert.throws(() => loadWechatMpConfig(file), /封面图不存在/);
});

test("token is cached on disk and reused", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "db-wx-tok-"));
  const tokenFile = path.join(dir, "token.json");
  let issued = 0;
  const { impl, calls } = makeFetch(() => {
    issued += 1;
    return { access_token: `t${issued}`, expires_in: 7200 };
  });
  const client = new WechatMpClient(config(), { fetchImpl: impl, tokenFile });
  assert.equal(await client.token(), "t1");
  assert.equal(await client.token(), "t1");
  assert.equal(calls.length, 1);
  assert.match(fs.readFileSync(tokenFile, "utf8"), /t1/);
});

test("expired cache triggers a fresh token", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "db-wx-tok-"));
  const tokenFile = path.join(dir, "token.json");
  fs.writeFileSync(
    tokenFile,
    JSON.stringify({ app_id: "app", access_token: "old", expires_at: 1000 }),
    "utf8",
  );
  const { impl, calls } = makeFetch(() => ({ access_token: "new", expires_in: 7200 }));
  const client = new WechatMpClient(config(), {
    fetchImpl: impl,
    tokenFile,
    now: () => 5000,
  });
  assert.equal(await client.token(), "new");
  assert.equal(calls.length, 1);
});

test("a stale token is refreshed once and the call retried", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "db-wx-tok-"));
  const tokenFile = path.join(dir, "token.json");
  let drafts = 0;
  const { impl, calls } = makeFetch((url) => {
    if (url.includes("draft/add")) {
      drafts += 1;
      return drafts === 1
        ? { errcode: 40001, errmsg: "invalid credential" }
        : { media_id: "m1" };
    }
    return { access_token: `t${drafts}`, expires_in: 7200 };
  });
  const client = new WechatMpClient(config(), { fetchImpl: impl, tokenFile });
  const mediaId = await client.draftAdd({
    title: "标题",
    content: "<p>x</p>",
    thumb_media_id: "thumb",
  });
  assert.equal(mediaId, "m1");
  assert.equal(drafts, 2);
  assert.equal(calls.filter((c) => c.url.includes("stable_token")).length, 2);
});

test("draftAdd sends a single article with its cover", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "db-wx-tok-"));
  const { impl, calls } = makeFetch((url) =>
    url.includes("stable_token")
      ? { access_token: "t", expires_in: 7200 }
      : { media_id: "m1" },
  );
  const client = new WechatMpClient(config(), {
    fetchImpl: impl,
    tokenFile: path.join(dir, "t.json"),
  });
  await client.draftAdd({
    title: "标题",
    author: "作者",
    digest: "摘要",
    content: "<p>正文</p>",
    thumb_media_id: "thumb",
  });
  const draft = calls.find((c) => c.url.includes("draft/add"));
  assert.deepEqual(draft?.body, {
    articles: [
      {
        title: "标题",
        author: "作者",
        digest: "摘要",
        content: "<p>正文</p>",
        thumb_media_id: "thumb",
      },
    ],
  });
});

test("draftUpdate sends the article object, not an array", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "db-wx-tok-"));
  const { impl, calls } = makeFetch((url) =>
    url.includes("stable_token") ? { access_token: "t", expires_in: 7200 } : {},
  );
  const client = new WechatMpClient(config(), {
    fetchImpl: impl,
    tokenFile: path.join(dir, "t.json"),
  });
  await client.draftUpdate("m1", {
    title: "标题",
    content: "<p>正文</p>",
    thumb_media_id: "thumb",
  });
  const update = calls.find((c) => c.url.includes("draft/update"));
  assert.deepEqual(update?.body, {
    media_id: "m1",
    index: 0,
    articles: { title: "标题", content: "<p>正文</p>", thumb_media_id: "thumb" },
  });
});

test("probePublish reads 48001 as no permission", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "db-wx-tok-"));
  const denied = makeFetch((url) =>
    url.includes("stable_token")
      ? { access_token: "t", expires_in: 7200 }
      : { errcode: 48001, errmsg: "api unauthorized" },
  );
  const client = new WechatMpClient(config(), {
    fetchImpl: denied.impl,
    tokenFile: path.join(dir, "t.json"),
  });
  assert.equal(await client.probePublish(), false);

  const allowed = makeFetch((url) =>
    url.includes("stable_token")
      ? { access_token: "t", expires_in: 7200 }
      : { errcode: 40007, errmsg: "invalid publish id" },
  );
  const other = new WechatMpClient(config(), {
    fetchImpl: allowed.impl,
    tokenFile: path.join(dir, "t2.json"),
  });
  assert.equal(await other.probePublish(), true);
});

test("an api error keeps the errcode", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "db-wx-tok-"));
  const { impl } = makeFetch((url) =>
    url.includes("stable_token")
      ? { access_token: "t", expires_in: 7200 }
      : { errcode: 40164, errmsg: "invalid ip 1.2.3.4, not in whitelist" },
  );
  const client = new WechatMpClient(config(), {
    fetchImpl: impl,
    tokenFile: path.join(dir, "t.json"),
  });
  await assert.rejects(
    () => client.draftAdd({ title: "t", content: "c", thumb_media_id: "x" }),
    (error: unknown) => {
      assert.ok(error instanceof WechatApiError);
      assert.equal(error.errcode, 40164);
      assert.match(error.message, /IP|not in whitelist/);
      return true;
    },
  );
});
