import { fetchSource } from "./dispatch";
import { fromSnapshotDoc, readSnapshot, recentSnapshotDates } from "./snapshot";
import type { RawArticle, SourceDef } from "./types";

/**
 * Every source is fetched through one of two channels: a direct connection
 * from this machine, or the overseas snapshot published by GitHub Actions.
 * Which channel wins depends on where the process runs, not on the source:
 * a mainland host reaches domestic sources but not overseas ones, and a
 * developer machine with a proxy reaches both.
 */

export type FetchOrigin = "direct" | "snapshot";

export interface ChannelResult {
  items: RawArticle[];
  origin: FetchOrigin;
}

export interface ChannelOptions {
  /** `owner/name` of the repository holding the `snapshots` branch; null disables it. */
  repo: string | null;
  /** Snapshot first, direct fetch only when the snapshot is missing. */
  preferSnapshot: boolean;
  /** Report dates to look for, newest first. */
  dates: string[];
  /** GitHub token for the contents API; raises the 60-per-hour IP limit. */
  token?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
  /** Injected in tests; production uses the dispatcher. */
  fetchDirect?: (source: SourceDef) => Promise<RawArticle[]>;
}

export type Env = Record<string, string | undefined>;

export function channelOptionsFromEnv(env: Env = process.env, now: Date = new Date()): ChannelOptions {
  const repo = env.SNAPSHOT_REPO?.trim() || null;
  const preferSnapshot = env.SNAPSHOT_PREFER === "true";
  if (preferSnapshot && repo === null) {
    throw new Error("SNAPSHOT_PREFER=true requires SNAPSHOT_REPO (owner/name)");
  }
  const timeZone = env.REPORT_TZ?.trim() || "Asia/Shanghai";
  const token = env.SNAPSHOT_TOKEN?.trim() || undefined;
  return { repo, preferSnapshot, dates: recentSnapshotDates(timeZone, 3, now), token };
}

export async function fetchSourceByChannel(
  source: SourceDef,
  options: ChannelOptions,
): Promise<ChannelResult> {
  const repo = options.repo;
  const snapshotEligible = repo !== null && source.domestic !== true;

  const fromSnapshot = async (): Promise<ChannelResult | null> => {
    if (!snapshotEligible || repo === null) return null;
    const hit = await readSnapshot({
      repo,
      sourceId: source.id,
      dates: options.dates,
      token: options.token,
      timeoutMs: options.timeoutMs,
      fetchImpl: options.fetchImpl,
    });
    return hit ? { items: fromSnapshotDoc(hit.doc), origin: "snapshot" } : null;
  };

  if (snapshotEligible && options.preferSnapshot) {
    const hit = await fromSnapshot();
    if (hit) return hit;
  }

  try {
    const fetchDirect = options.fetchDirect ?? fetchSource;
    return { items: await fetchDirect(source), origin: "direct" };
  } catch (error) {
    // A mainland host is expected to time out here; the snapshot is the
    // intended recovery path, so fall back before reporting a failure.
    const hit = await fromSnapshot();
    if (hit) return hit;
    throw error;
  }
}
