import assert from "node:assert/strict";
import test from "node:test";

import { resolveShape } from "./platforms";
import {
  ReviewFormatError,
  REVIEW_MAX_MATERIAL_CHARS,
  buildFactsPrompt,
  checkMechanics,
  parseReview,
  reviewDraft,
  reviewFacts,
  type ReviewLlm,
} from "./review";

const wechat = resolveShape("wechat", "article");
const weibo = resolveShape("weibo", "article");
const xiaohongshu = resolveShape("xiaohongshu", "article");
const digest = resolveShape("wechat", "digest");

/** A wechat draft with three sections and no external link or figure refs. */
const cleanWechat = [
  "## 谈判的前提",
  "字".repeat(600),
  "## 双方的要价",
  "字".repeat(600),
  "## 接下来两周",
  "字".repeat(600),
].join("\n\n");

function fakeLlm(
  responses: string[],
  calls: Array<{ systemPrompt: string; userPrompt: string; jsonMode?: boolean }> = [],
): ReviewLlm {
  let index = 0;
  return async (opts) => {
    calls.push(opts);
    const text = responses[Math.min(index, responses.length - 1)];
    index += 1;
    return { text, durationMs: 7 };
  };
}

test("checkMechanics passes a draft that satisfies the platform shape", () => {
  assert.deepEqual(checkMechanics(cleanWechat, wechat), []);
});

test("checkMechanics flags an external link and a leftover figure ref as blocking", () => {
  const md = `${cleanWechat}\n\n详见 https://example.com/a\n\n![图](IMG2)`;
  const findings = checkMechanics(md, wechat);
  const high = findings.filter((f) => f.severity === "high");
  assert.equal(high.length, 2);
  assert.match(high[0].problem, /外链不可点击/);
  assert.match(high[0].quote, /https:\/\/example\.com\/a/);
  assert.match(high[1].problem, /破图/);
  assert.equal(high[1].quote, "IMG2");
});

test("checkMechanics enforces each platform's own structure", () => {
  const shortOfSections = checkMechanics(`## 只有一节\n\n${"字".repeat(1500)}`, wechat);
  assert.match(shortOfSections[0].problem, /小标题 1 个，目标 3-5 个/);

  const headingsOnWeibo = checkMechanics(`## 微博不该有小标题\n\n${"字".repeat(400)}`, weibo);
  assert.match(headingsOnWeibo[0].problem, /平台不使用小标题，正文出现 1 个/);

  const oneTag = checkMechanics(`${"字".repeat(400)}\n\n#只有一个#`, weibo);
  assert.match(oneTag[0].problem, /话题标签 1 个，目标 2-3 个/);

  const tooFewBullets = checkMechanics(
    `${"字".repeat(400)}\n\n- 第一条\n- 第二条\n\n#甲# #乙# #丙#`,
    xiaohongshu,
  );
  assert.match(tooFewBullets[0].problem, /分点 2 个，目标 3-5 个/);
});

test("checkMechanics measures length against the platform budget", () => {
  const findings = checkMechanics(`## 一\n\n${"字".repeat(100)}`, wechat);
  assert.ok(
    findings.some((f) => /篇幅 \d+ 字，目标 1500-3000 字/.test(f.problem)),
  );
});

test("checkMechanics flags source attribution as blocking", () => {
  const lines = [
    "据路透社报道，双方将在下周重启谈判。",
    "据财新网消息，这笔交易尚未获批。",
    "记者 张三 报道，谈判进入第二轮。",
    "外媒指出，这个数字仍有争议。",
    "根据路透社的统计，涨幅是 12%。",
    "来源：财新网",
  ];
  for (const line of lines) {
    const high = checkMechanics(`${cleanWechat}\n\n${line}`, wechat).filter((f) =>
      /来源署名/.test(f.problem),
    );
    assert.equal(high.length, 1, line);
    assert.equal(high[0].severity, "high");
    assert.equal(high[0].quote, line);
  }
});

test("checkMechanics leaves non-attribution phrasing alone", () => {
  const md = `${cleanWechat}\n\n据估算，这一比例还会上升。据预报，明天有雨。一家监管文件显示，交易须在 60 天内完成。`;
  assert.deepEqual(checkMechanics(md, wechat), []);
});

test("checkMechanics leaves the roundup's item count to the material", () => {
  const items = Array.from({ length: 8 }, (_, i) => `## 事件${i + 1}\n\n${"字".repeat(110)}`);
  const markdown = [ "导语一段。", ...items ].join("\n\n");
  assert.deepEqual(checkMechanics(markdown, digest), []);

  const tooShort = checkMechanics(`## 一件事\n\n${"字".repeat(100)}`, digest);
  assert.ok(tooShort.some((f) => /篇幅 \d+ 字，目标 900-2000 字/.test(f.problem)));
});

