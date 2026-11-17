import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Report taxonomy — categories, their L2 subcategories, and the extra
 * top-level panels carved out of a category. `categories.config.json` at
 * the project root is the single source of truth; every consumer (source
 * validation, HTML/markdown render, digest prompts) derives from here.
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const CATEGORIES_PATH = path.resolve(__dirname, "..", "categories.config.json");

export type Locale = "zh" | "en";

export const REPORT_LOCALE: Locale =
  process.env.REPORT_LOCALE === "en" ? "en" : "zh";

/** News-style summaries describe events; intro-style describe projects. */
export type SummaryStyle = "news" | "intro";

export interface SubCategoryDef {
  /** Matches `subcategory` on sources; unique across the whole config. */
  id: string;
  labelZh: string;
  labelEn: string;
  /** Per-source item cap in the L2/L3 view. Sources share their own cap. */
  displayLimit?: number;
  /** Cap on the sum of every source in this subcategory. */
  subLimit?: number;
  /** When set, all sources of this subcategory merge into one time-sorted list capped here. */
  mergeLimit?: number;
}

export interface CategoryDef {
  id: string;
  labelZh: string;
  labelEn: string;
  /** Brief count demanded from the digest LLM, e.g. "3-5". */
  digestCount: string;
  /** Articles forwarded to the digest prompt per category. */
  payloadLimit: number;
  /** Briefs synthesized locally when the digest JSON is unusable. */
  fallbackLimit: number;
  summaryStyle: SummaryStyle;
  /** Drop sports headlines from this category when merging. */
  dropSports?: boolean;
  subcategories: SubCategoryDef[];
}

export interface ExtraPanelDef {
  id: string;
  labelZh: string;
  labelEn: string;
  /** Category whose articles feed this panel. */
  sourceCategory: string;
  /** Subcategories moved out of their category's main panel into this one. */
  subcategories: string[];
}

export interface TradingPanelDef {
  labelZh: string;
  labelEn: string;
  /** Tab position: immediately after this category. */
  insertAfter: string;
}

export interface CategoriesConfig {
  categories: CategoryDef[];
  extraPanels: ExtraPanelDef[];
  tradingPanel?: TradingPanelDef;
}

// ----- validation -----

function fail(at: string, message: string): never {
  throw new Error(`categories.config.json${at}: ${message}`);
}

function asObject(value: unknown, at: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    fail(at, "must be an object");
  }
  return value as Record<string, unknown>;
}

function asString(obj: Record<string, unknown>, key: string, at: string): string {
  const value = obj[key];
  if (typeof value !== "string" || value.trim() === "") {
    fail(at, `'${key}' must be a non-empty string`);
  }
  return value;
}

function asPositiveInt(value: unknown, at: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
    fail(at, "must be a positive integer");
  }
  return value;
}

function asStringArray(value: unknown, at: string): string[] {
  if (!Array.isArray(value) || value.length === 0) {
    fail(at, "must be a non-empty array of strings");
  }
  return value.map((entry, i) => {
    if (typeof entry !== "string" || entry === "") fail(`${at}[${i}]`, "must be a non-empty string");
    return entry;
  });
}

