import assert from "node:assert/strict";
import test from "node:test";

import {
  addSource,
  applySourcePatch,
  readSourceConfigLenient,
  removeSource,
  sanitizePatch,
  toSourceDef,
  validateSourceConfig,
} from "./config";
import type { TaxonomyIds } from "../categories";
import type { SourceDef } from "./types";

const TAXONOMY: TaxonomyIds = {
  categories: new Set(["tech"]),
  subcategories: new Set(["ai-news"]),
};

function source(overrides: Partial<SourceDef> = {}): SourceDef {
  return {
    id: "example",
    name: "Example",
    type: "rss",
    url: "https://example.com/feed.xml",
    category: "tech",
    ...overrides,
  };
}

test("validateSourceConfig accepts a minimal source", () => {
  assert.doesNotThrow(() => validateSourceConfig([source()]));
});

test("validateSourceConfig rejects unknown category and duplicate id", () => {
  assert.throws(
    () => validateSourceConfig([source({ category: "sports" as SourceDef["category"] })]),
    /invalid 'category' 'sports'/,
  );
  assert.throws(() => validateSourceConfig([source(), source()]), /duplicate id 'example'/);
});

test("validateSourceConfig rejects malformed locales and keywords", () => {
  assert.throws(
    () => validateSourceConfig([source({ locales: ["fr" as "zh"] })]),
    /'locales' must be an array of "zh" \| "en"/,
  );
  assert.throws(
    () => validateSourceConfig([source({ keywords: "ai" as unknown as string[] })]),
    /'keywords' must be an array of strings/,
  );
  assert.throws(
    () => validateSourceConfig([source({ domestic: "yes" as unknown as boolean })]),
    /'domestic' must be a boolean/,
  );
});

test("sanitizePatch keeps known fields and rejects the rest", () => {
  assert.deepEqual(sanitizePatch({ enabled: false, locales: ["en"], domestic: true }), {
    enabled: false,
    locales: ["en"],
    domestic: true,
  });
  assert.throws(() => sanitizePatch({ category: "tech", bogus: 1 }), /unknown field\(s\): bogus/);
});

test("applySourcePatch merges without letting the id change", () => {
  const next = applySourcePatch([source()], "example", { enabled: false, id: "hijack" } as never);
  assert.equal(next[0].id, "example");
  assert.equal(next[0].enabled, false);
});

test("applySourcePatch rejects an unknown id", () => {
  assert.throws(() => applySourcePatch([source()], "missing", { enabled: true }), /unknown source id/);
});

test("addSource refuses duplicates and removeSource refuses unknowns", () => {
  assert.throws(() => addSource([source()], source()), /duplicate id 'example'/);
  assert.equal(addSource([], source()).length, 1);
  assert.throws(() => removeSource([source()], "missing"), /unknown source id/);
  assert.equal(removeSource([source()], "example").length, 0);
});

test("toSourceDef drops absent optional fields", () => {
  assert.deepEqual(toSourceDef({ id: "a", name: "A", type: "rss", url: "u", category: "tech" }), {
    id: "a",
    name: "A",
    type: "rss",
    url: "u",
    category: "tech",
  });
  const withOptions = toSourceDef({
    id: "b",
    name: "B",
    type: "scrape",
    url: "u",
    category: "finance",
    enabled: false,
    keywords: ["x"],
  });
  assert.equal(withOptions.enabled, false);
  assert.deepEqual(withOptions.keywords, ["x"]);
});

test("toSourceDef keeps the domestic flag so the admin page can flip it", () => {
  const overseas = toSourceDef({ id: "c", name: "C", type: "rss", url: "u", category: "tech", domestic: false });
  assert.equal(overseas.domestic, false);
  const domestic = toSourceDef({ id: "d", name: "D", type: "api", url: "u", category: "tech", domestic: true });
  assert.equal(domestic.domestic, true);
});

test("reference checks use the taxonomy the caller passes", () => {
  assert.doesNotThrow(() =>
    validateSourceConfig([source({ subcategory: "ai-news" })], { taxonomy: TAXONOMY }),
  );
  assert.throws(
    () => validateSourceConfig([source({ subcategory: "cn-video" })], { taxonomy: TAXONOMY }),
    /'subcategory' 'cn-video' is not declared in categories.config.json/,
  );
});

test("a warnings collector downgrades reference errors instead of throwing", () => {
  const warnings: string[] = [];
  const [kept] = validateSourceConfig([source({ subcategory: "cn-video" })], {
    taxonomy: TAXONOMY,
    warnings,
  });
  assert.equal(kept.id, "example");
  assert.deepEqual(warnings, [
    "sources.config.json[0] (example): 'subcategory' 'cn-video' is not declared in categories.config.json",
  ]);
});

test("a warnings collector never swallows shape errors", () => {
  assert.throws(
    () => validateSourceConfig([source({ type: "ftp" as SourceDef["type"] })], { warnings: [] }),
    /invalid 'type' 'ftp'/,
  );
});

test("disabled sources may keep an undeclared subcategory", () => {
  assert.doesNotThrow(() =>
    validateSourceConfig([source({ enabled: false, subcategory: "cn-video" })], { taxonomy: TAXONOMY }),
  );
});

test("readSourceConfigLenient returns the shipped config with no warnings", () => {
  const { sources, warnings } = readSourceConfigLenient();
  assert.ok(sources.length > 0);
  assert.deepEqual(warnings, []);
});
