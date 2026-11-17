import assert from "node:assert/strict";
import test from "node:test";

import { auditPairing, pairingViolation } from "./pairing";
import type { SourceDef } from "../sources/types";

const ORDER: Record<string, string[]> = {
  tech: ["cn-video", "ai-news"],
  politics: ["china", "world"],
};

function source(overrides: Partial<SourceDef> = {}): SourceDef {
  return {
    id: "sample",
    name: "Sample",
    type: "rss",
    url: "https://example.com/feed.xml",
    category: "tech",
    subcategory: "cn-video",
    ...overrides,
  };
}

test("pairingViolation accepts a subcategory the category lists", () => {
  assert.equal(pairingViolation("tech", "sample", "cn-video", ORDER.tech), undefined);
});

test("pairingViolation names the bucket category for a subcategory listed elsewhere", () => {
  assert.equal(
    pairingViolation("politics", "sample", "cn-video", ORDER.politics),
    "source 'sample' declares subcategory 'cn-video', which categories.config.json does not list under 'politics'",
  );
});

test("pairingViolation rejects a source with no subcategory in a split category", () => {
  assert.equal(
    pairingViolation("tech", "sample", undefined, ORDER.tech),
    "source 'sample' declares subcategory '(none)', which categories.config.json does not list under 'tech'",
  );
});

test("pairingViolation accepts any subcategory in a flat category", () => {
  assert.equal(pairingViolation("flat", "sample", undefined, undefined), undefined);
});

test("auditPairing reports enabled sources only, and skips undeclared categories", () => {
  const issues = auditPairing(
    [
      source({ id: "ok" }),
      source({ id: "moved", category: "politics" }),
      source({ id: "off", category: "politics", enabled: false }),
      source({ id: "orphan", category: "gone" }),
      source({ id: "bare", subcategory: undefined }),
    ],
    ORDER,
  );
  assert.deepEqual(
    issues.map((i) => i.sourceId),
    ["moved", "bare"],
  );
});
