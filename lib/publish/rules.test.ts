import assert from "node:assert/strict";
import test from "node:test";

import { COMMON_RULES, DEFAULT_MATERIAL_BUDGET, clipMaterial } from "./rules";

test("COMMON_RULES keeps the draft's own voice", () => {
  assert.match(COMMON_RULES, /叙述视角/);
  assert.match(COMMON_RULES, /不转述别人怎么报道/);
  assert.match(COMMON_RULES, /不出现在稿子里/);
});

test("clipMaterial gives a single block the whole budget", () => {
  const body = "x".repeat(DEFAULT_MATERIAL_BUDGET - 10);
  const clipped = clipMaterial([body]);
  assert.deepEqual(clipped.blocks, [body]);
  assert.deepEqual(clipped.truncated, []);
});

test("clipMaterial splits the budget evenly across blocks", () => {
  const long = "x".repeat(20_000);
  const { blocks, truncated } = clipMaterial([long, "短", long], 12_000);
  assert.deepEqual(truncated, [1, 3]);
  assert.ok(blocks[0].length < 5_000);
  assert.ok(blocks[2].length < 5_000);
  assert.equal(blocks[1], "短");
  assert.match(blocks[0], /（材料在此截断）$/);
});

test("clipMaterial leaves blocks under their share untouched", () => {
  const { blocks, truncated } = clipMaterial(["aaa", "bbb"], 20_000);
  assert.deepEqual(blocks, ["aaa", "bbb"]);
  assert.deepEqual(truncated, []);
});

test("clipMaterial returns nothing for empty material", () => {
  assert.deepEqual(clipMaterial([]), { blocks: [], truncated: [] });
});
