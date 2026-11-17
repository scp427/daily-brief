import assert from "node:assert/strict";
import test from "node:test";

import { groupRaw, renderHtml, renderOverflowFiles } from "./render";
import type { DailyReport } from "../ai/pipeline";
import type { SourceDef } from "../sources/types";

function report(): DailyReport {
  return {
    hero_headline: "h",
    daily_overview: "o",
    briefs: {},
    editor_note: "",
    keywords: [],
  };
}

function source(overrides: Partial<SourceDef> = {}): SourceDef {
  return {
    id: "sample",
    name: "Sample",
    type: "rss",
    url: "https://example.com/feed.xml",
    category: "politics",
    ...overrides,
  };
}

function article(sourceId: string, category: string): ArticleLike {
  return { sourceId, source: sourceId, title: "t", url: "https://example.com/a", category };
}

type ArticleLike = {
  sourceId: string;
  source: string;
  title: string;
  url: string;
  category: string;
  publishedAt?: Date;
};

function many(sourceId: string, category: string, count: number): ArticleLike[] {
  return Array.from({ length: count }, (_, i) => ({
    sourceId,
    source: sourceId,
    title: `${sourceId}-${i}`,
    url: `https://example.com/${sourceId}/${i}`,
    category,
  }));
}

test("groupRaw rejects a source with no subcategory in a split category", () => {
  assert.throws(
    () => groupRaw([article("sample", "politics")], [source({ subcategory: undefined })]),
    /source 'sample' declares subcategory '\(none\)'.*under 'politics'/,
  );
});

test("groupRaw rejects a subcategory that categories.config.json does not declare", () => {
  assert.throws(
    () => groupRaw([article("sample", "politics")], [source({ subcategory: "nope" })]),
    /declares subcategory 'nope'.*under 'politics'/,
  );
});

test("groupRaw buckets by the registry's category so a retagged source leaves its old tab", () => {
  const registry = [source({ id: "sample", category: "community", subcategory: "cn-video" })];
  // The sidecar still carries the category recorded before the retag.
  const grouped = groupRaw([article("sample", "tech")], registry);
  assert.deepEqual(grouped.tech, []);
  assert.deepEqual(
    grouped.community?.flatMap((sub) => sub.sources.map((s) => s.sourceId)),
    ["sample"],
  );
});

test("a subcategory with no items renders no tab", () => {
  const registry = [
    source({ id: "github-hot", category: "tech", subcategory: "github-trending" }),
    source({ id: "v2ex-hot", category: "tech", subcategory: "cn-community" }),
  ];
  const html = renderHtml(
    report(),
    groupRaw([article("v2ex-hot", "tech")], registry),
    "2026-11-16",
  );
  assert.match(html, /id="subcontent-tech-cn-community"/);
  assert.doesNotMatch(html, /github-trending/);
});

test("a subcategory whose only source returned nothing renders no tab", () => {
  const registry = [
    source({ id: "v2ex-hot", category: "tech", subcategory: "cn-community" }),
    source({ id: "github-hot", category: "tech", subcategory: "github-trending" }),
  ];
  const raw = groupRaw([article("v2ex-hot", "tech")], registry);
  // groupRaw still pre-seeds the enabled-but-empty source; the panel drops it.
  assert.deepEqual(
    raw.tech.find((s) => s.id === "github-trending")?.sources.map((g) => g.items.length),
    [0],
  );
  assert.doesNotMatch(renderHtml(report(), raw, "2026-11-16"), /subcontent-tech-github-trending/);
});

test("groupRaw buckets a domestic politics source under its own subcategory", () => {
  const registry = [
    source({ id: "people-world", subcategory: "china" }),
    source({ id: "bbc-world", subcategory: "world" }),
  ];
  const grouped = groupRaw(
    [article("people-world", "politics"), article("bbc-world", "politics")],
    registry,
  );
  assert.deepEqual(
    grouped.politics.map((sub) => sub.id),
    ["china", "world"],
  );
});

test("groupRaw skips an empty subcategory instead of rendering a tab for it", () => {
  const grouped = groupRaw([article("bbc-world", "politics")], [
    source({ id: "bbc-world", subcategory: "world" }),
  ]);
  assert.deepEqual(
    grouped.politics.map((sub) => sub.id),
    ["world"],
  );
});

test("the default L2 tab merges every subcategory under the panel", () => {
  const registry = [
    source({ id: "people-world", name: "人民网", subcategory: "china" }),
    source({ id: "bbc-world", name: "BBC", subcategory: "world" }),
  ];
  const html = renderHtml(
    report(),
    groupRaw(
      [article("people-world", "politics"), article("bbc-world", "politics")],
      registry,
    ),
    "2026-11-16",
  );
  assert.match(
    html,
    /class="sub-tab active" data-sub="__all" data-cat="politics">全部<span class="count">2<\/span>/,
  );
  assert.match(html, /data-sub-content="__all"/);
});

