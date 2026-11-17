import assert from "node:assert/strict";
import test from "node:test";

import {
  WECHAT_THEME_IDS,
  getWechatTheme,
  renderWechatHtml,
  splitBlocks,
} from "./wechat-html";

const markdown = [
  "导语一句话，交代这篇稿子要回答什么。",
  "",
  "## 第一节",
  "",
  "正文**重点**在这里。",
  "",
  "![图表说明](IMG1)",
  "",
  "## 第二节",
  "",
  "更多正文。",
].join("\n");

const resolveImage = (ref: string) => `https://mmbiz.example/${ref}.png`;

test("the wrapper font stack keeps the style attribute intact", () => {
  const html = renderWechatHtml({
    markdown,
    theme: getWechatTheme("plain"),
    resolveImage,
  });
  assert.match(html, /font-family:-apple-system,BlinkMacSystemFont,'PingFang SC'/);
  assert.doesNotMatch(html, /font-family:[^";]*"/);
});

test("splitBlocks separates paragraphs, headings and figures", () => {
  const blocks = splitBlocks(markdown);
  assert.deepEqual(
    blocks.map((b) => b.kind),
    ["paragraph", "heading", "paragraph", "image", "heading", "paragraph"],
  );
});

test("journal theme numbers its headings and marks them with a rule", () => {
  const html = renderWechatHtml({
    markdown,
    theme: getWechatTheme("journal"),
    resolveImage,
  });
  assert.match(html, /border-left:3px solid/);
  assert.match(html, />01</);
  assert.match(html, />02</);
  assert.match(html, /第一节/);
  assert.match(html, /https:\/\/mmbiz\.example\/IMG1\.png/);
  assert.match(html, /<strong[^>]*>重点<\/strong>/);
});

test("journal theme enlarges the opening paragraph", () => {
  const html = renderWechatHtml({
    markdown,
    theme: getWechatTheme("journal"),
    resolveImage,
  });
  assert.match(html, /font-size:16\.5px/);
});

test("brief theme renders headings as a filled label and separates items", () => {
  const html = renderWechatHtml({
    markdown,
    theme: getWechatTheme("brief"),
    resolveImage,
  });
  assert.match(html, /background:#eef2ff/);
  assert.match(html, /border-top:1px dashed/);
  assert.doesNotMatch(html, />01</);
});

test("plain theme adds no decoration", () => {
  const html = renderWechatHtml({
    markdown,
    theme: getWechatTheme("plain"),
    resolveImage,
  });
  assert.doesNotMatch(html, /border-left|background:#eef2ff|border-top:1px dashed/);
});

test("escapes body markup and figure captions", () => {
  const html = renderWechatHtml({
    markdown: [
      "## <b>x</b>",
      "",
      "a <script>alert(1)</script>",
      "",
      "![<i>图</i>](IMG9)",
    ].join("\n"),
    theme: getWechatTheme("plain"),
    resolveImage,
  });
  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /&lt;script&gt;/);
  assert.doesNotMatch(html, /<i>图<\/i>/);
  assert.match(html, /&lt;i&gt;图&lt;\/i&gt;/);
});

test("getWechatTheme names the available layouts", () => {
  assert.deepEqual(WECHAT_THEME_IDS, ["journal", "brief", "plain"]);
  assert.throws(() => getWechatTheme("nope"), /未知的公众号版式：nope/);
});
