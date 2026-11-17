import { fetchSourceByChannel, type ChannelOptions, type ChannelResult } from "./channel";
import { makeStatus, recordStatus, type RunKind } from "./status";
import type { SourceDef } from "./types";

/**
 * Many network failures arrive as AggregateError with an empty message; the
 * useful part is the error code. Keep one formatting rule for logs and the
 * admin page.
 */
export function describeError(e: unknown): string {
  if (!(e instanceof Error)) return String(e);
  const cause = (e as { cause?: { code?: string } }).cause;
  const code = (e as { code?: string }).code ?? cause?.code;
  const base = e.message || e.name || e.constructor.name;
  return code && !base.includes(code) ? `${base} (${code})` : base;
}

/**
 * Fetch one source and persist the outcome for the admin page. Used by the
 * daily pipeline, the dry run, and the admin "test now" action so all three
 * leave the same status trail.
 */
export async function fetchWithStatus(
  source: SourceDef,
  runKind: RunKind,
  channel: ChannelOptions,
): Promise<ChannelResult> {
  const startedAt = Date.now();
  try {
    const { items, origin } = await fetchSourceByChannel(source, channel);
    if (origin === "snapshot") console.log(`  ${source.id.padEnd(20)} via snapshot`);
    recordSafely(makeStatus(source.id, runKind, startedAt, { ok: true, itemCount: items.length, origin }));
    return { items, origin };
  } catch (e) {
    recordSafely(makeStatus(source.id, runKind, startedAt, { ok: false, error: describeError(e) }));
    throw e;
  }
}

// Status bookkeeping must not turn a successful fetch into a failure, nor
// replace the original fetch error with a disk error.
function recordSafely(entry: Parameters<typeof recordStatus>[0]): void {
  try {
    recordStatus(entry);
  } catch (e) {
    console.error(`  [status] cannot write ${entry.id}: ${(e as Error).message}`);
  }
}
