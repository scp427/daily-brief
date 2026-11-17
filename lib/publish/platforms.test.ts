import assert from "node:assert/strict";
import test from "node:test";

import {
  PLATFORM_IDS,
  availableShapes,
  countWords,
  getPieceType,
  getPlatform,
  parsePlatformList,
  resolveShape,
  structureRules,
} from "./platforms";

test("every advertised platform/piece combination declares a usable budget", () => {
  assert.deepEqual(PLATFORM_IDS.slice().sort(), ["wechat", "weibo", "xiaohongshu"]);
  assert.deepEqual(availableShapes().sort(), [
    "wechat/article",
    "wechat/digest",
    "wechat/topic",
    "weibo/article",
    "xiaohongshu/article",
  ]);
  for (const combo of availableShapes()) {
    const [platform, piece] = combo.split("/");
    const shape = resolveShape(getPlatform(platform).id, getPieceType(piece));
    const [min, max] = shape.words;
    assert.ok(min > 0 && max > min, `${combo} 的字数区间非法`);
    assert.ok(shape.guidance.trim().length > 0, `${combo} 缺少风格指引`);
    assert.ok(structureRules(shape).length > 0, `${combo} 缺少结构规则`);
  }
});

test("resolveShape rejects a combination the table does not implement", () => {
  assert.throws(
    () => resolveShape("weibo", "topic"),
    /微博尚未支持主题稿。可用组合：wechat\/article/,
  );
});

test("digest leaves the section count to the material", () => {
  const digest = resolveShape("wechat", "digest");
  assert.equal(digest.headings, "any");
  assert.equal(digest.headingUnit, "条");
  assert.match(structureRules(digest).join("\n"), /数量与给定素材条数相同/);
});

test("getPlatform rejects an unknown id and lists what exists", () => {
  assert.throws(
    () => getPlatform("douyin"),
    /未知的目标平台：douyin.*wechat, weibo, xiaohongshu/,
  );
});

test("parsePlatformList keeps order, drops duplicates, rejects unknowns", () => {
  assert.deepEqual(
    parsePlatformList("weibo, wechat ,weibo").map((p) => p.id),
    ["weibo", "wechat"],
  );
  assert.throws(() => parsePlatformList(" , "), /--platform 为空/);
  assert.throws(() => parsePlatformList("wechat,toutiao"), /未知的目标平台/);
});

test("structureRules states what the platform forbids", () => {
  const weibo = structureRules(resolveShape("weibo", "article")).join("\n");
  assert.match(weibo, /不使用 `##` 小标题/);
  assert.match(weibo, /2-3 个 `#话题#`/);
  const wechat = structureRules(resolveShape("wechat", "article")).join("\n");
  assert.match(wechat, /3-5 个 `##` 小标题/);
  assert.match(wechat, /不使用 `#话题#` 标签/);
});

test("countWords ignores markdown syntax, image syntax and whitespace", () => {
  const md = "## 标题\n\n这是 **正文**，[链接](https://a.b) 与 ![图](IMG1)。\n\n- 列表项";
  assert.equal(countWords(md), "标题这是正文，链接与。列表项".length);
});
