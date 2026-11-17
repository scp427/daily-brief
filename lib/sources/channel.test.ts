import assert from "node:assert/strict";
import test from "node:test";

import { channelOptionsFromEnv, fetchSourceByChannel } from "./channel";
import type { SnapshotDoc } from "./snapshot";
import type { RawArticle, SourceDef } from "./types";

const REPO = "scp427/daily-brief";
const NOW = Date.parse("2026-11-16T22:30:00Z");

function source(overrides: Partial<SourceDef> = {}): SourceDef {
  return {
    id: "bbc-business",
    name: "BBC Business",
    type: "rss",
    url: "https://feeds.bbci.co.uk/news/business/rss.xml",
    category: "finance",
    enabled: true,
    ...overrides,
  };
}

function snapshotBody(): string {
  const doc: SnapshotDoc = {
    schemaVersion: 1,
    sourceId: "bbc-business",
    fetchedAt: new Date(NOW).toISOString(),
    ok: true,
    itemCount: 1,
    durationMs: 900,
    items: [{ sourceId: "bbc-business", title: "from snapshot", url: "https://x/1", category: "finance" }],
  };
  return JSON.stringify(doc);
}

const fetchOnlyMirror = (async () => new Response(snapshotBody())) as unknown as typeof fetch;
const fetchUnreachable = (async () => {
  throw new Error("getaddrinfo ENOTFOUND raw.githubusercontent.com");
}) as unknown as typeof fetch;

const directNever: (s: SourceDef) => Promise<RawArticle[]> = async () => {
  throw new Error("direct fetch must not run");
};
const directFails = async (): Promise<RawArticle[]> => {
  throw new Error("AggregateError (ETIMEDOUT)");
};
const directOk = async (): Promise<RawArticle[]> => [
  { sourceId: "bbc-business", title: "from direct", url: "https://x/2", category: "finance" },
];

const baseOptions = { repo: REPO, preferSnapshot: false, dates: ["2026-11-16"], timeoutMs: 1000 };

test("a mainland host with preferSnapshot serves the report from the snapshot", async () => {
  const result = await fetchSourceByChannel(source(), {
    ...baseOptions,
    preferSnapshot: true,
    fetchImpl: fetchOnlyMirror,
    fetchDirect: directNever,
  });
  assert.equal(result.origin, "snapshot");
  assert.equal(result.items[0].title, "from snapshot");
});

test("a failed direct fetch falls back to the snapshot instead of reporting a failure", async () => {
  const result = await fetchSourceByChannel(source(), {
    ...baseOptions,
    fetchImpl: fetchOnlyMirror,
    fetchDirect: directFails,
  });
  assert.equal(result.origin, "snapshot");
});

test("domestic sources never touch the snapshot channel", async () => {
  let snapshotRequests = 0;
  const countingFetch = (async () => {
    snapshotRequests += 1;
    return new Response(snapshotBody());
  }) as unknown as typeof fetch;

  const result = await fetchSourceByChannel(source({ id: "v2ex-hot", domestic: true }), {
    ...baseOptions,
    preferSnapshot: true,
    fetchImpl: countingFetch,
    fetchDirect: directOk,
  });
  assert.equal(result.origin, "direct");
  assert.equal(snapshotRequests, 0);
});

test("with no snapshot and no direct reachability the direct error surfaces", async () => {
  await assert.rejects(
    fetchSourceByChannel(source(), {
      ...baseOptions,
      fetchImpl: fetchUnreachable,
      fetchDirect: directFails,
    }),
    /ETIMEDOUT/,
  );
});

test("channelOptionsFromEnv fails loud when the snapshot is preferred without a repo", () => {
  assert.throws(() => channelOptionsFromEnv({ SNAPSHOT_PREFER: "true" }), /SNAPSHOT_REPO/);

  const options = channelOptionsFromEnv({ SNAPSHOT_REPO: REPO, REPORT_TZ: "UTC" }, new Date(NOW));
  assert.equal(options.repo, REPO);
  assert.equal(options.preferSnapshot, false);
  assert.deepEqual(options.dates, ["2026-11-16", "2026-11-15", "2026-11-14"]);
});
