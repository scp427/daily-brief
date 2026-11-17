/**
 * Pre-publication review of one draft.
 *
 * Two layers report findings in the same shape. `checkMechanics` settles what a
 * script can decide exactly — length, structure, external links, figure
 * placeholders left unreplaced. `reviewFacts` asks the model to compare each
 * claim with the article the draft was written from.
 *
 * A fact finding whose `quote` does not appear in the draft is dropped and
 * reported as a warning: a model that invents a location cannot point a human
 * at a line, and its finding would be unverifiable anyway.
 *
 * `high` means the draft must change: mechanics deviations and facts the model
 * is confident about. `medium` and `low` are advisory, so a reviewer reads them
 * but the verdict stays `pass`.
 */

import { extractJson } from "../ai/json-util";
import { runLlm } from "../ai/llm";
import type { DraftShape, PlatformId } from "./platforms";
import { countWords, getPlatform, pieceLabel } from "./platforms";
import { clipMaterial } from "./rules";

export type Severity = "high" | "medium" | "low";

export interface Finding {
  layer: "mechanics" | "facts";
  severity: Severity;
  /** 草稿中的原句；mechanics 层为定位到的行或统计值。 */
  quote: string;
  problem: string;
  /** facts 层：材料中对应的原文，或「材料中没有」。 */
  evidence?: string;
}

export interface ReviewReport {
  platform: PlatformId;
  piece: DraftShape["piece"];
  verdict: "pass" | "revise";
  mechanical: Finding[];
  facts: Finding[];
  warnings: string[];
  durationMs: number;
}

export interface ReviewInput {
  shape: DraftShape;
  markdown: string;
  /** 文章正文，按阅读顺序。 */
  blocks: string[];
}

export type ReviewLlm = (opts: {
  systemPrompt: string;
  userPrompt: string;
  jsonMode?: boolean;
}) => Promise<{ text: string; durationMs: number }>;

export class ReviewFormatError extends Error {}

/** 篇幅容差：超出目标区间 20% 记为需要修改。 */
const LENGTH_TOLERANCE = 0.2;

/** 材料超过这个长度就截断，与写作侧的输入预算保持一致。 */
export const REVIEW_MAX_MATERIAL_CHARS = 20000;

const EXTERNAL_LINK = /https?:\/\/[^\s)）】]+/;
const LEFT_OVER_FIGURE = /!\[[^\]]*\]\((IMG\d+)\)/g;
/**
 * 来源署名与转述句。正文由作者直接叙述，媒体名、栏目名、记者名只影响可信度，
 * 不进稿子。
 */
const SOURCE_ATTRIBUTION = [
  /(?:据|根据|援引)[^，。；：\n]{0,12}(?:网|社|日报|晚报|时报|商报|导报|周报|杂志|周刊|电视台|通讯社|媒体|新闻)/,
  /(?:据|根据)[^，。；：\n]{1,12}报道/,
  /(?:记者|通讯员)[^，。；：\n]{0,6}(?:报道|梳理|采访|获悉|发文)/,
  /(?:外媒|港媒|台媒|美媒|日媒|英媒)[^，。；：\n]{0,6}(?:报道|称|消息|指出)/,
  /^(?:来源|原文|出处|链接)[：:]/, // 材料头部的字段行被抄进了正文
];

