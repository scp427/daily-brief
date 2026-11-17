import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type { FetchOrigin } from "./channel";

/**
 * Per-source outcome of the last fetch, written by daily.ts / dry-run.ts and
 * by the admin server's "test now" button. The admin page reads it to show
 * whether a source is reachable without re-hitting the network.
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const STATUS_PATH = path.resolve(__dirname, "../..", "logs/source-status.json");

export type RunKind = "daily" | "dry-run" | "test";

export interface SourceRunStatus {
  id: string;
  lastRunAt: string;
  runKind: RunKind;
  ok: boolean;
  itemCount: number;
  durationMs: number;
  /** Where a successful fetch came from; absent when the fetch failed. */
  origin?: FetchOrigin;
  error?: string;
}

export type StatusMap = Record<string, SourceRunStatus>;

export function readStatus(): StatusMap {
  if (!fs.existsSync(STATUS_PATH)) return {};
  const raw = fs.readFileSync(STATUS_PATH, "utf8");
  if (!raw.trim()) return {};
  const parsed: unknown = JSON.parse(raw);
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error(`${STATUS_PATH}: expected a JSON object keyed by source id`);
  }
  return parsed as StatusMap;
}

/**
 * Merge one entry into the status file. Callers fetch sources sequentially,
 * so read-modify-write needs no locking.
 */
export function recordStatus(entry: SourceRunStatus): void {
  const all = readStatus();
  all[entry.id] = entry;
  const dir = path.dirname(STATUS_PATH);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = `${STATUS_PATH}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(all, null, 2)}\n`, "utf8");
  fs.renameSync(tmp, STATUS_PATH);
}

export function makeStatus(
  id: string,
  runKind: RunKind,
  startedAt: number,
  outcome: { ok: true; itemCount: number; origin: FetchOrigin } | { ok: false; error: string },
): SourceRunStatus {
  return {
    id,
    lastRunAt: new Date().toISOString(),
    runKind,
    ok: outcome.ok,
    itemCount: outcome.ok ? outcome.itemCount : 0,
    durationMs: Date.now() - startedAt,
    ...(outcome.ok ? { origin: outcome.origin } : { error: outcome.error }),
  };
}
