import assert from "node:assert/strict";
import test from "node:test";

import { makeStatus } from "./status";

test("makeStatus records the channel of a successful fetch", () => {
  const startedAt = Date.now() - 5;
  const status = makeStatus("bbc-world", "daily", startedAt, { ok: true, itemCount: 30, origin: "snapshot" });
  assert.equal(status.id, "bbc-world");
  assert.equal(status.runKind, "daily");
  assert.equal(status.ok, true);
  assert.equal(status.itemCount, 30);
  assert.equal(status.origin, "snapshot");
  assert.equal(status.error, undefined);
  assert.ok(status.durationMs >= 5);
});

test("makeStatus keeps the error and omits the origin on failure", () => {
  const status = makeStatus("linuxdo", "dry-run", Date.now(), { ok: false, error: "Command failed" });
  assert.equal(status.ok, false);
  assert.equal(status.itemCount, 0);
  assert.equal(status.origin, undefined);
  assert.equal(status.error, "Command failed");
});
