import type { SourceDef } from "../sources/types";

/**
 * The rule `groupRaw()` applies to every bucket: a source bucketed under
 * `category` must declare a subcategory that category lists. The bucket key is
 * the source's own category for pre-seeded buckets, and the sidecar article's
 * recorded category for fetched items — the two agree unless a source moved
 * between categories, so the message names the bucket rather than the source.
 *
 * Returns the message to throw, or `undefined` when the pair is legal. A
 * category with no order entry renders as one flat panel and accepts any
 * subcategory.
 */
export function pairingViolation(
  category: string,
  sourceId: string,
  subcategory: string | undefined,
  order: string[] | undefined,
): string | undefined {
  if (order === undefined) return undefined;
  if (subcategory !== undefined && order.includes(subcategory)) return undefined;
  return `source '${sourceId}' declares subcategory '${subcategory ?? "(none)"}', which categories.config.json does not list under '${category}'`;
}

export interface PairingIssue {
  sourceId: string;
  category: string;
  subcategory: string | undefined;
  message: string;
}

/**
 * Every enabled source whose own (category, subcategory) pair `groupRaw()`
 * would reject. Disabled sources are skipped: their articles are filtered out
 * before bucketing.
 */
export function auditPairing(
  sources: SourceDef[],
  orderByCategory: Record<string, string[]>,
): PairingIssue[] {
  const issues: PairingIssue[] = [];
  for (const s of sources) {
    if (s.enabled === false) continue;
    const subcategory = s.subcategory ?? undefined;
    const message = pairingViolation(s.category, s.id, subcategory, orderByCategory[s.category]);
    if (message !== undefined) {
      issues.push({ sourceId: s.id, category: s.category, subcategory, message });
    }
  }
  return issues;
}

export interface SidecarCategoryDrift {
  sourceId: string;
  from: string;
  to: string;
  count: number;
}

/**
 * Sidecar articles carry the category that was current when they were fetched.
 * `groupRaw()` buckets each article under the source's current category, so a
 * source that moved between categories leaves records whose recorded category
 * no longer matches; that stale value reaches the page only as
 * `summaryStyleOf(a.category)`. Counts drift per (source, recorded category)
 * for the caller to report, and never judges the pair: legality belongs to
 * `auditPairing()`, which reads the current config.
 */
export function auditSidecarCategories(
  articles: ReadonlyArray<{ sourceId: string; category: string }>,
  byId: ReadonlyMap<string, SourceDef>,
): SidecarCategoryDrift[] {
  const drift = new Map<string, SidecarCategoryDrift>();
  for (const a of articles) {
    const s = byId.get(a.sourceId);
    if (s === undefined || s.enabled === false) continue;
    if (a.category === s.category) continue;
    const key = `${a.sourceId}\u0000${a.category}`;
    const entry = drift.get(key) ?? {
      sourceId: a.sourceId,
      from: a.category,
      to: s.category,
      count: 0,
    };
    entry.count += 1;
    drift.set(key, entry);
  }
  return [...drift.values()];
}