export function validateCategoriesConfig(parsed: unknown): CategoriesConfig {
  const root = asObject(parsed, "");
  if (!Array.isArray(root.categories) || root.categories.length === 0) {
    fail("", "'categories' must be a non-empty array");
  }

  const seenCategoryIds = new Set<string>();
  const seenSubIds = new Set<string>();
  const categories: CategoryDef[] = root.categories.map((entry, i) => {
    const at = `.categories[${i}]`;
    const c = asObject(entry, at);
    const id = asString(c, "id", at);
    if (seenCategoryIds.has(id)) fail(at, `duplicate category id '${id}'`);
    seenCategoryIds.add(id);

    const digestCount = asString(c, "digestCount", at);
    if (!/^\d+-\d+$/.test(digestCount)) {
      fail(`${at} (${id})`, `'digestCount' must look like "3-5", got '${digestCount}'`);
    }

    const summaryStyle = asString(c, "summaryStyle", at);
    if (summaryStyle !== "news" && summaryStyle !== "intro") {
      fail(`${at} (${id})`, `'summaryStyle' must be "news" or "intro", got '${summaryStyle}'`);
    }

    if (c.dropSports !== undefined && typeof c.dropSports !== "boolean") {
      fail(at, "'dropSports' must be a boolean");
    }

    if (!Array.isArray(c.subcategories) || c.subcategories.length === 0) {
      fail(`${at} (${id})`, "'subcategories' must be a non-empty array");
    }
    const subcategories: SubCategoryDef[] = c.subcategories.map((s, j) => {
      const subAt = `${at}.subcategories[${j}]`;
      const sub = asObject(s, subAt);
      const subId = asString(sub, "id", subAt);
      if (seenSubIds.has(subId)) fail(subAt, `duplicate subcategory id '${subId}'`);
      seenSubIds.add(subId);
      const def: SubCategoryDef = {
        id: subId,
        labelZh: asString(sub, "labelZh", subAt),
        labelEn: asString(sub, "labelEn", subAt),
      };
      if (sub.displayLimit !== undefined) {
        def.displayLimit = asPositiveInt(sub.displayLimit, `${subAt}.displayLimit`);
      }
      if (sub.subLimit !== undefined) {
        def.subLimit = asPositiveInt(sub.subLimit, `${subAt}.subLimit`);
      }
      if (sub.mergeLimit !== undefined) {
        def.mergeLimit = asPositiveInt(sub.mergeLimit, `${subAt}.mergeLimit`);
      }
      return def;
    });

    const category: CategoryDef = {
      id,
      labelZh: asString(c, "labelZh", at),
      labelEn: asString(c, "labelEn", at),
      digestCount,
      payloadLimit: asPositiveInt(c.payloadLimit, `${at}.payloadLimit`),
      fallbackLimit: asPositiveInt(c.fallbackLimit, `${at}.fallbackLimit`),
      summaryStyle,
      ...(c.dropSports === undefined ? {} : { dropSports: c.dropSports }),
      subcategories,
    };
    return category;
  });

  const categoryById = new Map(categories.map((c) => [c.id, c]));
  const claimedSubIds = new Set<string>();
  const seenPanelIds = new Set<string>(["trading"]);

  const extraPanels: ExtraPanelDef[] = [];
  if (root.extraPanels !== undefined) {
    if (!Array.isArray(root.extraPanels)) fail("", "'extraPanels' must be an array");
    root.extraPanels.forEach((entry, i) => {
      const at = `.extraPanels[${i}]`;
      const p = asObject(entry, at);
      const id = asString(p, "id", at);
      if (seenPanelIds.has(id)) fail(at, `duplicate panel id '${id}'`);
      seenPanelIds.add(id);
      const sourceCategory = asString(p, "sourceCategory", at);
      const category = categoryById.get(sourceCategory);
      if (!category) fail(at, `'sourceCategory' '${sourceCategory}' is not a declared category`);
      const subIds = asStringArray(p.subcategories, `${at}.subcategories`);
      const declared = new Set(category.subcategories.map((s) => s.id));
      for (const subId of subIds) {
        if (!declared.has(subId)) {
          fail(
            at,
            `subcategory '${subId}' is not declared under category '${sourceCategory}'` +
              " — an extra panel references subcategories rather than declaring them",
          );
        }
        if (claimedSubIds.has(subId)) {
          fail(at, `subcategory '${subId}' is already claimed by another extra panel`);
        }
        claimedSubIds.add(subId);
      }
      extraPanels.push({
        id,
        labelZh: asString(p, "labelZh", at),
        labelEn: asString(p, "labelEn", at),
        sourceCategory,
        subcategories: subIds,
      });
    });
  }

  let tradingPanel: TradingPanelDef | undefined;
  if (root.tradingPanel !== undefined) {
    const at = ".tradingPanel";
    const t = asObject(root.tradingPanel, at);
    const insertAfter = asString(t, "insertAfter", at);
    if (!categoryById.has(insertAfter)) {
      fail(at, `'insertAfter' '${insertAfter}' is not a declared category`);
    }
    tradingPanel = {
      labelZh: asString(t, "labelZh", at),
      labelEn: asString(t, "labelEn", at),
      insertAfter,
    };
  }

  return { categories, extraPanels, tradingPanel };
}

