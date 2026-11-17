/**
 * WeChat article body.
 *
 * The WeChat editor strips `<style>`, `class` and `id` from pasted content and
 * keeps inline style, so a layout can only be "one content string whose every
 * block carries its own style". Duration and structure come from
 * `platforms.ts`; this module owns presentation only.
 */

export type WechatThemeId = "journal" | "brief" | "plain";

export const WECHAT_THEME_IDS: readonly WechatThemeId[] = [
  "journal",
  "brief",
  "plain",
];

export type Block =
  | { kind: "heading"; text: string }
  | { kind: "paragraph"; text: string }
  | { kind: "image"; target: string; alt: string };

export interface WechatTheme {
  id: WechatThemeId;
  label: string;
  paragraph: (text: string, index: number, isLead: boolean) => string;
  heading: (text: string, index: number) => string;
  image: (src: string, alt: string) => string;
}

// 单引号：这串要进 style 属性，双引号会提前闭合属性值。
const BODY_FONT =
  "-apple-system,BlinkMacSystemFont,'PingFang SC','Microsoft YaHei',sans-serif";

const FIGURE_LINE = /^!\[([^\]]*)\]\(([^)\s]+)\)$/;
const HEADING = /^##\s+(.+)$/;
const INLINE_BOLD = /\*\*(.+?)\*\*/g;

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function renderInline(text: string): string {
  return escapeHtml(text)
    .replace(/\n/g, "<br>")
    .replace(
      INLINE_BOLD,
      '<strong style="font-weight:600;color:#1f2328;">$1</strong>',
    );
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/** Split the draft into the three block kinds the writer's prompt produces. */
export function splitBlocks(markdown: string): Block[] {
  const blocks: Block[] = [];
  let paragraph: string[] = [];
  const flush = () => {
    if (paragraph.length === 0) return;
    blocks.push({ kind: "paragraph", text: paragraph.join("\n") });
    paragraph = [];
  };

  for (const raw of markdown.split("\n")) {
    const line = raw.trim();
    const heading = HEADING.exec(line);
    if (heading) {
      flush();
      blocks.push({ kind: "heading", text: heading[1].trim() });
      continue;
    }
    const figure = FIGURE_LINE.exec(line);
    if (figure) {
      flush();
      blocks.push({ kind: "image", target: figure[2], alt: figure[1].trim() });
      continue;
    }
    if (line === "") flush();
    else paragraph.push(line);
  }
  flush();
  return blocks;
}

const JOURNAL: WechatTheme = {
  id: "journal",
  label: "刊物版",
  paragraph: (text, _index, isLead) =>
    isLead
      ? `<p style="margin:0 0 1.5em;font-size:16.5px;line-height:1.85;color:#1f2328;letter-spacing:.01em;text-align:justify;">${renderInline(text)}</p>`
      : `<p style="margin:0 0 1.4em;font-size:15.5px;line-height:1.85;color:#3f3f3f;letter-spacing:.02em;text-align:justify;">${renderInline(text)}</p>`,
  heading: (text, index) =>
    `<section style="margin:2.2em 0 1.1em;padding-left:12px;border-left:3px solid #3454d1;"><span style="display:block;font-size:11px;font-weight:600;color:#3454d1;letter-spacing:.16em;">${pad2(index)}</span><span style="display:block;margin-top:4px;font-size:19px;font-weight:600;color:#1f2328;line-height:1.45;">${renderInline(text)}</span></section>`,
  image: (src, alt) =>
    `<section style="margin:1.7em 0;"><img src="${src}" alt="${alt}" style="width:100%;display:block;border-radius:4px;">${
      alt === ""
        ? ""
        : `<span style="display:block;margin-top:8px;text-align:center;font-size:12px;color:#8b909a;">${alt}</span>`
    }</section>`,
};

const BRIEF: WechatTheme = {
  id: "brief",
  label: "简报版",
  paragraph: (text, _index, isLead) =>
    isLead
      ? `<p style="margin:0 0 1.3em;padding-left:12px;border-left:3px solid #3454d1;font-size:15.5px;line-height:1.75;color:#1f2328;">${renderInline(text)}</p>`
      : `<p style="margin:0 0 1.15em;font-size:15px;line-height:1.75;color:#3f3f3f;">${renderInline(text)}</p>`,
  heading: (text, index) =>
    `<section style="margin:1.9em 0 .85em;${
      index > 1 ? "border-top:1px dashed #e5e7eb;padding-top:1.9em;" : ""
    }"><span style="display:inline-block;background:#eef2ff;color:#3454d1;font-size:15px;font-weight:600;padding:3px 10px;border-radius:3px;line-height:1.6;">${renderInline(text)}</span></section>`,
  image: (src, alt) =>
    `<section style="margin:1.4em 0;"><img src="${src}" alt="${alt}" style="width:100%;display:block;">${
      alt === ""
        ? ""
        : `<span style="display:block;margin-top:6px;font-size:12px;color:#8b909a;">${alt}</span>`
    }</section>`,
};

const PLAIN: WechatTheme = {
  id: "plain",
  label: "极简版",
  paragraph: (text) =>
    `<p style="margin:0 0 1.2em;font-size:16px;line-height:1.75;color:#333;">${renderInline(text)}</p>`,
  heading: (text) =>
    `<section style="margin:1.8em 0 .7em;"><strong style="display:block;font-size:17px;font-weight:600;color:#111;line-height:1.5;">${renderInline(text)}</strong></section>`,
  image: (src, alt) =>
    `<section style="margin:1.4em 0;"><img src="${src}" alt="${alt}" style="width:100%;display:block;"></section>`,
};

const THEMES: Record<string, WechatTheme> = {
  journal: JOURNAL,
  brief: BRIEF,
  plain: PLAIN,
};

export function getWechatTheme(id: string): WechatTheme {
  const theme = THEMES[id];
  if (!theme) {
    throw new Error(
      `未知的公众号版式：${id}。可用：${WECHAT_THEME_IDS.join(", ")}`,
    );
  }
  return theme;
}

export interface RenderWechatInput {
  markdown: string;
  theme: WechatTheme;
  /**
   * 草稿箱里的图片必须是微信自己的 url，预览时用 data URL。返回空串表示这张图
   * 渲染不出来，此时跳过它而不是留下破图。
   */
  resolveImage: (target: string) => string;
}

export function renderWechatHtml(input: RenderWechatInput): string {
  const blocks = splitBlocks(input.markdown);
  let headingIndex = 0;
  let paragraphIndex = 0;
  const parts = blocks.map((block) => {
    if (block.kind === "heading") {
      headingIndex += 1;
      return input.theme.heading(block.text, headingIndex);
    }
    if (block.kind === "image") {
      const src = input.resolveImage(block.target);
      return src === "" ? "" : input.theme.image(src, escapeHtml(block.alt));
    }
    paragraphIndex += 1;
    return input.theme.paragraph(block.text, paragraphIndex, paragraphIndex === 1);
  });
  return `<section style="font-family:${BODY_FONT};text-align:left;">\n${parts.join("\n")}\n</section>`;
}
