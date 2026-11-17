import "./_env";

import fs from "node:fs";
import path from "node:path";

import { renderMarkdown } from "../lib/output/render";
import { readArticles, readReport, writeHtml } from "../lib/output/store";
import { sources } from "../lib/sources/registry";
import { todayKey } from "../lib/utils";

const OUTPUT_DIR = "daily_reports";

/**
 * Re-render HTML + Markdown from a previously-saved daily report.
 *
 * Use this for UI-only iteration (CSS / layout / labels) — no RSS fetch,
 * no LLM call, no Max quota consumed. Requires that `npm run daily` has
 * been run for the target date so the sidecar `<date>-articles.json`
 * exists.
 *
 * Usage:
 *   npm run render              # today
 *   npm run render -- 2026-05-15  # specific date
 */
async function main() {
  const date = process.argv[2] || todayKey();
  console.log(`[render] re-rendering ${date} from cached data…`);

  const report = readReport(OUTPUT_DIR, date);
  const articles = readArticles(OUTPUT_DIR, date);
  console.log(`[render] loaded ${articles.length} articles + report`);

  writeHtml(OUTPUT_DIR, date, report, articles, sources);
  const base = path.join(OUTPUT_DIR, date, date);
  if (process.env.OUTPUT_MARKDOWN === "true") {
    fs.writeFileSync(`${base}.md`, renderMarkdown(report, date), "utf8");
    console.log(`[render] wrote ${base}.{html,md}`);
  } else {
    console.log(`[render] wrote ${base}.html`);
  }
}

main().catch((e) => {
  console.error("[render] FAILED:", e instanceof Error ? e.message : e);
  process.exit(1);
});
