import type { RawArticle } from "./types";

/**
 * Overseas sources cannot be reached from a mainland host, so they are
 * fetched by a GitHub Actions runner (scripts/snapshot.ts) and published as
 * one JSON file per source on the `snapshots` branch. This module holds the
 * wire format and the reader used by the report pipeline.
 */

export const SNAPSHOT_SCHEMA_VERSION = 1;
export const SNAPSHOT_BRANCH = "snapshots";
export const SNAPSHOT_DIR = "snapshots";

/**
 * A report run accepts a snapshot up to 26 hours old: the Actions schedule
 * drops runs, and yesterday's articles are still better than a timed-out
 * source. Anything older is treated as missing so the report does not
 * silently show week-old news.
 */
export const SNAPSHOT_TTL_MS = 26 * 60 * 60 * 1000;

/** Public mirrors for raw.githubusercontent.com, which is blocked in China. */
const RAW_MIRRORS = ["https://gh-proxy.com/", "https://ghfast.top/"];

export interface SnapshotItem {
  sourceId: string;
  title: string;
  url: string;
  excerpt?: string;
  publishedAt?: string;
  category: string;
  meta?: string;
}

export interface SnapshotDoc {
  schemaVersion: number;
  sourceId: string;
  fetchedAt: string;
  ok: boolean;
  itemCount: number;
  durationMs: number;
  error?: string;
  items: SnapshotItem[];
}

export function toSnapshotItem(article: RawArticle): SnapshotItem {
  const item: SnapshotItem = {
    sourceId: article.sourceId,
    title: article.title,
    url: article.url,
    category: article.category,
  };
  if (article.excerpt !== undefined) item.excerpt = article.excerpt;
  if (article.publishedAt !== undefined) item.publishedAt = article.publishedAt.toISOString();
  if (article.meta !== undefined) item.meta = article.meta;
  return item;
}

export function fromSnapshotItem(item: SnapshotItem): RawArticle {
  const article: RawArticle = {
    sourceId: item.sourceId,
    title: item.title,
    url: item.url,
    category: item.category,
  };
  if (item.excerpt !== undefined) article.excerpt = item.excerpt;
  if (item.publishedAt !== undefined) article.publishedAt = new Date(item.publishedAt);
  if (item.meta !== undefined) article.meta = item.meta;
  return article;
}

export function fromSnapshotDoc(doc: SnapshotDoc): RawArticle[] {
  return doc.items.map(fromSnapshotItem);
}

/** `items` is empty for a failed fetch, so one file shape covers both cases. */
export function toSnapshotDoc(
  sourceId: string,
  startedAt: number,
  outcome: { ok: true; items: RawArticle[] } | { ok: false; error: string },
): SnapshotDoc {
  const doc: SnapshotDoc = {
    schemaVersion: SNAPSHOT_SCHEMA_VERSION,
    sourceId,
    fetchedAt: new Date().toISOString(),
    ok: outcome.ok,
    itemCount: outcome.ok ? outcome.items.length : 0,
    durationMs: Date.now() - startedAt,
    items: outcome.ok ? outcome.items.map(toSnapshotItem) : [],
  };
  if (!outcome.ok) doc.error = outcome.error;
  return doc;
}

export function validateSnapshotDoc(parsed: unknown): SnapshotDoc {
  if (typeof parsed !== "object" || parsed === null) {
    throw new Error("snapshot: top level must be an object");
  }
  const doc = parsed as Record<string, unknown>;
  if (doc.schemaVersion !== SNAPSHOT_SCHEMA_VERSION) {
    throw new Error(`snapshot: unsupported schemaVersion ${String(doc.schemaVersion)}`);
  }
  for (const key of ["sourceId", "fetchedAt"] as const) {
    if (typeof doc[key] !== "string" || !doc[key]) {
      throw new Error(`snapshot: missing string '${key}'`);
    }
  }
  if (typeof doc.ok !== "boolean") throw new Error("snapshot: missing boolean 'ok'");
  if (typeof doc.itemCount !== "number") throw new Error("snapshot: missing number 'itemCount'");
  if (typeof doc.durationMs !== "number") throw new Error("snapshot: missing number 'durationMs'");
  if (!Array.isArray(doc.items)) throw new Error("snapshot: missing array 'items'");
  for (const [i, raw] of doc.items.entries()) {
    if (typeof raw !== "object" || raw === null) throw new Error(`snapshot: items[${i}] must be an object`);
    const item = raw as Record<string, unknown>;
    for (const key of ["sourceId", "title", "url", "category"] as const) {
      if (typeof item[key] !== "string" || !item[key]) {
        throw new Error(`snapshot: items[${i}] missing string '${key}'`);
      }
    }
    for (const key of ["excerpt", "publishedAt", "meta"] as const) {
      if (item[key] !== undefined && typeof item[key] !== "string") {
        throw new Error(`snapshot: items[${i}] '${key}' must be a string`);
      }
    }
  }
  return parsed as SnapshotDoc;
}

