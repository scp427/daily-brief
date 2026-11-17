import assert from "node:assert/strict";
import test from "node:test";

import { parseBilibiliRanking, parseBilibiliRegionRanking } from "./bilibili";

const PAYLOAD = {
  code: 0,
  message: "OK",
  data: {
    list: [
      {
        bvid: "BV1xx411c7mD",
        title: "视频标题",
        desc: "视频简介",
        pubdate: 1794791359,
        tname: "科技",
        owner: { name: "某UP主" },
        stat: { view: 234567 },
      },
      { bvid: "", title: "没有 bvid 的条目" },
    ],
  },
};

test("parseBilibiliRanking maps bvid and the heat strip", () => {
  const items = parseBilibiliRanking(PAYLOAD, "bilibili-tech", "tech");
  assert.equal(items.length, 1);
  const [item] = items;
  assert.equal(item.title, "视频标题");
  assert.equal(item.url, "https://www.bilibili.com/video/BV1xx411c7mD");
  assert.equal(item.excerpt, "视频简介");
  assert.equal(item.meta, "科技 · 某UP主 · ▶ 23.5万");
});

test("parseBilibiliRanking leaves publishedAt unset so the board order survives the date sort", () => {
  const items = parseBilibiliRanking(PAYLOAD, "bilibili-tech", "tech");
  assert.equal(items[0].publishedAt, undefined);
});

test("parseBilibiliRanking drops an entry that has no bvid", () => {
  const items = parseBilibiliRanking(PAYLOAD, "bilibili-tech", "tech");
  assert.ok(items.every((i) => i.title !== "没有 bvid 的条目"));
});

test("parseBilibiliRanking fails loudly on a non-zero api code", () => {
  assert.throws(
    () => parseBilibiliRanking({ code: -412, message: "请求被拦截" }, "bilibili-tech", "tech"),
    /bilibili bilibili-tech: code -412 请求被拦截/,
  );
});

const REGION_PAYLOAD = {
  code: 0,
  message: "OK",
  data: [
    {
      aid: "114294230358428",
      bvid: "BV1nJRkYaEeH",
      typename: "影视杂谈",
      title: "史上最还原漫改电影！逼格拉满的暴力美学，8.4分《罪恶之城》",
      author: "培根悖论唠唠嗑",
      play: 1810376,
    },
    { bvid: "", title: "没有 bvid 的条目" },
  ],
};

test("parseBilibiliRegionRanking maps the commentary board and its strip", () => {
  const items = parseBilibiliRegionRanking(REGION_PAYLOAD, "bilibili-film-talk", "society");
  assert.equal(items.length, 1);
  const [item] = items;
  assert.equal(item.url, "https://www.bilibili.com/video/BV1nJRkYaEeH");
  assert.equal(item.meta, "影视杂谈 · 培根悖论唠唠嗑 · ▶ 181.0万");
  assert.equal(item.publishedAt, undefined);
});

test("parseBilibiliRegionRanking fails loudly on a non-zero api code", () => {
  assert.throws(
    () => parseBilibiliRegionRanking({ code: -352, message: "-352" }, "bilibili-film-talk", "society"),
    /bilibili bilibili-film-talk: code -352/,
  );
});
