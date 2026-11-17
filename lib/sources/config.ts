import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { readCategoriesConfig, taxonomyIdsOf, type TaxonomyIds } from "../categories";
import type { Category, SourceDef, SourceType } from "./types";

/**
 * Read/write half of the source registry. `registry.ts` loads and filters
 * this at module-init time; the admin server mutates the same file at
 * runtime, so validation lives here and is shared by both callers.
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const CONFIG_PATH = path.resolve(__dirname, "../..", "sources.config.json");

const VALID_TYPES: ReadonlySet<string> = new Set(["rss", "api", "scrape"]);

export interface SourceConfigReadResult {
  sources: SourceDef[];
  warnings: string[];
}

/**
 * Cross-file references (category and subcategory ids) are checked against
 * categories.config.json as it is on disk, so a taxonomy edit takes effect
 * without restarting the process that validates. Passing `warnings` turns
 * those reference errors into entries instead of throwing, which is what the
 * admin API needs to list a source it can still repair.
 */
export function validateSourceConfig(
  parsed: unknown,
  options: { taxonomy?: TaxonomyIds; warnings?: string[] } = {},
): SourceDef[] {
  const taxonomy = options.taxonomy ?? taxonomyIdsOf(readCategoriesConfig());
  const rejectReference = (message: string): void => {
    if (options.warnings) options.warnings.push(message);
    else throw new Error(message);
  };
  if (!Array.isArray(parsed)) {
    throw new Error(`${CONFIG_PATH}: top-level must be an array of sources`);
  }
  const seenIds = new Set<string>();
  for (let i = 0; i < parsed.length; i++) {
    const s = parsed[i] as Record<string, unknown>;
    const at = `sources.config.json[${i}]`;
    if (typeof s.id !== "string" || !s.id) throw new Error(`${at}: missing string 'id'`);
    if (seenIds.has(s.id)) throw new Error(`${at}: duplicate id '${s.id}'`);
    seenIds.add(s.id);
    if (typeof s.name !== "string") throw new Error(`${at} (${s.id}): missing 'name'`);
    if (typeof s.url !== "string") throw new Error(`${at} (${s.id}): missing 'url'`);
    if (!VALID_TYPES.has(s.type as string)) {
      throw new Error(`${at} (${s.id}): invalid 'type' '${String(s.type)}'`);
    }
    if (typeof s.category !== "string") {
      throw new Error(`${at} (${s.id}): missing string 'category'`);
    }
    if (!taxonomy.categories.has(s.category)) {
      rejectReference(
        `${at} (${s.id}): invalid 'category' '${s.category}' — declared: ${[...taxonomy.categories].join(", ")}`,
      );
    }
    // Disabled entries keep their subcategory for history, so only enabled
    // sources must point at a declared subcategory — otherwise the renderer
    // would silently drop their articles.
    if (s.enabled !== false && s.subcategory !== undefined) {
      if (typeof s.subcategory !== "string") {
        throw new Error(`${at} (${s.id}): 'subcategory' must be a string`);
      }
      if (!taxonomy.subcategories.has(s.subcategory)) {
        rejectReference(
          `${at} (${s.id}): 'subcategory' '${s.subcategory}' is not declared in categories.config.json`,
        );
      }
    }
    if (s.locales !== undefined) {
      if (!Array.isArray(s.locales) || s.locales.some((l) => l !== "zh" && l !== "en")) {
        throw new Error(`${at} (${s.id}): 'locales' must be an array of "zh" | "en"`);
      }
    }
    if (s.keywords !== undefined && !Array.isArray(s.keywords)) {
      throw new Error(`${at} (${s.id}): 'keywords' must be an array of strings`);
    }
    if (s.domestic !== undefined && typeof s.domestic !== "boolean") {
      throw new Error(`${at} (${s.id}): 'domestic' must be a boolean`);
    }
  }
  return parsed as SourceDef[];
}

function parseConfigFile(): unknown {
  if (!fs.existsSync(CONFIG_PATH)) {
    throw new Error(`Source config missing: ${CONFIG_PATH}`);
  }
  const raw = fs.readFileSync(CONFIG_PATH, "utf8");
  try {
    return JSON.parse(raw);
  } catch (e) {
    throw new Error(`Invalid JSON in ${CONFIG_PATH}: ${(e as Error).message}`);
  }
}

/** Strict read: an undeclared reference is an error. Used by the pipeline. */
export function readSourceConfig(): SourceDef[] {
  return validateSourceConfig(parseConfigFile());
}

/**
 * Read for the admin API: shape errors still throw, but undeclared references
 * come back as warnings so the page can list and repair the source.
 */
