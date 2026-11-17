import "./_env";

import fs from "node:fs";
import path from "node:path";

import { generateDailyReport } from "../lib/ai/pipeline";
import { getModelTag, validateBackendCredentials } from "../lib/ai/llm";
import { renderMarkdown } from "../lib/output/render";
import {
  readArticles,
  readReport,
  writeHtml,
  writeReport,
} from "../lib/output/store";
import { sources } from "../lib/sources/registry";
import { todayKey } from "../lib/utils";

const OUTPUT_DIR = "daily_reports";

/**
 * Rebuild the digest for an already-fetched day: same sidecar, one new LLM
 * call, no source fetching.
 *
 * This is the step the admin "抓取" action cannot do for itself — it appends
 * raw articles, while `hero_headline` / `daily_overview` / `briefs` were
 * written by the LLM against the earlier article set. `scripts/render.ts`
 * rebuilds HTML from the existing digest, and `scripts/daily.ts` would
 * re-fetch every source and discard the manual additions.
 */
async function main() {
  validateBackendCredentials();

  const date = process.argv[2] || todayKey();
  const previous = readReport(OUTPUT_DIR, date);
  const articles = readArticles(OUTPUT_DIR, date);
  console.log(`[digest] ${date}: ${articles.length} articles, regenerating with ${getModelTag()}…`);

  const t0 = Date.now();
  const { report } = await generateDailyReport(articles);
  // Trading comes from live Yahoo/CoinGecko data the sidecar never stores;
  // regenerating it would need network calls, which this command avoids.
  if (previous.trading) report.trading = previous.trading;

  writeReport(OUTPUT_DIR, date, report);
  writeHtml(OUTPUT_DIR, date, report, articles, sources);
  console.log(`[digest] ready in ${((Date.now() - t0) / 1000).toFixed(1)}s`);

  const base = path.join(OUTPUT_DIR, date, date);
  if (process.env.OUTPUT_MARKDOWN === "true") {
    fs.writeFileSync(`${base}.md`, renderMarkdown(report, date), "utf8");
    console.log(`[digest] wrote ${base}.{json,html,md}`);
  } else {
    console.log(`[digest] wrote ${base}.{json,html}`);
  }
}

main().catch((e) => {
  console.error("[digest] FAILED:", e instanceof Error ? e.message : e);
  process.exit(1);
});
