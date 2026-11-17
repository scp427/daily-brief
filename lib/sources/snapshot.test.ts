import assert from "node:assert/strict";
import test from "node:test";

import {
  fromSnapshotItem,
  readSnapshot,
  recentSnapshotDates,
  snapshotDate,
  snapshotUrls,
  toSnapshotDoc,
  validateSnapshotDoc,
  type SnapshotDoc,
} from "./snapshot";
import type { RawArticle } from "./types";

const NOW = Date.parse("2026-11-16T22:30:00Z");
const REPO = "scp427/daily-brief";

function doc(overrides: Partial<SnapshotDoc> = {}): SnapshotDoc {
  return {
    schemaVersion: 1,
    sourceId: "bbc-business",
    fetchedAt: new Date(NOW).toISOString(),
    ok: true,
    itemCount: 1,
    durationMs: 1200,
    items: [{ sourceId: "bbc-business", title: "t", url: "https://x/y", category: "finance" }],
    ...overrides,
  };
}

const article: RawArticle = {
  sourceId: "bbc-business",
  title: "Markets steady",
  url: "https://example.com/a",
  category: "finance",
  excerpt: "ex",
  publishedAt: new Date("2026-11-16T08:00:00Z"),
  meta: "BBC",
};

test("toSnapshotDoc keeps the article fields and never drops the failure reason", () => {
  const ok = toSnapshotDoc("bbc-business", Date.now() - 500, { ok: true, items: [article] });
  assert.equal(ok.ok, true);
  assert.equal(ok.itemCount, 1);
  assert.deepEqual(ok.items, [
    {
      sourceId: "bbc-business",
      title: "Markets steady",
      url: "https://example.com/a",
      category: "finance",
      excerpt: "ex",
      publishedAt: "2026-11-16T08:00:00.000Z",
      meta: "BBC",
    },
  ]);

  const failed = toSnapshotDoc("bbc-business", Date.now(), { ok: false, error: "ETIMEDOUT" });
  assert.equal(failed.ok, false);
  assert.equal(failed.itemCount, 0);
  assert.deepEqual(failed.items, []);
  assert.equal(failed.error, "ETIMEDOUT");
});

test("fromSnapshotItem revives publishedAt as a Date", () => {
  const revived = fromSnapshotItem({
    sourceId: "bbc-business",
    title: "t",
    url: "https://x/y",
    category: "finance",
    publishedAt: "2026-11-16T08:00:00.000Z",
  });
  assert.ok(revived.publishedAt instanceof Date);
  assert.equal(revived.publishedAt.toISOString(), "2026-11-16T08:00:00.000Z");
  assert.equal(revived.excerpt, undefined);
});

test("validateSnapshotDoc rejects a schema it cannot read", () => {
  assert.throws(() => validateSnapshotDoc({ ...doc(), schemaVersion: 2 }), /schemaVersion/);
  assert.throws(() => validateSnapshotDoc({ ...doc(), items: undefined }), /items/);
  assert.throws(
    () => validateSnapshotDoc({ ...doc(), items: [{ sourceId: "x", title: "t" }] }),
    /items\[0\] missing string 'url'/,
  );
});

test("snapshotDate follows the report timezone, not the runner clock", () => {
  const instant = new Date("2026-11-16T22:30:00Z");
  assert.equal(snapshotDate("Asia/Shanghai", instant), "2026-11-17");
  assert.equal(snapshotDate("UTC", instant), "2026-11-16");
  assert.deepEqual(recentSnapshotDates("UTC", 2, instant), ["2026-11-16", "2026-11-15"]);
});

test("snapshotUrls prefers the API channel because raw.githubusercontent is poisoned in China", () => {
  const [api, ...mirrors] = snapshotUrls(REPO, "2026-11-16", "bbc-business");
  assert.equal(
    api,
    "https://api.github.com/repos/scp427/daily-brief/contents/snapshots/2026-11-16/bbc-business.json?ref=snapshots",
  );
  assert.equal(mirrors.length, 2);
  for (const mirror of mirrors) {
    assert.match(mirror, /^https:\/\/(gh-proxy\.com|ghfast\.top)\/https:\/\/raw\.githubusercontent\.com\//);
  }
});

function fetchStub(responses: Record<string, () => Response>): typeof fetch {
  return (async (input: string | URL | Request) => {
    const handler = responses[String(input)];
    return handler ? handler() : new Response("missing", { status: 404 });
  }) as typeof fetch;
}

test("readSnapshot falls through a failing channel to the next one", async () => {
  const [, firstMirror] = snapshotUrls(REPO, "2026-11-16", "bbc-business");
  const hit = await readSnapshot({
    repo: REPO,
    sourceId: "bbc-business",
    dates: ["2026-11-16"],
    now: () => NOW,
    fetchImpl: fetchStub({ [firstMirror]: () => new Response(JSON.stringify(doc())) }),
  });
  assert.ok(hit);
  assert.equal(hit.url, firstMirror);
  assert.equal(hit.doc.items.length, 1);
});

test("readSnapshot skips a recorded failure and a stale snapshot", async () => {
  const [, mirror] = snapshotUrls(REPO, "2026-11-16", "bbc-business");
  const failed = await readSnapshot({
    repo: REPO,
    sourceId: "bbc-business",
    dates: ["2026-11-16"],
    now: () => NOW,
    fetchImpl: fetchStub({ [mirror]: () => new Response(JSON.stringify(doc({ ok: false, error: "timeout" }))) }),
  });
  assert.equal(failed, null);

  const stale = await readSnapshot({
    repo: REPO,
    sourceId: "bbc-business",
    dates: ["2026-11-16"],
    now: () => NOW + 27 * 60 * 60 * 1000,
    fetchImpl: fetchStub({ [mirror]: () => new Response(JSON.stringify(doc())) }),
  });
  assert.equal(stale, null);
});

test("readSnapshot returns null when every date and channel is empty", async () => {
  const hit = await readSnapshot({
    repo: REPO,
    sourceId: "bbc-business",
    dates: ["2026-11-16", "2026-11-15"],
    now: () => NOW,
    fetchImpl: fetchStub({}),
  });
  assert.equal(hit, null);
});

test("readSnapshot sends the token to the API channel only", async () => {
  const [api, ...mirrors] = snapshotUrls(REPO, "2026-11-16", "bbc-business");
  const seen: { url: string; auth: string | null }[] = [];
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const headers = new Headers(init?.headers);
    seen.push({ url, auth: headers.get("authorization") });
    if (url === api) return new Response("rate limited", { status: 403 });
    return new Response(JSON.stringify(doc()));
  }) as typeof fetch;

  const hit = await readSnapshot({
    repo: REPO,
    sourceId: "bbc-business",
    dates: ["2026-11-16"],
    now: () => NOW,
    token: "ghp_test",
    fetchImpl,
  });

  assert.ok(hit);
  assert.equal(seen[0].url, api);
  assert.equal(seen[0].auth, "Bearer ghp_test");
  assert.equal(seen.length, 2);
  assert.ok(mirrors.includes(seen[1].url));
  assert.equal(seen[1].auth, null);
  assert.equal(hit.url, seen[1].url);
});