export function readCategoriesConfig(): CategoriesConfig {
  if (!fs.existsSync(CATEGORIES_PATH)) {
    throw new Error(`Categories config missing: ${CATEGORIES_PATH}`);
  }
  const raw = fs.readFileSync(CATEGORIES_PATH, "utf8");
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    throw new Error(`Invalid JSON in ${CATEGORIES_PATH}: ${(e as Error).message}`);
  }
  return validateCategoriesConfig(parsed);
}

export interface TaxonomyIds {
  categories: ReadonlySet<string>;
  subcategories: ReadonlySet<string>;
}

/** Id sets of a config, for callers that validate against a freshly read file. */
export function taxonomyIdsOf(config: CategoriesConfig): TaxonomyIds {
  const categories = new Set<string>();
  const subcategories = new Set<string>();
  for (const category of config.categories) {
    categories.add(category.id);
    for (const sub of category.subcategories) subcategories.add(sub.id);
  }
  return { categories, subcategories };
}

/**
 * Validate, then replace the config file atomically, keeping the previous
 * content beside it. Nothing is written when validation fails.
 */
export function writeCategoriesConfig(next: unknown): CategoriesConfig {
  const validated = validateCategoriesConfig(next);
  fs.copyFileSync(CATEGORIES_PATH, `${CATEGORIES_PATH}.bak`);
  const tmp = `${CATEGORIES_PATH}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(validated, null, 2)}\n`, "utf8");
  fs.renameSync(tmp, CATEGORIES_PATH);
  return validated;
}

// ----- loaded config -----

export const categoriesConfig: CategoriesConfig = readCategoriesConfig();
export const categories: CategoryDef[] = categoriesConfig.categories;
export const extraPanels: ExtraPanelDef[] = categoriesConfig.extraPanels;
export const tradingPanel: TradingPanelDef | undefined = categoriesConfig.tradingPanel;

export const categoryIds: string[] = categories.map((c) => c.id);

const categoryIndex = new Map(categories.map((c) => [c.id, c]));

const subIndex = new Map<string, { category: CategoryDef; sub: SubCategoryDef }>();
for (const category of categories) {
  for (const sub of category.subcategories) subIndex.set(sub.id, { category, sub });
}

export function isCategory(id: string): boolean {
  return categoryIndex.has(id);
}

export function summaryStyleOf(id: string): SummaryStyle {
  return categoryIndex.get(id)?.summaryStyle ?? "news";
}

export function dropsSports(id: string): boolean {
  return categoryIndex.get(id)?.dropSports === true;
}

export function isKnownSubcategory(id: string): boolean {
  return subIndex.has(id);
}

function pickLabel(locale: Locale, labelZh: string, labelEn: string): string {
  return locale === "en" ? labelEn : labelZh;
}

/** Localized label for the active REPORT_LOCALE. */
export function label(def: { labelZh: string; labelEn: string }): string {
  return pickLabel(REPORT_LOCALE, def.labelZh, def.labelEn);
}

export function categoryLabel(id: string): string {
  const category = categoryIndex.get(id);
  return category ? label(category) : id;
}

export function subcategoryLabel(id: string): string {
  const found = subIndex.get(id);
  return found ? label(found.sub) : id;
}

