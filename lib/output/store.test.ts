import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import type { ArticleInput, DailyReport } from "../ai/pipeline";
import type { RawArticle } from "../sources/types";
import {
  mergeRefreshedSource,
  readArticles,
  readReport,
  writeArticles,
  writeHtml,
  writeReport,
} from "./store";

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "brief-store-"));
}

function article(over: Partial<ArticleInput> & { url: string }): ArticleInput {
  return {
    sourceId: "zhihu-hot",
    title: "标题",
    category: "tech",
    source: "知乎热榜",
    ...over,
  };
}

function raw(url: string, title = "新条目"): RawArticle {
  return { sourceId: "zhihu-hot", title, url, category: "tech" };
}

test("the sidecar round-trips publishedAt as a Date", () => {
  const dir = tmpDir();
  const published = new Date("2026-11-16T08:00:00.000Z");
  writeArticles(dir, "2026-11-17", [
    article({ url: "https://a.example/1", publishedAt: published, summary: "已改写" }),
  ]);

  const [back] = readArticles(dir, "2026-11-17");
  assert.ok(back.publishedAt instanceof Date);
  assert.equal(back.publishedAt?.toISOString(), published.toISOString());
  assert.equal(back.summary, "已改写");

  const onDisk = JSON.parse(
    fs.readFileSync(path.join(dir, "2026-11-17", "2026-11-17-articles.json"), "utf8"),
  ) as { articles: Array<{ publishedAt?: string }> };
  assert.equal(onDisk.articles[0].publishedAt, "2026-11-16T08:00:00.000Z");
});

test("undated articles stay undated after a round-trip", () => {
  const dir = tmpDir();
  writeArticles(dir, "2026-11-17", [article({ url: "https://a.example/2" })]);
  const [back] = readArticles(dir, "2026-11-17");
  assert.equal(back.publishedAt, undefined);
});

test("reading a missing sidecar names the file", () => {
  assert.throws(
    () => readArticles(tmpDir(), "2026-11-17"),
    /Articles sidecar not found: .*2026-11-17-articles\.json/,
  );
});

test("a refresh keeps the entries already on disk and appends unseen urls", () => {
  const existing = [
    article({ url: "https://a/1", title: "旧标题", summary: "LLM 摘要" }),
    article({ url: "https://a/2", sourceId: "v2ex-hot" }),
  ];
  const { articles, added } = mergeRefreshedSource(
    existing,
    [raw("https://a/1", "新标题"), raw("https://a/3")],
    "知乎热榜",
  );

  assert.equal(added, 1);
  assert.equal(articles.length, 3);
  assert.equal(articles[0].title, "旧标题");
  assert.equal(articles[0].summary, "LLM 摘要");
  assert.equal(articles[2].url, "https://a/3");
  assert.equal(articles[2].source, "知乎热榜");
});

test("refreshing twice with the same payload adds nothing", () => {
  const first = mergeRefreshedSource(
    [article({ url: "https://a/1" })],
    [raw("https://a/1"), raw("https://a/2")],
    "知乎热榜",
  );
  const second = mergeRefreshedSource(first.articles, [raw("https://a/1"), raw("https://a/2")], "知乎热榜");

  assert.equal(first.added, 1);
  assert.equal(second.added, 0);
  assert.equal(second.articles.length, 2);
});

test("the report JSON round-trips through writeReport", () => {
  const dir = tmpDir();
  const report: DailyReport = {
    hero_headline: "今日要点",
    daily_overview: "概述",
    briefs: {},
    editor_note: "编者按",
    keywords: ["k1"],
  };

  writeReport(dir, "2026-11-17", report);

  assert.deepEqual(readReport(dir, "2026-11-17"), report);
});

test("writeHtml publishes the overflow fragment each long list points at", () => {
  const dir = tmpDir();
  const report: DailyReport = {
    hero_headline: "h",
    daily_overview: "o",
    briefs: {},
    editor_note: "",
    keywords: [],
  };
  const articles: ArticleInput[] = Array.from({ length: 60 }, (_, i) => ({
    sourceId: "bilibili-tech",
    source: "B站科技区",
    title: `视频 ${i}`,
    url: `https://www.bilibili.com/video/${i}`,
    category: "community",
  }));
  const sources = [
    {
      id: "bilibili-tech",
      name: "B站科技区",
      type: "api" as const,
      url: "https://api.bilibili.com/x/web-interface/ranking/v2?rid=188",
      category: "community",
      subcategory: "cn-video",
    },
  ];

  const page = writeHtml(dir, "2026-11-17", report, articles, sources);
  const html = fs.readFileSync(page, "utf8");
  const src = /class="more-slot" data-src="([^"]+)"/.exec(html)?.[1];
  assert.ok(src, "the page must point at a fragment");
  const fragment = fs.readFileSync(path.join(dir, "2026-11-17", src), "utf8");
  assert.equal((html.match(/<article /g) ?? []).length, 20, "first page only");
  assert.equal((fragment.match(/<article /g) ?? []).length, 30, "50 capped items minus page one");
});