function clip(text: string, max: number): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max)}…` : flat;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isSeverity(value: unknown): value is Severity {
  return value === "high" || value === "medium" || value === "low";
}

function describeError(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function rangeProblem(
  count: number,
  range: readonly [number, number] | null,
  what: string,
  forbiddenWhenAbsent: boolean,
): string | null {
  if (!range) {
    return forbiddenWhenAbsent && count > 0
      ? `平台不使用${what}，正文出现 ${count} 个`
      : null;
  }
  const [min, max] = range;
  return count < min || count > max
    ? `${what} ${count} 个，目标 ${min}-${max} 个`
    : null;
}

export function checkMechanics(
  markdown: string,
  shape: DraftShape,
): Finding[] {
  const findings: Finding[] = [];

  const words = countWords(markdown);
  const [min, max] = shape.words;
  if (
    words < min * (1 - LENGTH_TOLERANCE) ||
    words > max * (1 + LENGTH_TOLERANCE)
  ) {
    findings.push({
      layer: "mechanics",
      severity: "high",
      quote: `（全文 ${words} 字）`,
      problem: `篇幅 ${words} 字，目标 ${min}-${max} 字`,
    });
  }

  const lines = markdown.split("\n");
  const headingCount = lines.filter((l) => /^##\s+\S/.test(l)).length;
  // `"any"` means the item count is set by the material, so only total length
  // is enforced; the per-section shape is a warning raised by the piece writer.
  const structure: Array<[count: number, range: readonly [number, number] | null, what: string, forbidden: boolean]> = [
    [[...markdown.matchAll(/(?<![\w#])#([^#\s][^#\n]{0,29})#/g)].length, shape.hashtags, "话题标签", true],
    [lines.filter((l) => /^\s*(?:[-*+]\s+|\d+[.、)]\s+)/.test(l)).length, shape.bullets, "分点", false],
  ];
  if (shape.headings !== "any") {
    structure.unshift([headingCount, shape.headings, shape.headingUnit, true]);
  }
  for (const [count, range, what, forbidden] of structure) {
    const problem = rangeProblem(count, range, what, forbidden);
    if (problem) {
      findings.push({
        layer: "mechanics",
        severity: "high",
        quote: `（${what}计数）`,
        problem,
      });
    }
  }

  const attributed = lines.find((l) => SOURCE_ATTRIBUTION.some((re) => re.test(l)));
  if (attributed) {
    findings.push({
      layer: "mechanics",
      severity: "high",
      quote: clip(attributed, 80),
      problem: "正文出现来源署名，稿件要由作者直接叙述，不交代哪家媒体或记者",
    });
  }

  const linkLine = lines.find((l) => EXTERNAL_LINK.test(l));
  if (linkLine) {
    findings.push({
      layer: "mechanics",
      severity: "high",
      quote: clip(linkLine, 80),
      problem: "正文含 http 链接，公众号正文的外链不可点击，发布前要删掉",
    });
  }

  const leftover = [...markdown.matchAll(LEFT_OVER_FIGURE)].map((m) => m[1]);
  if (leftover.length > 0) {
    findings.push({
      layer: "mechanics",
      severity: "high",
      quote: [...new Set(leftover)].join(", "),
      problem: "配图占位符没有替换成本地文件，发布后是破图",
    });
  }

  return findings;
}

const FACT_SYSTEM = `你是稿件的事实核查编辑。核对草稿中的每一个事实断言是否能在「材料」中找到依据。

只报实质问题：
- 数字、金额、比例、日期、时间与材料不一致
- 人名、机构名、地名、职位与材料不一致
- 引语不是材料原文，或改写了说话人的意思
- 材料中没有的说法被当作事实写出，包括推演出的因果与预测
- 观点没有标明是谁说的

不要报：文风、标题吸引力、篇幅、结构、用词偏好、emoji 使用；也不要报语言与翻译问题（中文句里夹了未翻译的英文单词、错别字、标点误用、语句不通顺），以及跟材料无关的外部知识。
每条 issue 都必须是需要改动的问题。判断后认为不构成问题就不要输出，不要输出「但这不算错」之类的条目。

输出一个 JSON 对象，不要其它文字：
{"issues":[{"severity":"high|medium|low","quote":"草稿原句","problem":"问题是什么","evidence":"材料中的对应原文；材料没有依据时写「材料中没有」"}]}

