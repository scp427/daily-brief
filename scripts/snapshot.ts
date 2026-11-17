import "./_env";

import fs from "node:fs";
import path from "node:path";

import { loadAllSources } from "../lib/sources/registry";
import { fetchSource } from "../lib/sources/dispatch";
import { describeError } from "../lib/sources/run";
import { snapshotDate, toSnapshotDoc, type SnapshotDoc } from "../lib/sources/snapshot";
import type { SourceDef } from "../lib/sources/types";

/**
 * Fetch every overseas source from a runner that can reach it, and write one
 * JSON file per source under snapshots/<date>/. A GitHub Actions workflow
 * commits the result to the `snapshots` branch, where the mainland report
 * host reads it back (see lib/sources/snapshot.ts).
 *
 * Failures are recorded, not raised: a source that is down on the runner must
 * not stop the other sources from publishing a snapshot.
 */

interface CliOptions {
  out: string;
  date: string;
  only: string[] | null;
  keep: number;
  concurrency: number;
  timeoutMs: number;
}

const USAGE = `usage: node scripts/run-tsx.mjs scripts/snapshot.ts [options]

  --out DIR          output root (default: snapshots)
  --date YYYY-MM-DD  report date to write under (default: today in REPORT_TZ)
  --only a,b         fetch just these source ids (any source, domestic included)
  --keep N           keep the newest N date directories (default: 7)
  --concurrency N    parallel fetches (default: 4)
  --timeout MS       per-source timeout (default: 25000)
`;

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    out: "snapshots",
    date: snapshotDate(process.env.REPORT_TZ?.trim() || "Asia/Shanghai"),
    only: null,
    keep: 7,
    concurrency: 4,
    timeoutMs: 25_000,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    const value = argv[i + 1];
    const take = (): string => {
      if (value === undefined || value.startsWith("--")) throw new Error(`${flag} needs a value`);
      i += 1;
      return value;
    };
    switch (flag) {
      case "--out":
        options.out = take();
        break;
      case "--date":
        options.date = take();
        break;
      case "--only":
        options.only = take()
          .split(",")
          .map((id) => id.trim())
          .filter(Boolean);
        break;
      case "--keep":
        options.keep = Number(take());
        break;
      case "--concurrency":
        options.concurrency = Number(take());
        break;
      case "--timeout":
        options.timeoutMs = Number(take());
        break;
      case "--help":
      case "-h":
        process.stdout.write(USAGE);
        process.exit(0);
        break;
      default:
        throw new Error(`unknown option ${flag}\n\n${USAGE}`);
    }
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(options.date)) {
    throw new Error(`--date must look like YYYY-MM-DD, got '${options.date}'`);
  }
  if (!Number.isInteger(options.keep) || options.keep < 1) {
    throw new Error("--keep must be a positive integer");
  }
  if (!Number.isInteger(options.concurrency) || options.concurrency < 1) {
    throw new Error("--concurrency must be a positive integer");
  }
  if (!Number.isInteger(options.timeoutMs) || options.timeoutMs < 1) {
    throw new Error("--timeout must be a positive integer (milliseconds)");
  }
  return options;
}

/**
 * Every non-domestic source, including the disabled ones: an operator can
 * enable a foreign source from the admin console at any time, and the
 * snapshot has to exist before that happens. The reader filters by the
 * `enabled` flag of its own config, so a snapshot for a disabled source
 * costs disk only.
 */
function selectSources(only: string[] | null): SourceDef[] {
  const all = loadAllSources();
  if (only) {
    const byId = new Map(all.map((s) => [s.id, s]));
    const unknown = only.filter((id) => !byId.has(id));
    if (unknown.length > 0) throw new Error(`unknown source id(s): ${unknown.join(", ")}`);
    return only.map((id) => byId.get(id) as SourceDef);
  }
  return all.filter((s) => s.domestic !== true);
}

/** fetchSource has no abort hook, so the deadline races the whole call. */
async function withTimeout<T>(work: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} timeout after ${timeoutMs}ms`)), timeoutMs);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

interface SnapshotResult {
  doc: SnapshotDoc;
  index: { id: string; ok: boolean; itemCount: number; durationMs: number; error?: string };
}

async function snapshotOne(source: SourceDef, options: CliOptions): Promise<SnapshotResult> {
  const startedAt = Date.now();
  let doc: SnapshotDoc;
  try {
    const items = await withTimeout(fetchSource(source), options.timeoutMs, source.id);
    doc = toSnapshotDoc(source.id, startedAt, { ok: true, items });
  } catch (e) {
    doc = toSnapshotDoc(source.id, startedAt, { ok: false, error: describeError(e) });
  }
  const status = doc.ok ? `${doc.itemCount}` : `FAILED — ${doc.error ?? "unknown"}`;
  console.log(`  ${source.id.padEnd(24)} ${status}`);
  return {
    doc,
    index: doc.ok
      ? { id: source.id, ok: true, itemCount: doc.itemCount, durationMs: doc.durationMs }
      : {
          id: source.id,
          ok: false,
          itemCount: 0,
          durationMs: doc.durationMs,
          error: doc.error ?? "unknown",
        },
  };
}

async function runPool<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const lanes = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (next < items.length) {
      const index = next;
      next += 1;
      results[index] = await worker(items[index]);
    }
  });
  await Promise.all(lanes);
  return results;
}

function pruneDateDirs(out: string, keep: number): string[] {
  const dates = fs
    .readdirSync(out, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && /^\d{4}-\d{2}-\d{2}$/.test(entry.name))
    .map((entry) => entry.name)
    .sort();
  const dropped = dates.slice(0, Math.max(0, dates.length - keep));
  for (const date of dropped) fs.rmSync(path.join(out, date), { recursive: true, force: true });
  return dropped;
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const targets = selectSources(options.only);
  console.log(`Snapshotting ${targets.length} source(s) into ${options.out}/${options.date}\n`);

  const results = await runPool(targets, options.concurrency, (source) => snapshotOne(source, options));

  const dateDir = path.join(options.out, options.date);
  fs.mkdirSync(dateDir, { recursive: true });
  for (const { doc } of results) {
    fs.writeFileSync(path.join(dateDir, `${doc.sourceId}.json`), `${JSON.stringify(doc, null, 2)}\n`);
  }
  const index = {
    date: options.date,
    generatedAt: new Date().toISOString(),
    sources: results.map((r) => r.index),
  };
  fs.writeFileSync(path.join(dateDir, "index.json"), `${JSON.stringify(index, null, 2)}\n`);

  const dropped = pruneDateDirs(options.out, options.keep);
  if (dropped.length > 0) console.log(`\nPruned ${dropped.length} old date dir(s): ${dropped.join(", ")}`);

  const ok = results.filter((r) => r.index.ok).length;
  const empty = results.filter((r) => r.index.ok && r.index.itemCount === 0).length;
  console.log(`\nDone: ${ok}/${results.length} ok (${empty} empty), ${results.length - ok} failed`);

  // A raced timeout leaves its socket open; the snapshot is already on disk.
  await new Promise<void>((resolve) => process.stdout.write("", () => resolve()));
  process.exit(0);
}

main().catch((e) => {
  console.error(`snapshot: ${(e as Error).message}`);
  process.exit(1);
});
