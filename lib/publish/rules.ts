/**
 * Rules every piece shares, plus the material budget used by both generation
 * and review.
 *
 * Duration and structure come from `platforms.ts`; what stays here is the part
 * that does not vary by platform or piece type: fact discipline, narrative
 * voice, language, and output framing.
 */

export const COMMON_RULES = `事实纪律：
- 只使用「材料」中出现的事实。数字、日期、人名、机构名、引语必须能在材料中找到原文依据，不得改写数值，不得补充材料之外的背景。
- 材料没有交代清楚的（例如没有给出具体金额），就不写具体金额，改为定性表述。
- 材料中的观点要写明说这话的人；说的人是机构或职位（分析师、监管机构、厂商）时写机构或职位，不写转载它的媒体。
- 推测性内容写成推测。

叙述视角：
- 正文由作者直接陈述事实，不转述别人怎么报道：不出现"据 XX 网/社/报/杂志/电视台报道""XX 通讯社消息""记者 XX 报道""外媒指出""原文称"这类出处。
- 材料里的媒体名、栏目名、记者名只用于判断可信度，不出现在稿子里；同一件事由多篇材料提到时，仍然只写一次事实。
- 必须交代来源性质时，写它的性质（"一份监管文件""两家公司的公告"），不写它的名字。

语言：
- 全文使用简体中文，中文标点。
- 公司、产品、模型、API、人名等专有名词保留原拼写（例如 OpenAI、GPT-5、Anthropic），首次出现时可加中文说明。
- 不使用"值得注意的是""综上所述""不难看出""随着……的发展"这类填充句。
- 不使用"首先/其次/最后"式罗列。

输出格式（严格遵守）：
第一行写 TITLE: 后接标题，第二行空行，之后是正文 markdown。
正文不出现任何 http/https 链接，不写"参考来源""原文链接""本文编译自"。
配图只能使用材料给出的 IMGn 占位符，格式 ![简短说明](IMGn)，不得编造图片地址。`;

/** Material characters handed to the model in one prompt. */
export const DEFAULT_MATERIAL_BUDGET = 20000;

export interface ClippedMaterial {
  blocks: string[];
  /** 1-based indexes of the blocks that were cut. */
  truncated: number[];
}

/**
 * Split the material budget evenly across blocks.
 *
 * A single-block article gets the whole budget, which is the pre-existing
 * behaviour. Several blocks of a multi-source piece each get an equal share so
 * one long source cannot crowd out the rest; the truncated block indexes tell
 * the caller which sources were shortened.
 */
export function clipMaterial(
  blocks: string[],
  budget: number = DEFAULT_MATERIAL_BUDGET,
): ClippedMaterial {
  if (blocks.length === 0) return { blocks: [], truncated: [] };
  const perBlock = Math.floor(budget / blocks.length);
  const truncated: number[] = [];
  const clipped = blocks.map((block, index) => {
    if (block.length <= perBlock) return block;
    truncated.push(index + 1);
    return `${block.slice(0, perBlock)}\n\n（材料在此截断）`;
  });
  return { blocks: clipped, truncated };
}
