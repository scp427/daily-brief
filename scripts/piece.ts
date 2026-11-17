import "./_env";

import { describeFindings, REPORTS_DIR } from "../lib/publish/drafts";
import { getPieceType } from "../lib/publish/platforms";
import { runPiece } from "../lib/publish/piece-runner";
import { todayKey } from "../lib/utils";

/**
 * Write an aggregated piece from the day's data: several articles on one
 * subject, or the day's briefs for the chosen categories.
 *
 * The work itself lives in lib/publish/piece-runner.ts so the admin page writes
 * the same files from the same material.
 *
 * Usage:
 *   npm run piece -- topic --topic="英伟达财报" <url|标题子串>...
 *   npm run piece -- digest --category=tech,finance
 *   npm run piece -- 2026-11-16 digest --category=tech [--force]
 */

const USAGE = `用法：
  npm run piece -- topic --topic="主题" <url|标题子串>...
  npm run piece -- digest --category=tech,finance
  npm run piece -- [YYYY-MM-DD] <topic|digest> [...] [--force]`;

function isDateKey(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const dateArg = argv.find(isDateKey);
  const date = dateArg ?? todayKey();
  const force = argv.includes("--force");
  const topicArg = argv.find((a) => a.startsWith("--topic="));
  const categoryArg = argv.find((a) => a.startsWith("--category="));
  const positional = argv.filter((a) => !a.startsWith("--") && a !== dateArg);
  const unknownFlags = argv.filter(
    (a) =>
      a.startsWith("--") &&
      a !== "--force" &&
      !a.startsWith("--topic=") &&
      !a.startsWith("--category="),
  );

  if (unknownFlags.length > 0) {
    throw new Error(`未知参数：${unknownFlags.join(" ")}\n${USAGE}`);
  }
  const kindArg = positional[0];
  if (!kindArg) throw new Error(USAGE);
  const kind = getPieceType(kindArg);
  if (kind === "article") throw new Error(`单篇改写走 npm run wechat。\n${USAGE}`);

  console.log(`[piece] ${date} — ${kind}`);
  const outcome = await runPiece(
    {
      dir: REPORTS_DIR,
      date,
      kind,
      topic: topicArg?.slice("--topic=".length),
      categories: categoryArg?.slice("--category=".length).split(","),
      queries: positional.slice(1),
      force,
    },
    {
      onStage: (stage) => console.log(`  · ${stage}`),
      onLog: (line) => console.log(`  ${line}`),
    },
  );

  if (outcome.skipped) {
    console.log(`  — ${outcome.slug}：已存在 ${outcome.markdownPath}（加 --force 重写）`);
    return;
  }
  for (const warning of outcome.result.warnings) {
    console.log(`    ! ${warning}`);
  }
  for (const line of outcome.result.review ? describeFindings(outcome.result.review) : []) {
    console.log(`    ${line}`);
  }
  console.log(`[piece] 草稿 → ${outcome.result.markdownPath}`);
}

main().catch((error) => {
  console.error(`[piece] FAILED:`, error instanceof Error ? error.message : error);
  process.exit(1);
});
