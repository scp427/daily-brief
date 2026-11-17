import assert from "node:assert/strict";
import test from "node:test";

import type { DailyReport } from "../ai/pipeline";
import { buildNotifySummary } from "./summary";

function report(overrides: Partial<DailyReport> = {}): DailyReport {
  return {
    hero_headline: "今日头条",
    daily_overview: "总览正文",
    briefs: { tech: [{ title: "技术头条", url: "https://e.com/1", source: "S", summary: "", importance: 1 }] },
    editor_note: "",
    keywords: [],
    ...overrides,
  };
}

test("buildNotifySummary takes one bullet per category and the trading overview", () => {
  const summary = buildNotifySummary("2026-11-17", report({
    trading: {
      market_overview: "美股走强",
      watchlist: [],
      risk_caveat: "仅供参考",
      generated_at: "2026-11-17T00:00:00Z",
      tickers: [],
    },
  }), { maxBullets: 6, baseUrl: "https://example.com/brief" });

  assert.equal(summary.date, "2026-11-17");
  assert.equal(summary.headline, "今日头条");
  assert.deepEqual(summary.bullets, ["技术动态：技术头条"]);
  assert.equal(summary.trading, "美股走强");
  assert.equal(summary.url, "https://example.com/brief/2026-11-17/2026-11-17.html");
});

test("buildNotifySummary turns overview sections into localized labels", () => {
  const summary = buildNotifySummary(
    "2026-11-17",
    report({ overview_sections: [{ category: "tech", text: "技术综述" }] }),
    { maxBullets: 6, baseUrl: "" },
  );
  assert.deepEqual(summary.sections, [{ label: "技术动态", text: "技术综述" }]);
});

test("buildNotifySummary caps bullets and omits the link when baseUrl is empty", () => {
  const summary = buildNotifySummary("2026-11-17", report(), { maxBullets: 0, baseUrl: "" });
  assert.deepEqual(summary.bullets, []);
  assert.equal(summary.url, undefined);
  assert.equal(summary.trading, undefined);
});
