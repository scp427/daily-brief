import assert from "node:assert/strict";
import test from "node:test";

import type { BriefItem } from "../ai/pipeline";
import {
  DIGEST_MAX_ITEMS,
  buildDigestSystemPrompt,
  buildDigestUserPrompt,
  collectDigestItems,
  parseDigestDraft,
  prepareDigestMaterial,
} from "./digest";
import { resolveShape } from "./platforms";

const digest = resolveShape("wechat", "digest");

function brief(n: number, overrides: Partial<BriefItem> = {}): BriefItem {
  return {
    title: `事件${n}`,
    url: `https://example.com/${n}`,
    source: `来源${n}`,
    summary: `摘要${n}`,
    importance: 5,
    ...overrides,
  };
}

test("collectDigestItems merges the requested categories in order", () => {
  const { items } = collectDigestItems(
    { tech: [brief(1), brief(2)], finance: [brief(3)] },
    ["tech", "finance"],
  );
  assert.deepEqual(items.map((i) => i.title), ["事件1", "事件2", "事件3"]);
});

test("collectDigestItems rejects an unknown category and lists what exists", () => {
  assert.throws(
    () => collectDigestItems({ tech: [] }, ["politics"]),
    /没有这些类别：politics。可用：tech/,
  );
  assert.throws(() => collectDigestItems({ tech: [] }, []), /至少要指定一个类别/);
});

test("collectDigestItems drops duplicate URLs and keeps the first", () => {
  const { items } = collectDigestItems(
    { tech: [brief(1)], finance: [brief(1, { title: "转发的同一件事" })] },
    ["tech", "finance"],
  );
  assert.deepEqual(items.map((i) => i.title), ["事件1"]);
});

test("collectDigestItems sorts by importance and keeps ties in report order", () => {
  const { items } = collectDigestItems(
    { tech: [brief(1), brief(2, { importance: 8 }), brief(3)] },
    ["tech"],
  );
  assert.deepEqual(items.map((i) => i.title), ["事件2", "事件1", "事件3"]);
});

test("collectDigestItems caps the item count and says what it dropped", () => {
  const many = Array.from({ length: DIGEST_MAX_ITEMS + 3 }, (_, i) => brief(i + 1));
  const { items, warnings } = collectDigestItems({ tech: many }, ["tech"]);
  assert.equal(items.length, DIGEST_MAX_ITEMS);
  assert.ok(warnings.some((w) => /超出单篇上限 12 条/.test(w)));
});

test("collectDigestItems reports that a flat importance carries no ordering signal", () => {
  const { warnings } = collectDigestItems({ tech: [brief(1), brief(2), brief(3)] }, ["tech"]);
  assert.match(warnings[0], /全部 3 条重要度都是 5/);
});

test("prepareDigestMaterial marks items without a summary", () => {
  const material = prepareDigestMaterial([
    { title: "有摘要", source: "来源", url: "https://a", summary: "摘要", importance: 5 },
    { title: "没摘要", source: "来源", url: "https://b", summary: "", importance: 4 },
  ]);
  assert.deepEqual(material.unsummarized, [2]);
  assert.match(material.text, /【2】没摘要/);
  assert.match(material.text, /（没有摘要）/);
});

test("prepareDigestMaterial rejects an empty item list", () => {
  assert.throws(() => prepareDigestMaterial([]), /没有可用的资讯条目/);
});

test("buildDigestUserPrompt asks for one section per item", () => {
  const prompt = buildDigestUserPrompt([brief(1), brief(2)]);
  assert.match(prompt, /当天共 2 条/);
  assert.match(prompt, /写 2 个 `##` 条目/);
  assert.match(prompt, /每条 100-150 字/);
});

test("buildDigestSystemPrompt keeps sources out of the draft", () => {
  const prompt = buildDigestSystemPrompt(digest);
  assert.match(prompt, /不写来源与出处/);
  assert.match(prompt, /叙述视角/);
});

test("parseDigestDraft warns on item count and per-item length, never on the shape", () => {
  const body = [
    "导语一段。",
    `## 事件一\n\n${"字".repeat(120)}`,
    `## 事件二\n\n${"字".repeat(40)}`,
    `## 事件三\n\n${"字".repeat(120)}`,
  ].join("\n\n");
  const draft = parseDigestDraft(`TITLE: 今日速览\n\n${body}`, digest, 2);
  assert.equal(draft.sections.length, 3);
  assert.match(draft.warnings.join("\n"), /条目 3 个，材料 2 条/);
  assert.match(draft.warnings.join("\n"), /第 2 条 43 字，目标 100-150 字/);
});
