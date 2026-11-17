import assert from "node:assert/strict";
import test from "node:test";

import { parseZhihuHot } from "./zhihu";

const PAYLOAD = {
  data: [
    {
      target: {
        id: 2105588251100700700,
        title: "中俄美元首将在深圳举行会晤，有哪些信息值得关注？",
        url: "https://api.zhihu.com/questions/2105588251100700718",
        excerpt: "问题描述",
        created: 1794791359,
        answer_count: 42,
      },
    },
    {
      target: {
        title: "没有可识别链接的条目",
        url: "https://example.com/not-a-question",
      },
    },
  ],
};

test("parseZhihuHot re-points the api link at the web question page", () => {
  const items = parseZhihuHot(PAYLOAD, "zhihu-hot", "tech");
  assert.equal(items.length, 1);
  const [item] = items;
  // The id is taken from the url string: `target.id` arrives as a JS number and
  // loses its last digits above 2^53.
  assert.equal(item.url, "https://www.zhihu.com/question/2105588251100700718");
  assert.equal(item.title, "中俄美元首将在深圳举行会晤，有哪些信息值得关注？");
  assert.equal(item.meta, "42 回答");
});

test("parseZhihuHot leaves publishedAt unset so the heat order survives the date sort", () => {
  const items = parseZhihuHot(PAYLOAD, "zhihu-hot", "tech");
  assert.equal(items[0].publishedAt, undefined);
});

test("parseZhihuHot strips the question title that hot-list excerpts restate", () => {
  const items = parseZhihuHot(PAYLOAD, "zhihu-hot", "tech");
  assert.equal(items[0].excerpt, "问题描述");
});

test("parseZhihuHot drops entries whose url is not a question link", () => {
  const items = parseZhihuHot(PAYLOAD, "zhihu-hot", "tech");
  assert.ok(items.every((i) => i.title !== "没有可识别链接的条目"));
});

test("parseZhihuHot fails loudly when the payload has no data array", () => {
  assert.throws(() => parseZhihuHot({}, "zhihu-hot", "tech"), /zhihu zhihu-hot: missing data array/);
});