export function readSourceConfigLenient(): SourceConfigReadResult {
  const warnings: string[] = [];
  return { sources: validateSourceConfig(parseConfigFile(), { warnings }), warnings };
}

/**
 * Overwrite the config, keeping a single `.bak` of the previous contents.
 * Shape errors reject the write; reference errors are collected into
 * `options.warnings` so the admin page can save an edit and still show what
 * remains undeclared.
 */
export function writeSourceConfig(next: SourceDef[], options: { warnings?: string[] } = {}): SourceDef[] {
  const validated = validateSourceConfig(next, options);
  if (fs.existsSync(CONFIG_PATH)) {
    fs.copyFileSync(CONFIG_PATH, `${CONFIG_PATH}.bak`);
  }
  const tmp = `${CONFIG_PATH}.tmp`;
  fs.writeFileSync(tmp, serializeSourceConfig(validated), "utf8");
  fs.renameSync(tmp, CONFIG_PATH);
  return validated;
}

/**
 * One source per line with its arrays inline, matching how the file is
 * hand-written: an edit then shows up as a one-line diff.
 */
export function serializeSourceConfig(sources: SourceDef[]): string {
  return `[\n${sources.map((s) => `  ${JSON.stringify(s)}`).join(",\n")}\n]\n`;
}

/** Fields a client may change on an existing source. */
const PATCHABLE = [
  "name",
  "type",
  "url",
  "category",
  "subcategory",
  "enabled",
  "domestic",
  "locales",
  "lang",
  "keywords",
  "useCurl",
  "notes",
] as const;

export type SourcePatch = {
  [K in (typeof PATCHABLE)[number]]?: SourceDef[K] | null;
};

export function sanitizePatch(body: Record<string, unknown>): SourcePatch {
  const patch: Record<string, unknown> = {};
  for (const key of PATCHABLE) {
    if (body[key] !== undefined) patch[key] = body[key];
  }
  const unknown = Object.keys(body).filter((k) => !(PATCHABLE as readonly string[]).includes(k));
  if (unknown.length) {
    throw new Error(`unknown field(s): ${unknown.join(", ")}`);
  }
  return patch as SourcePatch;
}

export function applySourcePatch(all: SourceDef[], id: string, patch: SourcePatch): SourceDef[] {
  const index = all.findIndex((s) => s.id === id);
  if (index < 0) throw new Error(`unknown source id '${id}'`);
  const current = all[index];
  const merged: Partial<SourceDef> = { ...current };
  for (const key of Object.keys(patch) as (typeof PATCHABLE)[number][]) {
    const value = patch[key];
    // null clears an optional field instead of leaving an explicit undefined.
    if (value === null) delete merged[key];
    else if (value !== undefined) Object.assign(merged, { [key]: value });
  }
  // Re-validating narrows Partial<SourceDef> back to SourceDef and rejects an
  // edit that breaks a required field before anything reaches disk.
  const next = validateSourceConfig([{ ...merged, id: current.id }])[0];
  return all.map((s, i) => (i === index ? next : s));
}

export function addSource(all: SourceDef[], source: SourceDef): SourceDef[] {
  if (all.some((s) => s.id === source.id)) {
    throw new Error(`duplicate id '${source.id}'`);
  }
  return [...all, source];
}

export function removeSource(all: SourceDef[], id: string): SourceDef[] {
  if (!all.some((s) => s.id === id)) throw new Error(`unknown source id '${id}'`);
  return all.filter((s) => s.id !== id);
}

/**
 * Build a SourceDef from arbitrary JSON. Optional fields are dropped when
 * absent so the written config stays free of `null` placeholders.
 */
export function toSourceDef(body: Record<string, unknown>): SourceDef {
  const source: SourceDef = {
    id: String(body.id ?? ""),
    name: String(body.name ?? ""),
    type: body.type as SourceType,
    url: String(body.url ?? ""),
    category: body.category as Category,
  };
  if (body.subcategory !== undefined) source.subcategory = String(body.subcategory);
  if (body.enabled !== undefined) source.enabled = Boolean(body.enabled);
  if (body.domestic !== undefined) source.domestic = Boolean(body.domestic);
  if (body.locales !== undefined) source.locales = body.locales as ("zh" | "en")[];
  if (body.lang !== undefined) source.lang = body.lang as "zh" | "en";
  if (body.keywords !== undefined) source.keywords = body.keywords as string[];
  if (body.useCurl !== undefined) source.useCurl = Boolean(body.useCurl);
  if (body.notes !== undefined) source.notes = String(body.notes);
  return source;
}
