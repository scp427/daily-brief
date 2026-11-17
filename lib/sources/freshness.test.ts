import assert from "node:assert/strict";
import test from "node:test";

import { judgeFreshness, newestPublishedAt } from "./freshness";

const now = new Date("2026-11-16T12:00:00Z");

function daysAgo(days: number): Date {
  return new Date(now.getTime() - days * 86_400_000);
}

test("newestPublishedAt picks the latest dated entry and ignores undated ones", () => {
  const newest = newestPublishedAt([
    { publishedAt: daysAgo(9) },
    {},
    { publishedAt: daysAgo(1) },
    { publishedAt: daysAgo(4) },
  ]);
  assert.equal(newest?.toISOString(), daysAgo(1).toISOString());
});

test("newestPublishedAt returns undefined when every entry lacks a date", () => {
  assert.equal(newestPublishedAt([{}, {}]), undefined);
});

test("judgeFreshness reports empty when the source returned nothing", () => {
  const check = judgeFreshness(0, undefined, now, 14);
  assert.equal(check.verdict, "empty");
  assert.equal(check.itemCount, 0);
});

test("judgeFreshness reports undated rather than guessing stale", () => {
  const check = judgeFreshness(3, undefined, now, 14);
  assert.equal(check.verdict, "undated");
  assert.equal(check.itemCount, 3);
});

test("judgeFreshness keeps a source inside the window fresh", () => {
  const check = judgeFreshness(5, daysAgo(2), now, 14);
  assert.equal(check.verdict, "fresh");
  assert.equal(check.ageDays, 2);
});

test("judgeFreshness marks a source past the window stale", () => {
  const check = judgeFreshness(5, daysAgo(21), now, 14);
  assert.equal(check.verdict, "stale");
  assert.equal(check.ageDays, 21);
});

test("judgeFreshness treats the window boundary as fresh", () => {
  assert.equal(judgeFreshness(1, daysAgo(14), now, 14).verdict, "fresh");
  assert.equal(judgeFreshness(1, daysAgo(15), now, 14).verdict, "stale");
});
