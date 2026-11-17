import "./_env";

import fs from "node:fs";
import path from "node:path";

import {
  REPORTS_DIR,
  describeFindings,
  listDraftPlatforms,
  listReviewRoots,
  reviewDraftAt,
} from "../lib/publish/drafts";
import { getPlatform, parsePlatformList } from "../lib/publish/platforms";
import type { Platform } from "../lib/publish/platforms";
import { todayKey } from "../lib/utils";

/**
 * Review the drafts written for one day: structural and link checks plus a
 * model pass against the material each draft was written from.
 *
 * One broken draft must not stop the rest of the day's review, so per-draft
 * failures are collected and reported at the end.
 *
 * Usage:
 *   npm run review -- [YYYY-MM-DD] [--platform=wechat,weibo] [--force]
 */

function isDateKey(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const date = argv.find(isDateKey) ?? todayKey();
  const platformArg = argv.find((a) => a.startsWith("--platform="));
  const force = argv.includes("--force");
  const unknownFlags = argv.filter(
    (a) => a.startsWith("--") && a !== "--force" && !a.startsWith("--platform="),
  );
  if (unknownFlags.length > 0) {
    throw new Error(
      `未知参数：${unknownFlags.join(" ")}\n用法：npm run review -- [YYYY-MM-DD] [--platform=wechat,weibo,xiaohongshu] [--force]`,
    );
  }
  const only = platformArg
    ? new Set(parsePlatformList(platformArg.slice("--platform=".length)).map((p) => p.id))
    : null;

  const roots = listReviewRoots(REPORTS_DIR, date);
  const counts = { reviewed: 0, skipped: 0, revise: 0 };
  const failures: string[] = [];
  console.log(`[review] ${date} — ${roots.map((r) => r.label).join(" / ")}`);

  for (const root of roots) {
    const slugs = fs
      .readdirSync(root.dir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();

    for (const slug of slugs) {
      let platforms: Platform[];
      try {
        platforms = listDraftPlatforms(path.join(root.dir, slug), `${root.label}/${slug}`);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        failures.push(message);
        console.error(`  ✗ ${message}`);
        continue;
      }
      for (const platform of platforms) {
        if (only && !only.has(platform.id)) continue;
        try {
          const hit = await reviewDraftAt({
            dir: REPORTS_DIR,
            date,
            root,
            slug,
            platform,
            force,
          });
          const label = `${root.label}/${slug}/${platform.id}`;
          if (hit.status === "skipped" || !hit.report) {
            console.log(`  — ${label}：已有审阅结果（加 --force 重跑）`);
            counts.skipped += 1;
            continue;
          }
          const report = hit.report;
          counts[hit.status] += 1;
          console.log(
            `  ${report.verdict === "pass" ? "✓" : "✗"} ${label} → ${report.verdict}（${report.piece} · 机械 ${report.mechanical.length} · 事实 ${report.facts.length} · ${report.durationMs}ms）`,
          );
          const lines = describeFindings(report);
          if (lines.length === 0) console.log("    没有发现问题。");
          for (const line of lines) console.log(`    ${line}`);
          for (const warning of report.warnings) console.log(`    ! ${warning}`);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          failures.push(message);
          console.error(`  ✗ ${root.label}/${slug}/${platform.id}：${message}`);
        }
      }
    }
  }

  console.log(
    `\n[review] 通过 ${counts.reviewed} 篇 · 需改 ${counts.revise} 篇 · 跳过 ${counts.skipped} 篇 → ${path.join(REPORTS_DIR, date)}/<wechat|pieces>/<slug>/<platform>.review.json`,
  );
  if (failures.length > 0) {
    throw new Error(`${failures.length} 篇审阅失败：\n  · ${failures.join("\n  · ")}`);
  }
}

main().catch((error) => {
  console.error(
    `[review] FAILED:`,
    error instanceof Error ? error.message : error,
  );
  process.exit(1);
});
