import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  describeFindings,
  listDraftPlatforms,
  listReviewRoots,
  readPieceMaterial,
  stripTitle,
} from "./drafts";
import type { ReviewReport } from "./review";

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "drafts-"));
}

function write(dir: string, name: string, body: unknown): void {
  const file = path.join(dir, name);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(body), "utf8");
}

test("stripTitle drops the title line and keeps the body", () => {
  assert.equal(stripTitle("# 标题\n\n## 一\n\n正文。\n"), "## 一\n\n正文。");
});

test("stripTitle refuses a draft without a title line", () => {
  assert.throws(() => stripTitle("## 一\n\n正文。"), /首行不是 `# 标题`/);
});

test("listDraftPlatforms returns the platform-named drafts only", () => {
  const dir = tmpDir();
  for (const name of ["wechat.json", "wechat.md", "wechat.review.json", "materials.json", "picks.json", "bodies.json"]) {
    write(dir, name, {});
  }
  assert.deepEqual(
    listDraftPlatforms(dir, "pieces/demo").map((p) => p.id),
    ["wechat"],
  );
});

test("listDraftPlatforms names an unrecognized file instead of ignoring it", () => {
  const dir = tmpDir();
  write(dir, "wechta.json", {});
  assert.throws(
    () => listDraftPlatforms(dir, "pieces/demo"),
    /pieces\/demo：无法识别的文件 wechta\.json，草稿文件名必须是平台 id/,
  );
});

test("readPieceMaterial returns the blocks the writer saw", () => {
  const dir = tmpDir();
  write(dir, "materials.json", { blocks: ["【1】A", "【2】B"] });
  assert.deepEqual(readPieceMaterial(dir, "pieces/demo"), ["【1】A", "【2】B"]);
});

test("readPieceMaterial reports a missing, empty or malformed file", () => {
  const missing = tmpDir();
  assert.throws(() => readPieceMaterial(missing, "pieces/demo"), /缺少 .*materials\.json/);

  const empty = tmpDir();
  write(empty, "materials.json", { blocks: [] });
  assert.throws(() => readPieceMaterial(empty, "pieces/demo"), /没有 blocks 数组/);

  const shaped = tmpDir();
  write(shaped, "materials.json", { blocks: { text: "x" } });
  assert.throws(() => readPieceMaterial(shaped, "pieces/demo"), /没有 blocks 数组/);

  const mixed = tmpDir();
  write(mixed, "materials.json", { blocks: ["ok", 42] });
  assert.throws(() => readPieceMaterial(mixed, "pieces/demo"), /含非字符串条目/);
});

test("listReviewRoots requires bodies.json when wechat drafts exist", () => {
  const dir = tmpDir();
  fs.mkdirSync(path.join(dir, "2026-11-16", "wechat", "a"), { recursive: true });
  assert.throws(
    () => listReviewRoots(dir, "2026-11-16"),
    /找不到 .*wechat\/bodies\.json，无法核对事实/,
  );
});

test("listReviewRoots carries single-source bodies and lists both roots", () => {
  const dir = tmpDir();
  write(dir, path.join("2026-11-16", "wechat", "bodies.json"), {
    "https://a.example/1": { url: "https://a.example/1", blocks: ["材料"], charCount: 2 },
  });
  fs.mkdirSync(path.join(dir, "2026-11-16", "pieces", "demo"), { recursive: true });
  const roots = listReviewRoots(dir, "2026-11-16");
  assert.deepEqual(roots.map((r) => r.label), ["wechat", "pieces"]);
  assert.deepEqual(roots[0].bodies["https://a.example/1"].blocks, ["材料"]);
});

test("listReviewRoots fails loudly when the date has no drafts at all", () => {
  const dir = tmpDir();
  assert.throws(() => listReviewRoots(dir, "2026-11-16"), /先跑 npm run wechat 或 npm run piece/);
});

test("describeFindings renders severity, quote, problem and evidence", () => {
  const report: ReviewReport = {
    platform: "wechat",
    piece: "topic",
    verdict: "revise",
    mechanical: [
      { layer: "mechanics", severity: "high", quote: "见 https://x", problem: "含外链", evidence: "正文出现链接" },
    ],
    facts: [{ layer: "facts", severity: "low", quote: "营收 3 亿", problem: "材料未提" }],
    warnings: [],
    durationMs: 12,
  };
  const lines = describeFindings(report);
  assert.equal(lines.length, 2);
  assert.match(lines[0], /^high  .*含外链.*依据：正文出现链接/);
  assert.match(lines[1], /材料未提/);
  assert.doesNotMatch(lines[1], /依据/);
});
