import assert from "node:assert/strict";
import test from "node:test";

import { ArticleFetchError, extractArticle } from "./article-body";
import { resolvePicks } from "./picks";

function page(inner: string, head = ""): string {
  return `<!doctype html><html><head><title>Fallback Title</title>${head}</head><body>${inner}</body></html>`;
}

// Kept long enough that three copies clear the 400-char floor a real
// article must pass; the extractor's threshold is intentionally not
// injectable, so the fixture has to look like prose.
const PARAGRAPH = "这是一段足够长的正文段落，用于验证正文抽取器不把短小的导航条目当成正文内容。".repeat(4);

test("extractArticle picks the longest candidate container and drops chrome", () => {
  const html = page(`
    <nav><p>首页 上一页 目录</p></nav>
    <div class="content"><p>短</p></div>
    <article>
      <h2>小标题</h2>
      <p>${PARAGRAPH}</p>
      <p>${PARAGRAPH.replace("这是一段", "第二段")}</p>
      <p>${PARAGRAPH.replace("这是一段", "第三段")}</p>
      <script>window.ads = "should not appear";</script>
      <style>.x { color: red }</style>
    </article>
  `);

  const result = extractArticle(html, "https://example.com/a");
  assert.equal(result.title, "Fallback Title");
  assert.equal(result.blocks[0], "## 小标题");
  assert.deepEqual(result.blocks.slice(1), [
    PARAGRAPH,
    PARAGRAPH.replace("这是一段", "第二段"),
    PARAGRAPH.replace("这是一段", "第三段"),
  ]);
  assert.ok(result.charCount >= 400);
  assert.ok(!result.blocks.join("\n").includes("should not appear"));
  assert.ok(!result.blocks.some((b) => b.includes("首页 上一页")));
});

test("extractArticle rejects pages with almost no readable text", () => {
  const html = page(`<article><p>太短了，抓不到正文。</p></article>`);
  assert.throws(
    () => extractArticle(html, "https://example.com/b"),
    (err: unknown) =>
      err instanceof ArticleFetchError && /反爬拦截或挑战页/.test(err.message),
  );
});

test("extractArticle distinguishes text without paragraph structure", () => {
  const html = page(`<div class="shell">${PARAGRAPH.repeat(3)}</div>`);
  assert.throws(
    () => extractArticle(html, "https://example.com/f"),
    (err: unknown) =>
      err instanceof ArticleFetchError && /JS 渲染或非文章页/.test(err.message),
  );
});

test("extractArticle prefers og:title and resolves relative images", () => {
  const head = `
    <meta property="og:title" content="OG 标题">
    <meta property="og:image" content="/img/cover.jpg">
  `;
  const html = page(
    `<article><p>${PARAGRAPH}（一）</p><p>${PARAGRAPH}（二）</p><p>${PARAGRAPH}（三）</p>
      <img src="/img/inline-1.jpg" width="800" height="600">
      <img src="https://cdn.example.com/inline-2.png">
      <img src="/img/icon.png" width="16" height="16">
      <img src="data:image/gif;base64,R0lGOD">
    </article>`,
    head,
  );

  const result = extractArticle(html, "https://example.com/news/1");
  assert.equal(result.title, "OG 标题");
  assert.equal(result.ogImage, "https://example.com/img/cover.jpg");
  assert.deepEqual(result.images, [
    "https://example.com/img/inline-1.jpg",
    "https://cdn.example.com/inline-2.png",
  ]);
});

test("extractArticle falls back to twitter:image and h1", () => {
  const head = `<meta name="twitter:image" content="https://cdn.example.com/t.jpg">`;
  const html = page(
    `<main><h1>正文标题</h1><p>${PARAGRAPH}（一）</p><p>${PARAGRAPH}（二）</p><p>${PARAGRAPH}（三）</p></main>`,
    head,
  );
  const result = extractArticle(html, "https://example.com/c");
  assert.equal(result.title, "正文标题");
  assert.equal(result.ogImage, "https://cdn.example.com/t.jpg");
});

test("extractArticle falls back to body when no container matches", () => {
  const html = page(
    `<div class="wrapper">
       <p>${PARAGRAPH}（一）</p>
       <p>${PARAGRAPH}（二）</p>
       <p>${PARAGRAPH}（三）</p>
       <ul><li>导航项一</li><li>导航项二</li></ul>
     </div>`,
  );
  const result = extractArticle(html, "https://example.com/d");
  assert.equal(result.blocks.length, 3);
  assert.ok(!result.blocks.some((b) => b.startsWith("导航项")));
});

test("extractArticle names the page title when extraction yields nothing", () => {
  const html = `<!doctype html><html><head><title>Just a moment...</title></head><body><div id="challenge"></div></body></html>`;
  assert.throws(
    () => extractArticle(html, "https://example.com/e"),
    (err: unknown) =>
      err instanceof ArticleFetchError &&
      /Just a moment/.test(err.message) &&
      /反爬拦截或挑战页/.test(err.message),
  );
});

function article(title: string, url: string): { title: string; url: string } {
  return { title, url };
}

const POOL = [
  article("OpenAI 发布新模型", "https://a.example.com/1"),
  article("OpenAI 发布新模型（附解读）", "https://b.example.com/2"),
  article("英伟达财报超预期", "https://c.example.com/3"),
];

test("resolvePicks matches urls exactly and reports misses", () => {
  const { picked, problems } = resolvePicks(POOL, ["https://c.example.com/3"]);
  assert.deepEqual(picked.map((p) => p.url), ["https://c.example.com/3"]);
  assert.deepEqual(problems, []);

  const miss = resolvePicks(POOL, ["https://nope.example.com/9"]);
  assert.equal(miss.picked.length, 0);
  assert.match(miss.problems[0], /没有匹配|no article/);
});

test("resolvePicks accepts a unique title substring and rejects ambiguous ones", () => {
  const unique = resolvePicks(POOL, ["英伟达"]);
  assert.deepEqual(unique.picked.map((p) => p.url), ["https://c.example.com/3"]);

  const ambiguous = resolvePicks(POOL, ["OpenAI"]);
  assert.equal(ambiguous.picked.length, 0);
  assert.match(ambiguous.problems[0], /命中 2 条/);
  assert.match(ambiguous.problems[0], /https:\/\/a\.example\.com\/1/);
});

test("resolvePicks keeps input order and drops duplicates", () => {
  const { picked } = resolvePicks(POOL, [
    "https://c.example.com/3",
    "英伟达",
    "https://a.example.com/1",
  ]);
  assert.deepEqual(picked.map((p) => p.url), [
    "https://c.example.com/3",
    "https://a.example.com/1",
  ]);
});