/** Default per-source cap; a subcategory overrides it with `displayLimit`. */
export const DEFAULT_SOURCE_DISPLAY_LIMIT = 50;
/** Default cap on the sum of every source in one subcategory. */
export const DEFAULT_SUB_DISPLAY_LIMIT = 100;

/** Per-source display cap for a subcategory, keyed by "category:subcategory". */
export const SOURCE_DISPLAY_LIMITS: Record<string, number> = {};
/** Cap on the sum of every source in a subcategory, keyed by "category:subcategory". */
export const SUB_DISPLAY_LIMITS: Record<string, number> = {};
/** Merged-list cap per subcategory, keyed by "category:subcategory". */
export const MERGED_SUBGROUP_LIMITS: Record<string, number> = {};

for (const category of categories) {
  for (const sub of category.subcategories) {
    const key = `${category.id}:${sub.id}`;
    if (sub.displayLimit !== undefined) SOURCE_DISPLAY_LIMITS[key] = sub.displayLimit;
    if (sub.subLimit !== undefined) SUB_DISPLAY_LIMITS[key] = sub.subLimit;
    if (sub.mergeLimit !== undefined) MERGED_SUBGROUP_LIMITS[key] = sub.mergeLimit;
  }
}

export function displayLimitFor(category: string, subId: string | undefined): number {
  if (!subId) return DEFAULT_SOURCE_DISPLAY_LIMIT;
  return SOURCE_DISPLAY_LIMITS[`${category}:${subId}`] ?? DEFAULT_SOURCE_DISPLAY_LIMIT;
}

export function subLimitFor(category: string, subId: string | undefined): number {
  if (!subId) return DEFAULT_SUB_DISPLAY_LIMIT;
  return SUB_DISPLAY_LIMITS[`${category}:${subId}`] ?? DEFAULT_SUB_DISPLAY_LIMIT;
}

export function mergedLimitFor(category: string, subId: string): number | undefined {
  return MERGED_SUBGROUP_LIMITS[`${category}:${subId}`];
}

/** Full L2 order per category, including subcategories moved into extra panels. */
export const SUBCATEGORY_ORDER: Record<string, string[]> = Object.fromEntries(
  categories.map((c) => [c.id, c.subcategories.map((s) => s.id)]),
);

/** Subcategory ids displayed inside their own category's main panel. */
export function mainPanelSubs(category: string): string[] {
  const claimed = new Set(
    extraPanels.filter((p) => p.sourceCategory === category).flatMap((p) => p.subcategories),
  );
  const def = categoryIndex.get(category);
  if (!def) return [];
  return def.subcategories.map((s) => s.id).filter((id) => !claimed.has(id));
}

export interface Panel {
  /** Tab key — also the `data-panel`/`data-tab` value in the rendered HTML. */
  id: string;
  label: string;
  kind: "category" | "trading";
  /** Category whose raw subgroups feed this panel (category panels only). */
  sourceCategory?: string;
  /** Subgroups rendered inside this panel, in order. */
  subcategories?: string[];
}

/**
 * Top-level tab sequence: categories in config order, the trading panel
 * right after its `insertAfter` category, then extra panels.
 */
export function buildPanels(): Panel[] {
  const panels: Panel[] = [];
  for (const category of categories) {
    panels.push({
      id: category.id,
      label: label(category),
      kind: "category",
      sourceCategory: category.id,
      subcategories: mainPanelSubs(category.id),
    });
    if (tradingPanel && tradingPanel.insertAfter === category.id) {
      panels.push({ id: "trading", label: label(tradingPanel), kind: "trading" });
    }
  }
  for (const extra of extraPanels) {
    panels.push({
      id: extra.id,
      label: label(extra),
      kind: "category",
      sourceCategory: extra.sourceCategory,
      subcategories: extra.subcategories,
    });
  }
  return panels;
}
