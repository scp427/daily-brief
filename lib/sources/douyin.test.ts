import assert from "node:assert/strict";
import test from "node:test";

import { parseDouyinHot } from "./douyin";

const PAYLOAD = {
  status_code: 0,
  word_list: [
    { word: "APEC峰会有哪些领导人参加", hot_value: 11888068, label: 1 },
    { word: "平价羽绒服为何突然变得真香", hot_value: 4567890 },
    { word: "   " },
  ],
};

test("parseDouyinHot turns each word into a Douyin search link", () => {
  const items = parseDouyinHot(PAYLOAD, "douyin-hot", "society");
  assert.equal(items.length, 2);
  assert.equal(items[0].title, "APEC峰会有哪些领导人参加");
  assert.equal(items[0].url, `https://www.douyin.com/search/${encodeURIComponent("APEC峰会有哪些领导人参加")}`);
});

test("parseDouyinHot formats the heat value in 万 and 亿", () => {
  const items = parseDouyinHot(PAYLOAD, "douyin-hot", "society");
  assert.equal(items[0].meta, "1188.8万 热度");
  assert.equal(items[1].meta, "456.8万 热度");
});

test("parseDouyinHot leaves publishedAt unset so the heat order survives the date sort", () => {
  const items = parseDouyinHot(PAYLOAD, "douyin-hot", "society");
  assert.equal(items[0].publishedAt, undefined);
});

test("parseDouyinHot drops entries without a word", () => {
  const items = parseDouyinHot(PAYLOAD, "douyin-hot", "society");
  assert.ok(items.every((item) => item.title.trim() !== ""));
});

test("parseDouyinHot fails loudly when the payload is an error response", () => {
  assert.throws(
    () => parseDouyinHot({ status_code: 1 }, "douyin-hot", "society"),
    /douyin douyin-hot: unexpected payload \(status_code=1\)/,
  );
});
