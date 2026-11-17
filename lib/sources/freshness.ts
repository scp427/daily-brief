/**
 * Freshness of what a source actually returned, as opposed to whether the
 * fetch succeeded: a feed can answer 200 with months-old entries, and a
 * source in that state adds stale headlines to every report.
 */
export type FreshnessVerdict = "fresh" | "stale" | "empty" | "undated" | "error";

export interface FreshnessCheck {
  verdict: FreshnessVerdict;
  /** Age of the newest dated item, rounded down to whole days. */
  ageDays?: number;
  newestAt?: Date;
  itemCount: number;
  error?: string;
}

/** Newest `publishedAt` among items, ignoring items that carry no date. */
export function newestPublishedAt(items: { publishedAt?: Date }[]): Date | undefined {
  let newest: Date | undefined;
  for (const item of items) {
    if (!item.publishedAt) continue;
    if (!newest || item.publishedAt.getTime() > newest.getTime()) {
      newest = item.publishedAt;
    }
  }
  return newest;
}

/**
 * `undated` is kept apart from `stale` on purpose: a source that publishes
 * without dates cannot be judged, and disabling it would be a guess.
 */
export function judgeFreshness(
  itemCount: number,
  newestAt: Date | undefined,
  now: Date,
  maxAgeDays: number,
): FreshnessCheck {
  if (itemCount === 0) return { verdict: "empty", itemCount };
  if (!newestAt) return { verdict: "undated", itemCount };
  const ageDays = Math.floor((now.getTime() - newestAt.getTime()) / 86_400_000);
  return {
    verdict: ageDays > maxAgeDays ? "stale" : "fresh",
    ageDays,
    newestAt,
    itemCount,
  };
}
