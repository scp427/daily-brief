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
