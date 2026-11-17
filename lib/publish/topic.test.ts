import assert from "node:assert/strict";
import test from "node:test";

import { resolveShape } from "./platforms";
import {
  buildTopicSystemPrompt,
  buildTopicUserPrompt,
  prepareTopicMaterial,
  type TopicSource,
} from "./topic";

const topic = resolveShape("wechat", "topic");

function source(n: number, text = `材料${n}正文`): TopicSource {
  return {
    title: `标题${n}`,
    source: `媒体${n}`,
    url: `https://example.com/${n}`,
    blocks: [text],
  };
}

test("prepareTopicMaterial numbers sources in the given order", () => {
  const material = prepareTopicMaterial([source(1), source(2)]);
  assert.match(material.text, /【1】媒体1 · 标题1\nhttps:\/\/example\.com\/1/);
  assert.match(material.text, /【2】媒体2 · 标题2/);
  assert.ok(material.text.indexOf("【1】") < material.text.indexOf("【2】"));
});

test("prepareTopicMaterial splits the budget per source and names the cut ones", () => {
  const long = "x".repeat(20_000);
  const material = prepareTopicMaterial([source(1, long), source(2, "短")], 10_000);
  assert.equal(material.perSource, 5_000);
  assert.deepEqual(material.truncated, [1]);
  assert.ok(material.text.length < 12_000);
});

test("prepareTopicMaterial rejects an empty source list", () => {
  assert.throws(() => prepareTopicMaterial([]), /至少要有一篇来源材料/);
});

test("prepareTopicMaterial marks a source without a name", () => {
  const material = prepareTopicMaterial([{ ...source(1), source: null }]);
  assert.match(material.text, /【1】未标注来源 · 标题1/);
});

test("buildTopicUserPrompt carries the topic, the source count and every figure ref", () => {
  const prompt = buildTopicUserPrompt({
    topic: "英伟达财报",
    sources: [source(1), source(2)],
    assets: [
      { ref: "IMG1", sourceUrl: "https://example.com/1.jpg", relPath: "assets/1.jpg" },
      { ref: "IMG3", sourceUrl: "https://example.com/3.jpg", relPath: "assets/3.jpg" },
    ],
  });
  assert.match(prompt, /话题：英伟达财报/);
  assert.match(prompt, /以下 2 篇材料/);
  assert.match(prompt, /IMG1: https:\/\/example\.com\/1\.jpg/);
  assert.match(prompt, /IMG3: https:\/\/example\.com\/3\.jpg/);
});

test("buildTopicSystemPrompt states the multi-source rules", () => {
  const prompt = buildTopicSystemPrompt(topic);
  assert.match(prompt, /话题/);
  assert.match(prompt, /稿型：主题稿/);
  assert.match(prompt, /不得择一隐去/);
  assert.match(prompt, /不能合成/);
  assert.match(prompt, /先立论再落笔/);
  assert.match(prompt, /不按材料顺序逐篇复述/);
  assert.match(prompt, /叙述视角/);
  assert.match(prompt, /3-5 个 `##` 小标题/);
});
