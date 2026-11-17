import assert from "node:assert/strict";
import test from "node:test";
import {
  buildPanels,
  categories,
  mainPanelSubs,
  validateCategoriesConfig,
} from "./categories";

/** Minimal config that the validator accepts; cases below break one field. */
function config(): Record<string, unknown> {
  return {
    categories: [
      {
        id: "alpha",
        labelZh: "甲",
        labelEn: "Alpha",
        digestCount: "3-5",
        payloadLimit: 20,
        fallbackLimit: 5,
        summaryStyle: "intro",
        subcategories: [{ id: "alpha-news", labelZh: "甲新闻", labelEn: "Alpha News" }],
      },
      {
        id: "beta",
        labelZh: "乙",
        labelEn: "Beta",
        digestCount: "2-3",
        payloadLimit: 15,
        fallbackLimit: 3,
        summaryStyle: "news",
        dropSports: true,
        subcategories: [
          { id: "beta-news", labelZh: "乙新闻", labelEn: "Beta News", mergeLimit: 12 },
        ],
      },
    ],
    extraPanels: [
      {
        id: "alpha-forum",
        labelZh: "论坛",
        labelEn: "Forum",
        sourceCategory: "alpha",
        subcategories: ["alpha-news"],
      },
    ],
  };
}

test("validateCategoriesConfig accepts a well-formed config", () => {
  const parsed = validateCategoriesConfig(config());
  assert.deepEqual(
    parsed.categories.map((c) => c.id),
    ["alpha", "beta"],
  );
  assert.equal(parsed.extraPanels[0]?.sourceCategory, "alpha");
});

test("validateCategoriesConfig rejects duplicate category and subcategory ids", () => {
  const dupCategory = config() as { categories: Record<string, unknown>[] };
  const [firstCategory] = dupCategory.categories;
  dupCategory.categories.push({ ...firstCategory });
  assert.throws(() => validateCategoriesConfig(dupCategory), /duplicate category id 'alpha'/);

  const dupSub = config() as unknown as { categories: { subcategories: unknown[] }[] };
  dupSub.categories[1]!.subcategories.push({
    id: "alpha-news",
    labelZh: "重复",
    labelEn: "Duplicate",
  });
  assert.throws(() => validateCategoriesConfig(dupSub), /duplicate subcategory id 'alpha-news'/);
});

test("validateCategoriesConfig rejects extra panels that claim unknown subcategories", () => {
  const cfg = config() as unknown as { extraPanels: { subcategories: string[] }[] };
  cfg.extraPanels[0]!.subcategories = ["alpha-missing"];
  assert.throws(
    () => validateCategoriesConfig(cfg),
    /extraPanels\[0\].*'alpha-missing'.*not declared/,
  );
});

test("validateCategoriesConfig rejects an unknown trading insertAfter", () => {
  const cfg = config();
  cfg.tradingPanel = { labelZh: "行情", labelEn: "Markets", insertAfter: "gamma" };
  assert.throws(() => validateCategoriesConfig(cfg), /'insertAfter' 'gamma' is not a declared category/);
});

test("validateCategoriesConfig rejects a malformed digestCount and a bad style", () => {
  const badCount = config() as unknown as { categories: { digestCount: string }[] };
  badCount.categories[0]!.digestCount = "three";
  assert.throws(() => validateCategoriesConfig(badCount), /digestCount/);

  const badStyle = config() as unknown as { categories: { summaryStyle: string }[] };
  badStyle.categories[0]!.summaryStyle = "essay";
  assert.throws(() => validateCategoriesConfig(badStyle), /summaryStyle/);
});

test("buildPanels gives every category panel all of its declared subcategories", () => {
  const panels = buildPanels();
  const tech = panels.find((p) => p.id === "tech");

  assert.equal(tech?.sourceCategory, "tech");
  assert.deepEqual(tech?.subcategories?.slice().sort(), [
    "ai-news",
    "cn-community",
    "github-trending",
    "overseas-community",
    "trending-papers",
    "x-viral",
  ]);
  assert.deepEqual(mainPanelSubs("tech"), tech?.subcategories);
});

test("buildPanels inserts the trading panel right after its anchor category", () => {
  const ids = buildPanels().map((p) => p.id);
  assert.equal(ids[1], "trading");
  assert.equal(ids[0], "tech");
});

test("the shipped config labels every category and subcategory", () => {
  for (const c of categories) {
    assert.ok(c.labelZh !== "" && c.labelEn !== "", `${c.id} missing label`);
    assert.ok(c.subcategories.length > 0, `${c.id} has no subcategory`);
    for (const sub of c.subcategories) {
      assert.ok(
        sub.labelZh !== "" && sub.labelEn !== "",
        `${sub.id} missing label`,
      );
    }
  }
});