quote 必须逐字摘自草稿。没有实质问题时输出 {"issues":[]}。`;

export function buildFactsPrompt(input: ReviewInput): {
  systemPrompt: string;
  userPrompt: string;
} {
  const { blocks } = clipMaterial(input.blocks, REVIEW_MAX_MATERIAL_CHARS);
  const body = blocks.join("\n\n");
  const shape = input.shape;
  return {
    systemPrompt: FACT_SYSTEM,
    userPrompt: `草稿平台：${getPlatform(shape.platform).label} · ${pieceLabel(shape.piece)}

材料（原文）：
<article>
${body}
</article>

草稿（待核对）：
<draft>
${input.markdown}
</draft>`,
  };
}

/** 逐字比对时忽略空白与 markdown 强调符号，避免排版差异被当成编造。 */
function normalize(text: string): string {
  return text.replace(/[\s\u3000]+/g, "").replace(/[*`>]/g, "");
}

export function parseReview(
  text: string,
  markdown: string,
): { findings: Finding[]; warnings: string[] } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(extractJson(text));
  } catch {
    throw new ReviewFormatError(
      `事实核对的输出不是合法 JSON。首 200 字：${text.slice(0, 200)}`,
    );
  }
  if (!isRecord(parsed) || !Array.isArray(parsed.issues)) {
    throw new ReviewFormatError(
      `事实核对的输出缺少 issues 数组。首 200 字：${text.slice(0, 200)}`,
    );
  }

  const draft = normalize(markdown);
  const findings: Finding[] = [];
  const warnings: string[] = [];

  parsed.issues.forEach((raw, index) => {
    const position = `issues[${index}]`;
    if (!isRecord(raw)) {
      throw new ReviewFormatError(`${position} 不是对象`);
    }
    const { severity, quote, problem, evidence } = raw;
    if (!isSeverity(severity)) {
      throw new ReviewFormatError(
        `${position}.severity 非法：${String(severity)}`,
      );
    }
    if (typeof quote !== "string" || quote.trim() === "") {
      throw new ReviewFormatError(`${position}.quote 为空`);
    }
    if (typeof problem !== "string" || problem.trim() === "") {
      throw new ReviewFormatError(`${position}.problem 为空`);
    }
    if (typeof evidence !== "string") {
      throw new ReviewFormatError(`${position}.evidence 不是字符串`);
    }

    const cited = quote.trim();
    if (!draft.includes(normalize(cited))) {
      warnings.push(`模型引用的句子不在草稿中，已丢弃：${clip(cited, 40)}`);
      return;
    }
    findings.push({
      layer: "facts",
      severity,
      quote: cited,
      problem: problem.trim(),
      evidence: evidence.trim(),
    });
  });

  return { findings, warnings };
}

export async function reviewFacts(
  input: ReviewInput,
  callLlm: ReviewLlm = runLlm,
): Promise<{ findings: Finding[]; warnings: string[]; durationMs: number }> {
  const { systemPrompt, userPrompt } = buildFactsPrompt(input);
  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const { text, durationMs } = await callLlm({
      systemPrompt,
      userPrompt,
      jsonMode: true,
    });
    try {
      return { ...parseReview(text, input.markdown), durationMs };
    } catch (err) {
      if (!(err instanceof ReviewFormatError)) throw err;
      lastError = err;
    }
  }
  throw new ReviewFormatError(
    `事实核对两次都没有返回可解析的结果：${describeError(lastError)}`,
  );
}

export async function reviewDraft(
  input: ReviewInput,
  callLlm: ReviewLlm = runLlm,
): Promise<ReviewReport> {
  const mechanical = checkMechanics(input.markdown, input.shape);
  const facts = await reviewFacts(input, callLlm);
  const blocking = [...mechanical, ...facts.findings].some(
    (f) => f.severity === "high",
  );
  return {
    platform: input.shape.platform,
    piece: input.shape.piece,
    verdict: blocking ? "revise" : "pass",
    mechanical,
    facts: facts.findings,
    warnings: facts.warnings,
    durationMs: facts.durationMs,
  };
}