test("parseReview keeps findings whose quote is verbatim in the draft", () => {
  const md = "谈判将在伊斯坦布尔重启。";
  const { findings, warnings } = parseReview(
    JSON.stringify({
      issues: [
        {
          severity: "high",
          quote: "谈判将在伊斯坦布尔重启。",
          problem: "材料说地点未定",
          evidence: "材料中没有",
        },
      ],
    }),
    md,
  );
  assert.deepEqual(warnings, []);
  assert.equal(findings.length, 1);
  assert.equal(findings[0].layer, "facts");
  assert.equal(findings[0].severity, "high");
});

test("parseReview drops a hallucinated quote and says so", () => {
  const { findings, warnings } = parseReview(
    JSON.stringify({
      issues: [{ severity: "high", quote: "草稿里没有这句", problem: "x", evidence: "y" }],
    }),
    "谈判将在伊斯坦布尔重启。",
  );
  assert.deepEqual(findings, []);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /不在草稿中，已丢弃/);
});

test("parseReview rejects a payload it cannot trust", () => {
  assert.throws(() => parseReview("不是 JSON", "正文"), ReviewFormatError);
  assert.throws(
    () => parseReview(JSON.stringify({ items: [] }), "正文"),
    /缺少 issues 数组/,
  );
  assert.throws(
    () =>
      parseReview(
        JSON.stringify({ issues: [{ severity: "fatal", quote: "正文", problem: "x", evidence: "" }] }),
        "正文",
      ),
    /severity 非法/,
  );
});

test("buildFactsPrompt truncates oversized material and states the cut", () => {
  const prompt = buildFactsPrompt({
    shape: wechat,
    markdown: "草稿",
    blocks: ["x".repeat(REVIEW_MAX_MATERIAL_CHARS + 1000)],
  });
  assert.match(prompt.userPrompt, /（材料在此截断）/);
  assert.ok(prompt.userPrompt.length < REVIEW_MAX_MATERIAL_CHARS + 500);
});

test("buildFactsPrompt names the platform and the piece type", () => {
  const prompt = buildFactsPrompt({ shape: digest, markdown: "草稿", blocks: ["材料"] });
  assert.match(prompt.userPrompt, /草稿平台：微信公众号 · 资讯汇总/);
});

test("reviewFacts retries once and reports the second attempt's findings", async () => {
  const calls: Array<{ systemPrompt: string; userPrompt: string; jsonMode?: boolean }> = [];
  const callLlm = fakeLlm(
    ["这不是 JSON", JSON.stringify({ issues: [] })],
    calls,
  );
  const result = await reviewFacts({ shape: wechat, markdown: cleanWechat, blocks: ["材料"] }, callLlm);
  assert.deepEqual(result.findings, []);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].jsonMode, true);
});

test("reviewFacts throws when both attempts are unparseable", async () => {
  await assert.rejects(
    () =>
      reviewFacts(
        { shape: wechat, markdown: cleanWechat, blocks: ["材料"] },
        fakeLlm(["坏", "还是坏"]),
      ),
    /两次都没有返回可解析的结果/,
  );
});

test("reviewDraft demands a revision when mechanics block, and passes when only advisory findings remain", async () => {
  const revise = await reviewDraft(
    {
      shape: wechat,
      markdown: `${cleanWechat}\n\nhttps://example.com/x`,
      blocks: ["材料"],
    },
    fakeLlm([JSON.stringify({ issues: [] })]),
  );
  assert.equal(revise.verdict, "revise");
  assert.equal(revise.mechanical.length, 1);
  assert.deepEqual(revise.facts, []);

  const advisory = await reviewDraft(
    { shape: wechat, markdown: cleanWechat, blocks: ["材料"] },
    fakeLlm([
      JSON.stringify({
        issues: [{ severity: "low", quote: "谈判的前提", problem: "措辞可更紧", evidence: "材料中没有" }],
      }),
    ]),
  );
  assert.equal(advisory.verdict, "pass");
  assert.equal(advisory.facts.length, 1);

  const blockingFact = await reviewDraft(
    { shape: wechat, markdown: cleanWechat, blocks: ["材料"] },
    fakeLlm([
      JSON.stringify({
        issues: [{ severity: "high", quote: "谈判的前提", problem: "材料没这么说", evidence: "材料中没有" }],
      }),
    ]),
  );
  assert.equal(blockingFact.verdict, "revise");

  const pass = await reviewDraft(
    { shape: wechat, markdown: cleanWechat, blocks: ["材料"] },
    fakeLlm([JSON.stringify({ issues: [] })]),
  );
  assert.deepEqual(pass.mechanical, []);
  assert.equal(pass.durationMs, 7);
});

test("reviewDraft reports the piece it reviewed", async () => {
  const report = await reviewDraft(
    { shape: digest, markdown: `导语。\n\n## 事件\n\n${"字".repeat(1500)}`, blocks: ["材料"] },
    fakeLlm([JSON.stringify({ issues: [] })]),
  );
  assert.equal(report.platform, "wechat");
  assert.equal(report.piece, "digest");
});
