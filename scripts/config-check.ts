/**
 * Cross-file config gate. Two jobs:
 *
 *   1. every enabled source's own (category, subcategory) pair must be one
 *      categories.config.json lists — the rule `groupRaw()` throws on, checked
 *      before a run spends fetch and LLM work;
 *   2. the sidecar articles of one day are compared against that pairing to
 *      report sources whose recorded category is stale. Recorded categories
 *      are history, not config, so this is a note: re-running `daily`
 *      rewrites them, and rendering already buckets by the current category.
 *
 *   node scripts/run-tsx.mjs scripts/config-check.ts [YYYY-MM-DD]
 *
 * Without a date the newest `daily_reports/<date>/` is inspected. Exit code is
 * 1 when a check fails.
 */
import "./_env";

import fs from "node:fs";

import { auditPairing, auditSidecarCategories } from "../lib/output/pairing";
import { readArticles } from "../lib/output/store";
import { REPORTS_DIR } from "../lib/publish/drafts";
import { SUBCATEGORY_ORDER } from "../lib/categories";
import { readSourceConfigLenient } from "../lib/sources/config";

function newestDate(): string | undefined {
  if (!fs.existsSync(REPORTS_DIR)) return undefined;
  return fs
    .readdirSync(REPORTS_DIR)
    .filter((name) => /^\d{4}-\d{2}-\d{2}$/.test(name))
    .sort()
    .at(-1);
}

const requested = process.argv[2];

const { sources, warnings } = readSourceConfigLenient();
const byId = new Map(sources.map((s) => [s.id, s]));
const enabled = sources.filter((s) => s.enabled !== false);

const failures: string[] = [...warnings];
const notes: string[] = [];

for (const issue of auditPairing(sources, SUBCATEGORY_ORDER)) {
  failures.push(`${issue.message} — fix 'category' or 'subcategory' in sources.config.json`);
}

const date = requested ?? newestDate();
if (date === undefined) {
  notes.push(`没有 ${REPORTS_DIR}/<date>/ 可查，跳过 sidecar 检查`);
} else if (!fs.existsSync(`${REPORTS_DIR}/${date}`)) {
  failures.push(`sidecar 目录不存在：${REPORTS_DIR}/${date}`);
} else {
  const articles = readArticles(REPORTS_DIR, date);
  const drift = auditSidecarCategories(articles, byId);
  for (const { from, to, count } of drift) {
    notes.push(`${date}: 有条目仍记在 '${from}'，该源现属 '${to}'（${count} 条，重跑 daily 归位）`);
  }
  if (drift.length === 0) {
    notes.push(`${date}: sidecar 与当前配置一致（${articles.length} 条）`);
  }
}

for (const note of notes) console.log(`· ${note}`);
for (const failure of failures) console.error(`✗ ${failure}`);

if (failures.length > 0) {
  console.error(`\nconfig-check FAILED（${failures.length} 个问题）`);
  process.exit(1);
}
console.log(`✓ 配置一致：${sources.length} 个源，其中 enabled ${enabled.length} 个`);
