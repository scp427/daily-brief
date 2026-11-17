import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  applySourcePatch,
  CONFIG_PATH,
  sanitizePatch,
  serializeSourceConfig,
  validateSourceConfig,
} from "./config";
import type { SourceDef } from "./types";

function config(sources: Partial<SourceDef>[]): SourceDef[] {
  return validateSourceConfig(
    sources.map((s) => ({ id: "s", name: "S", type: "rss", url: "u", category: "tech", ...s })),
  );
}

test("applySourcePatch merges the given fields and keeps the id", () => {
  const next = applySourcePatch(config([{ name: "Before" }]), "s", {
    name: "After",
    category: "finance",
  });
  assert.equal(next[0].name, "After");
  assert.equal(next[0].category, "finance");
  assert.equal(next[0].id, "s");
});

test("applySourcePatch deletes an optional field sent as null", () => {
  const next = applySourcePatch(
    config([{ locales: ["zh"], keywords: ["ai"], useCurl: true, domestic: true }]),
    "s",
    { locales: null, keywords: null, useCurl: null, domestic: null },
  );
  for (const key of ["locales", "keywords", "useCurl", "domestic"]) {
    assert.equal(key in next[0], false, `${key} should be gone`);
  }
});

test("serializeSourceConfig keeps one source per line with inline arrays", () => {
  const text = serializeSourceConfig(config([{ locales: ["zh", "en"] }, { id: "t", domestic: true }]));
  const lines = text.trimEnd().split("\n");
  assert.equal(lines[0], "[");
  assert.equal(lines.at(-1), "]");
  assert.equal(lines.length, 4);
  assert.match(lines[1], /^\s*\{.*\}\w*,?$|^\s*\{.*\},$/);
  assert.match(lines[1], /"locales":\["zh","en"\]/);
  assert.deepEqual(JSON.parse(text), config([{ locales: ["zh", "en"] }, { id: "t", domestic: true }]));
});

test("sanitizePatch refuses an id so a rename cannot orphan the entry", () => {
  assert.throws(() => sanitizePatch({ id: "other", name: "x" }), /unknown field\(s\): id/);
});

test("sources.config.json is byte-identical to what the serializer writes", () => {
  // Hand edits with a different whitespace style reflow every line and bury
  // the real change; the admin server always writes through this serializer.
  const raw = readFileSync(CONFIG_PATH, "utf8");
  assert.equal(serializeSourceConfig(validateSourceConfig(JSON.parse(raw))), raw);
});
