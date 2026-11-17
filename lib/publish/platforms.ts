/**
 * Writing targets, split into the platform (where it is published) and the
 * piece type (what shape the text has).
 *
 * A platform alone no longer determines length and structure: the same WeChat
 * account carries a 3000-character theme article and a 12-item news roundup.
 * `resolveShape` joins the two ids and returns the one object that generation,
 * parsing and review all read, so a shape is declared exactly once.
 */

export type PlatformId = "wechat" | "weibo" | "xiaohongshu";

/** What kind of text is being written, independent of where it goes. */
export type PieceType = "article" | "topic" | "digest";

export interface Platform {
  id: PlatformId;
  /** Human-facing name used in logs and filenames. */
  label: string;
}

/**
 * `headings` carries three states: a range to enforce, `"any"` when the item
 * count is decided by the material (a roundup gets one section per item), and
 * `null` when the platform carries no `##` sections at all.
 */
export interface Shape {
  /** Acceptable character count, whitespace excluded. */
  words: readonly [min: number, max: number];
  headings: readonly [min: number, max: number] | "any" | null;
  /** What one `##` line is called on this piece: a section title or an item. */
  headingUnit: "小标题" | "条";
  /** Accepted closing `#话题#` count, or null when the platform carries none. */
  hashtags: readonly [min: number, max: number] | null;
  /** Accepted bullet count, or null when the platform runs as prose. */
  bullets: readonly [min: number, max: number] | null;
  /** Piece-specific style rules appended to the shared rules. */
  guidance: string;
}

export interface DraftShape extends Shape {
  platform: PlatformId;
  piece: PieceType;
}

const PLATFORMS: Record<PlatformId, Platform> = {
  wechat: { id: "wechat", label: "微信公众号" },
  weibo: { id: "weibo", label: "微博" },
  xiaohongshu: { id: "xiaohongshu", label: "小红书" },
};

const PIECE_LABELS: Record<PieceType, string> = {
  article: "单篇改写",
  topic: "主题稿",
  digest: "资讯汇总",
};

const WECHAT_GUIDANCE = `- 结构：导语（2-3 句，交代发生了什么、为什么现在值得看）→ 若干 ## 小标题章节，每节 300-600 字 → 结尾一句提问。
- 每个段落 1-3 句，避免长段。
- 小标题用陈述句或具体问题，不用"背景介绍""深度分析"这类空壳标题。
- 全文最多 2 处 **加粗**，只加在真正的关键判断上。
- 不使用 emoji。`;

const SHAPES: Partial<Record<PlatformId, Partial<Record<PieceType, Shape>>>> = {
  wechat: {
    article: {
      words: [1500, 3000],
      headings: [3, 5],
      headingUnit: "小标题",
      hashtags: null,
      bullets: null,
      guidance: WECHAT_GUIDANCE,
    },
    topic: {
      words: [2000, 3500],
      headings: [3, 5],
      headingUnit: "小标题",
      hashtags: null,
      bullets: null,
      guidance: `- 结构：导语（2-3 句，交代这个话题是什么、争议或变化在哪、这篇稿子要回答什么）→ 3-5 个 ## 小标题章节 → 结尾一句判断或提问。
- 每个 ## 只回答一个问题；同一件事的不同说法放进同一节对照，不按材料分节，不交代材料出处。
- 全文最多 2 处 **加粗**，只加在真正的关键判断上。
- 不使用 emoji。`,
    },
    digest: {
      words: [900, 2000],
      headings: "any",
      headingUnit: "条",
      hashtags: null,
      bullets: null,
      guidance: `- 结构：开头一段 2-3 句总览，说明这一天几条消息合起来指向什么 → 每条一条 ## ，标题是事件名本身，不超过 20 字 → 每条 100-150 字，按给定顺序写，不重排。
- 每条只讲一个事件，先给事实再说一句它的意义，不写成评论。
- 不使用 emoji，不使用加粗。`,
    },
  },
  weibo: {
    article: {
      words: [300, 900],
      headings: null,
      headingUnit: "小标题",
      hashtags: [2, 3],
      bullets: null,
      guidance: `- 分成 3-5 个自然段。
- 第一句直接给出最有冲击力的事实或结论，不要铺垫。
- 每段只讲一个信息点，句子短。
- emoji 最多 2 个，可不用。`,
    },
  },
  xiaohongshu: {
    article: {
      words: [400, 900],
      headings: null,
      headingUnit: "小标题",
      hashtags: [3, 5],
      bullets: [3, 5],
      guidance: `- 第一人称、口语化，像跟朋友讲一件刚看到的事。
- 开头一句话钩子，具体、有信息量，不写"震惊""必看"这类空词。
- 每条分点 1-3 行，给出一个可记住的事实或判断。
- 结尾一句互动提问。
- emoji 每条最多 1 个，用在分点开头。`,
    },
  },
};

