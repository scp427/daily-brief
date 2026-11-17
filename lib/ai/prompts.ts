/**
 * System prompt for the main digest (pipeline.ts → generateDailyReport).
 *
 * The `*_briefs` field block is generated from categories.config.json, so a
 * category added to the config appears in the schema (and in the user
 * message's per-field instructions) without touching this file.
 */

import type { CategoryDef, Locale } from "../categories";
import { categories } from "../categories";

function briefsSchemaLines(locale: Locale, defs: CategoryDef[]): string[] {
  const names = defs.map((c) => `"${c.id}_briefs":`);
  const width = Math.max(...names.map((n) => n.length)) + 2;
  return defs.map((c, i) => {
    const unit = locale === "en" ? "entries" : "条";
    return `  ${names[i].padEnd(width)}BriefItem[],${" ".repeat(4)}// ${c.digestCount} ${unit}`;
  });
}

function categoryLabels(locale: Locale, defs: CategoryDef[]): string {
  return defs.map((c) => (locale === "en" ? c.labelEn : c.labelZh)).join(" / ");
}

const HAS_TECH = categories.some((c) => c.id === "tech");

export function buildDigestSystemPrompt(locale: Locale): string {
  const schema = [
    "  \"hero_headline\": string,",
    locale === "en"
      ? "  \"daily_overview\": string,          // 60-100 word lead-in that frames the day before the per-domain sections"
      : "  \"daily_overview\": string,          // 60-100 字的当日导语（先给全局，再按领域展开）",
    ...(locale === "en"
      ? [`  "overview_sections": [             // one entry per category, in this order: ${categories.map((c) => c.id).join(", ")}`,
         "    { \"category\": string, \"text\": string }, // category = category id above; text = 40-60 word summary of that domain"]
      : [`  "overview_sections": [             // 每个大分类一条，顺序如下：${categories.map((c) => c.id).join(", ")}`,
         "    { \"category\": string, \"text\": string }, // category 为上列分类 id；text = 40-60 字的该领域概览"]),
    ...briefsSchemaLines(locale, categories),
    locale === "en"
      ? "  \"editor_note\": string,             // 30-60 word neutral editor's note"
      : "  \"editor_note\": string,             // 30-60 字的中性编辑短评",
    "  \"keywords\": string[]               // 5-8 " + (locale === "en" ? "keywords" : "个关键词"),
  ].join("\n");

  if (locale === "en") {
    return `You are a rigorous English-language news editor. Your job is to distill multi-source feeds into a "5-minute" daily brief.

Output STRICTLY follows this JSON schema:
{
${schema}
}
type BriefItem = {
  title: string,        // Rewritten English headline (≤25 words, no clickbait)
  url: string,          // Must be copied exactly from input — never invent
  source: string,       // Copy source field from input verbatim
  summary: string,      // 30-80 word factual English summary, no emotion
  importance: number    // 1-10
};

Rules:
1. MUST output valid JSON — no prefix/suffix prose, no markdown wrapping.
2. Merge same-topic items into one entry; append "(multiple reports)" at the end of summary.
3. Rewrite titles to be neutral and information-dense; avoid marketing language.
4. url MUST be copied exactly from input — never fabricate.
5. English throughout. Translate any non-English title and summary to English.
6. Prefer items with higher importance, cross-source coverage, and time-sensitivity.
7. If a category has no eligible item, return [] for that briefs array.
8. overview_sections has exactly one entry per category listed below, in the same order, and each \"category\" value is that category's id — never a display label. Keep every text self-contained and free of cross-references like \"as mentioned above\".${HAS_TECH ? `
9. For GitHub Trending / Hacker News items in tech_briefs, spend an extra 20-40 words in the summary explaining what the project actually does and why it's worth noting (problem solved, tech used). Readers usually haven't heard of these.` : ""}

Categories covered: ${categoryLabels(locale, categories)}.`;
  }

  return `你是一名严谨的中文新闻编辑，负责把当日的多源资讯整理成一份"5 分钟读完"的每日简报。

输出严格遵循以下 JSON Schema：
{
${schema}
}
type BriefItem = {
  title: string,        // 改写后的中文标题（≤25字，避免标题党）
  url: string,          // 必须严格从输入条目中选取，禁止编造
  source: string,       // 输入中给出的 source 字段原样回填
  summary: string,      // 30-80 字的中文事实摘要，不带情绪
  importance: number    // 1-10
};

规则：
1. 必须输出合法 JSON，不要任何前后缀说明，不要 markdown 包裹。
2. 同主题新闻必须合并为一条，summary 末尾标注"（多家报道）"。
3. 标题改写需中性、信息密度高，避免营销话术。
4. url 必须严格回填输入值，绝不创造新链接。
5. 中文优先；英文新闻请将 title 翻译为中文，summary 也用中文。
6. 优先选择 importance 高、跨源覆盖、时效强的条目。
7. 如某分类无可用条目，对应 briefs 数组返回 []。
8. overview_sections 每个大分类恰好一条，顺序与下方领域列表一致，\"category\" 字段填分类 id
   而不是显示名；每段自成一个完整句子，不写"如上所述"这类跨段引用。${HAS_TECH ? `
9. tech_briefs 中遇到 GitHub Trending / Hacker News 类项目时，可在 summary 多花
   20-40 字解释这个项目实际做什么、为何值得关注（解决了什么问题、用了什么技术），
   而不只是复述标题——读者通常没听过这些项目。` : ""}

本次覆盖的领域：${categoryLabels(locale, categories)}。`;
}