/** Report-timezone date key, e.g. "2026-11-16". Matches daily_reports/ dirs. */
export function snapshotDate(timeZone: string, now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

/** Candidate date keys, newest first, for a run that must tolerate dropped days. */
export function recentSnapshotDates(timeZone: string, count: number, now: Date = new Date()): string[] {
  const dates: string[] = [];
  for (let back = 0; back < count; back += 1) {
    dates.push(snapshotDate(timeZone, new Date(now.getTime() - back * 24 * 60 * 60 * 1000)));
  }
  return dates;
}

/**
 * Read channels in the order they are tried. raw.githubusercontent.com is
 * DNS-poisoned from mainland networks, so the API and two public mirrors are
 * listed; any one of them answering is enough.
 */
export function snapshotUrls(repo: string, date: string, sourceId: string): string[] {
  const file = `${SNAPSHOT_DIR}/${date}/${sourceId}.json`;
  const raw = `https://raw.githubusercontent.com/${repo}/${SNAPSHOT_BRANCH}/${file}`;
  return [
    `https://api.github.com/repos/${repo}/contents/${file}?ref=${SNAPSHOT_BRANCH}`,
    ...RAW_MIRRORS.map((mirror) => `${mirror}${raw}`),
  ];
}

function decodeContentsApi(text: string): string {
  const body = JSON.parse(text) as { content?: unknown; encoding?: unknown };
  if (body.encoding !== "base64" || typeof body.content !== "string") {
    throw new Error("snapshot: unexpected GitHub contents API payload");
  }
  return Buffer.from(body.content, "base64").toString("utf8");
}

export interface ReadSnapshotOptions {
  repo: string;
  sourceId: string;
  /** Report dates to try, newest first. */
  dates: string[];
  timeoutMs?: number;
  /**
   * Optional GitHub token: the unauthenticated contents API allows 60
   * requests per hour per IP, which one daily run can exhaust.
   */
  token?: string;
  now?: () => number;
  fetchImpl?: typeof fetch;
}

export interface SnapshotHit {
  doc: SnapshotDoc;
  url: string;
}

/**
 * Return the freshest usable snapshot, or null when every channel and date
 * is missing, stale, or recorded a failed fetch. The caller always has a
 * direct fetch to fall back to, so a broken mirror never aborts a run.
 */
export async function readSnapshot(options: ReadSnapshotOptions): Promise<SnapshotHit | null> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? 10_000;
  const now = options.now ?? Date.now;

  for (const date of options.dates) {
    for (const url of snapshotUrls(options.repo, date, options.sourceId)) {
      try {
        const doc = await fetchSnapshotDoc(url, options.sourceId, timeoutMs, now, fetchImpl, options.token);
        if (doc) return { doc, url };
      } catch (e) {
        // 404, a mirror error page, or a schema mismatch on one channel: the
        // next mirror or date may still answer, so keep trying.
      }
    }
  }
  return null;
}

async function fetchSnapshotDoc(
  url: string,
  sourceId: string,
  timeoutMs: number,
  now: () => number,
  fetchImpl: typeof fetch,
  token: string | undefined,
): Promise<SnapshotDoc | null> {
  const isApi = url.startsWith("https://api.github.com/");
  const headers: Record<string, string> = {
    "user-agent": "daily-brief-snapshot-reader",
    accept: "application/json",
  };
  // Mirrors reject or leak an Authorization header; only the API needs it.
  if (isApi && token) headers.authorization = `Bearer ${token}`;
  const res = await fetchImpl(url, {
    signal: AbortSignal.timeout(timeoutMs),
    headers,
  });
  if (!res.ok) return null;
  const text = await res.text();
  const body = isApi ? decodeContentsApi(text) : text;
  const doc = validateSnapshotDoc(JSON.parse(body));
  if (doc.sourceId !== sourceId) {
    throw new Error(`snapshot: expected source '${sourceId}', found '${doc.sourceId}'`);
  }
  if (!doc.ok) return null;
  if (now() - Date.parse(doc.fetchedAt) > SNAPSHOT_TTL_MS) return null;
  return doc;
}