export const PLATFORM_IDS = Object.keys(PLATFORMS) as PlatformId[];
export const PIECE_TYPES = Object.keys(PIECE_LABELS) as PieceType[];

export function getPlatform(id: string): Platform {
  const platform = PLATFORMS[id as PlatformId];
  if (!platform) {
    throw new Error(`未知的目标平台：${id}。可用：${PLATFORM_IDS.join(", ")}`);
  }
  return platform;
}

export function getPieceType(id: string): PieceType {
  const piece = PIECE_TYPES.find((p) => p === id);
  if (!piece) {
    throw new Error(`未知的稿型：${id}。可用：${PIECE_TYPES.join(", ")}`);
  }
  return piece;
}

/** Every combination the shapes table implements, as `platform/piece`. */
export function availableShapes(): string[] {
  const out: string[] = [];
  for (const platform of PLATFORM_IDS) {
    for (const piece of PIECE_TYPES) {
      if (SHAPES[platform]?.[piece]) out.push(`${platform}/${piece}`);
    }
  }
  return out;
}

export function resolveShape(platform: PlatformId, piece: PieceType): DraftShape {
  const shape = SHAPES[platform]?.[piece];
  if (!shape) {
    throw new Error(
      `${PLATFORMS[platform].label}尚未支持${PIECE_LABELS[piece]}。可用组合：${availableShapes().join(", ")}`,
    );
  }
  return { ...shape, platform, piece };
}

/** Human-facing name of a piece type, for prompts and logs. */
export function pieceLabel(piece: PieceType): string {
  return PIECE_LABELS[piece];
}

/** Parse a comma-separated `--platform` value, preserving order and rejecting unknowns. */
export function parsePlatformList(raw: string): Platform[] {
  const ids = raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (ids.length === 0) {
    throw new Error(`--platform 为空。可用：${PLATFORM_IDS.join(", ")}`);
  }
  const seen = new Set<PlatformId>();
  const platforms: Platform[] = [];
  for (const id of ids) {
    const platform = getPlatform(id);
    if (seen.has(platform.id)) continue;
    seen.add(platform.id);
    platforms.push(platform);
  }
  return platforms;
}

/**
 * Structural requirements in prompt form. Generation and review both read the
 * counts from here, so a shape's structure is declared exactly once.
 */
export function structureRules(shape: DraftShape): string[] {
  const rules: string[] = [];
  if (shape.headings === "any") {
    const [min, max] = shape.words;
    rules.push(
      `正文 ${min}-${max} 字。每条素材写一条 \`##\` ${shape.headingUnit}，数量与给定素材条数相同，一条不多一条不少。`,
    );
  } else if (shape.headings) {
    const [min, max] = shape.headings;
    rules.push(`用 ${min}-${max} 个 \`##\` ${shape.headingUnit}分节。`);
  } else {
    rules.push("不使用 `##` 小标题。");
  }
  if (shape.headingUnit === "条" && shape.headings === "any") {
    // Item count follows the material; hashtags and bullets stay forbidden below.
  }
  if (shape.bullets) {
    const [min, max] = shape.bullets;
    rules.push(`正文分成 ${min}-${max} 条，每条以 \`- \` 或 \`1. \` 开头。`);
  }
  if (shape.hashtags) {
    const [min, max] = shape.hashtags;
    rules.push(
      `结尾另起一行放 ${min}-${max} 个 \`#话题#\`，只能取自正文实际涉及的主题。`,
    );
  } else {
    rules.push("不使用 `#话题#` 标签。");
  }
  return rules;
}

/** Characters that count towards the platform budget: markdown syntax and whitespace excluded. */
export function countWords(markdown: string): number {
  return markdown
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[#*`>~\-|]/g, "")
    .replace(/\s/g, "").length;
}
