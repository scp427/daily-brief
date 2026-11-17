import { readSourceConfig, validateSourceConfig } from "./config";
import { REPORT_LOCALE } from "../categories";
import type { SourceDef } from "./types";

/**
 * Source registry — loaded at module-init time from sources.config.json
 * at the project root. The JSON file is the **single source of truth**;
 * edit it (or use `npm run sources` to inspect) rather than hard-coding
 * sources here.
 *
 * Locale filtering:
 *   - `REPORT_LOCALE=zh` (default) — keeps sources whose `locales` includes "zh"
 *   - `REPORT_LOCALE=en`           — keeps sources whose `locales` includes "en"
 *   Sources without an explicit `locales` field default to both ["zh", "en"].
 *
 * Adding a source:
 *   - Plain RSS / Atom: add a JSON entry with type=rss. If the host blocks
 *     Node's undici TLS fingerprint (Cloudflare "Just a moment…"), set
 *     useCurl=true so rss.ts shells out to curl.
 *   - Special source (HN / V2EX / GitHub Trending / LinuxDo): add a branch
 *     in lib/sources/dispatch.ts pointing to your fetcher.
 *
 * `enabled: false` entries stay in the config for visibility; disable
 * rather than delete so the "why we don't use this" history is preserved.
 *
 * Subcategory determines L2 grouping in the rendered HTML; the category /
 * subcategory taxonomy itself lives in categories.config.json (see
 * lib/categories.ts) and is validated by lib/sources/config.ts.
 */

export { REPORT_LOCALE };

function filterByLocale(all: SourceDef[]): SourceDef[] {
  return all.filter((s) => {
    const locales = s.locales ?? ["zh", "en"];
    return locales.includes(REPORT_LOCALE);
  });
}

export const sources: SourceDef[] = filterByLocale(readSourceConfig());

/**
 * The full unfiltered list — used by `npm run sources` so the CLI can
 * show entries that are filtered out in the current locale.
 */
export function loadAllSources(): SourceDef[] {
  return readSourceConfig();
}

export { validateSourceConfig };