test("every article carries its subcategory and source as tags", () => {
  const html = renderHtml(
    report(),
    groupRaw([article("people-world", "politics")], [
      source({ id: "people-world", name: "人民网", subcategory: "china" }),
    ]),
    "2026-11-16",
  );
  assert.match(html, /<span class="tag tag-cat">国内时政<\/span>/);
  assert.match(html, /<span class="tag tag-src">people-world<\/span>/);
});

test("the merged L2 list is ordered newest first with undated items last", () => {
  const registry = [
    source({ id: "people-world", subcategory: "china" }),
    source({ id: "bbc-world", subcategory: "world" }),
  ];
  const older = { ...article("people-world", "politics"), title: "older", publishedAt: new Date("2026-11-01T00:00:00Z") };
  const newer = { ...article("bbc-world", "politics"), title: "newer", publishedAt: new Date("2026-11-16T00:00:00Z") };
  const undated = { ...article("bbc-world", "politics"), title: "undated" };
  const html = renderHtml(report(), groupRaw([older, newer, undated], registry), "2026-11-16");
  const mergedStart = html.indexOf('data-sub-content="__all"');
  const merged = html.slice(mergedStart, mergedStart + 6000);
  assert.ok(merged.indexOf("newer") < merged.indexOf("older"), "newer before older");
  assert.ok(merged.indexOf("older") < merged.indexOf("undated"), "undated sorts last");
});

test("groupRaw caps each source at 50 items and a subcategory at 100 in total", () => {
  const registry = [
    source({ id: "a-source", subcategory: "china" }),
    source({ id: "b-source", subcategory: "china" }),
    source({ id: "c-source", subcategory: "china" }),
  ];
  const grouped = groupRaw(
    [
      ...many("a-source", "politics", 120),
      ...many("b-source", "politics", 120),
      ...many("c-source", "politics", 120),
    ],
    registry,
  );
  const [china] = grouped.politics;
  assert.equal(china.sources.length, 3, "every source keeps its L3 tab");
  assert.deepEqual(
    china.sources.map((s) => s.items.length),
    [50, 50, 0],
    "the subcategory budget is spent in source order",
  );
});

test("a list longer than one page renders 20 articles and points at an overflow fragment", () => {
  const registry = [source({ id: "a-source", subcategory: "china" })];
  const raw = groupRaw(many("a-source", "politics", 60), registry);
  const html = renderHtml(report(), raw, "2026-11-16");
  const cut = html.indexOf('class="more-slot"');
  assert.ok(cut > 0, "a 50-item list needs a more-slot");
  assert.equal(
    (html.slice(0, cut).match(/<article /g) ?? []).length,
    20,
    "only the first page renders inline",
  );
  assert.match(
    html,
    /data-src="2026-11-16-overflow\/politics__china__a-source\.html"/,
  );

  const fragment = renderOverflowFiles(raw, "2026-11-16").find((f) =>
    f.name.endsWith("politics__china__a-source.html"),
  );
  assert.ok(fragment, "the fragment the page points at must exist");
  assert.equal((fragment.html.match(/<article /g) ?? []).length, 30, "30 items past page one");
  assert.equal((fragment.html.match(/<section class="more-page"/g) ?? []).length, 2);
  assert.match(fragment.html, /<section class="more-page" data-page="2" hidden>/);
});

test("the merged All list holds at most 100 entries and spills the rest", () => {
  const registry = [
    source({ id: "a-source", subcategory: "china" }),
    source({ id: "b-source", subcategory: "world" }),
  ];
  // china caps at 50 per source; world is a merged L2 capped at its mergeLimit.
  const raw = groupRaw(
    [...many("a-source", "politics", 80), ...many("b-source", "politics", 80)],
    registry,
  );
  const html = renderHtml(report(), raw, "2026-11-16");
  assert.match(html, /data-src="2026-11-16-overflow\/politics__all\.html"/);

  const fragment = renderOverflowFiles(raw, "2026-11-16").find((f) =>
    f.name.endsWith("politics__all.html"),
  );
  assert.ok(fragment, "the merged list must spill into its own fragment");
  const allStart = html.indexOf('data-sub-content="__all"');
  const allTab = html.slice(allStart, html.indexOf('class="more-slot"', allStart));
  assert.equal((allTab.match(/<article /g) ?? []).length, 20, "All tab shows one page inline");
  assert.equal(
    (fragment.html.match(/<article /g) ?? []).length,
    45,
    "65 entries (50 + 15 merged) minus the inline page",
  );
});
