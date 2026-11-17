import "./_env";

import { loadAllSources } from "../lib/sources/registry";
import { channelOptionsFromEnv } from "../lib/sources/channel";
import { describeError } from "../lib/sources/run";
import { fetchSourceByChannel } from "../lib/sources/channel";
import { judgeFreshness, newestPublishedAt } from "../lib/sources/freshness";
import type { FreshnessCheck } from "../lib/sources/freshness";
import { writeSourceConfig } from "../lib/sources/config";
import type { SourceDef } from "../lib/sources/types";

interface Row extends FreshnessCheck {
  source: SourceDef;
}

interface Args {
  days: number;
  only: string[];
  json: boolean;
  disableStale: boolean;
  concurrency: number;
  includeDisabled: boolean;
}

function parseArgs(argv: string[]): Args {
  const args: Args = {
    days: 14,
    only: [],
    json: false,
    disableStale: false,
    concurrency: 4,
    includeDisabled: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    const next = () => {
      const value = argv[i + 1];
      if (value === undefined) throw new Error(`${flag} needs a value`);
      i += 1;
      return value;
    };
    switch (flag) {
      case "--days":
        args.days = Number(next());
        break;
      case "--only":
        args.only = next().split(",").map((s) => s.trim()).filter(Boolean);
        break;
      case "--json":
        args.json = true;
        break;
      case "--disable-stale":
        args.disableStale = true;
        break;
      case "--concurrency":
        args.concurrency = Number(next());
        break;
      case "--include-disabled":
        args.includeDisabled = true;
        break;
      default:
        throw new Error(`unknown flag '${flag}'`);
    }
  }
  if (!Number.isFinite(args.days) || args.days < 0) {
    throw new Error("--days must be a non-negative number");
  }
  if (!Number.isInteger(args.concurrency) || args.concurrency < 1) {
    throw new Error("--concurrency must be a positive integer");
  }
  return args;
}

async function runPool<T, R>(
  items: T[],
  limit: number,
  task: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const index = cursor;
      cursor += 1;
      if (index >= items.length) return;
      results[index] = await task(items[index]);
    }
  });
  await Promise.all(workers);
  return results;
}

function pad(value: string, width: number): string {
  return value.length >= width ? value.slice(0, width) : value.padEnd(width);
}

function formatDate(at: Date | undefined): string {
  if (!at) return "—";
  return at.toISOString().slice(0, 10);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const all = loadAllSources();
  const selected = all.filter((s) => {
    if (args.only.length > 0) return args.only.includes(s.id);
    return args.includeDisabled || s.enabled !== false;
  });
  if (selected.length === 0) {
    throw new Error("no source matched the given filters");
  }

  const channel = channelOptionsFromEnv();
  const now = new Date();
  if (!args.json) {
    console.log(
      `Checking ${selected.length} source(s) against a ${args.days}-day freshness window…\n`,
    );
  }

  const rows = await runPool(selected, args.concurrency, async (source): Promise<Row> => {
    try {
      const { items } = await fetchSourceByChannel(source, channel);
      const check = judgeFreshness(
        items.length,
        newestPublishedAt(items),
        now,
        args.days,
      );
      return { ...check, source };
    } catch (e) {
      return { verdict: "error", itemCount: 0, error: describeError(e), source };
    }
  });

  if (args.json) {
    console.log(
      JSON.stringify(
        rows.map((row) => ({
          id: row.source.id,
          name: row.source.name,
          category: row.source.category,
          subcategory: row.source.subcategory,
          enabled: row.source.enabled !== false,
          domestic: row.source.domestic === true,
          verdict: row.verdict,
          ageDays: row.ageDays,
          newestAt: row.newestAt?.toISOString().slice(0, 10),
          itemCount: row.itemCount,
          error: row.error,
        })),
        null,
        2,
      ),
    );
  } else {
    console.log(
      `${pad("id", 22)}${pad("verdict", 9)}${pad("age", 5)}${pad("items", 7)}${pad("newest", 12)}name`,
    );
    for (const row of rows) {
      const age = row.ageDays === undefined ? "—" : `${row.ageDays}d`;
      console.log(
        `${pad(row.source.id, 22)}${pad(row.verdict, 9)}${pad(age, 5)}${pad(String(row.itemCount), 7)}${pad(formatDate(row.newestAt), 12)}${row.source.name}`,
      );
    }
    const counts = rows.reduce<Record<string, number>>((acc, row) => {
      acc[row.verdict] = (acc[row.verdict] ?? 0) + 1;
      return acc;
    }, {});
    const summary = Object.entries(counts)
      .map(([verdict, count]) => `${verdict} ${count}`)
      .join(", ");
    console.log(`\n${rows.length} checked — ${summary}`);
  }

  const stale = rows.filter((row) => row.verdict === "stale");
  if (stale.length === 0) {
    console.log("\nNo source is older than the freshness window.");
    return;
  }
  if (!args.disableStale) {
    console.log(
      `\nStale: ${stale.map((row) => row.source.id).join(", ")}\nRe-run with --disable-stale to set enabled=false on exactly these sources.`,
    );
    return;
  }
  const staleIds = new Set(stale.map((row) => row.source.id));
  const next = all.map((source) =>
    staleIds.has(source.id) ? { ...source, enabled: false } : source,
  );
  const written = writeSourceConfig(next);
  const disabled = written.filter((source) => staleIds.has(source.id) && source.enabled === false);
  console.log(
    `\nDisabled ${disabled.length} stale source(s): ${disabled.map((s) => s.id).join(", ")}`,
  );
  console.log("sources.config.json.bak holds the previous file.");
}

main().catch((e: unknown) => {
  console.error(describeError(e));
  process.exit(1);
});
