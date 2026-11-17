import assert from "node:assert/strict";
import test from "node:test";

import { describeError } from "./run";

test("describeError keeps a plain error message", () => {
  assert.equal(describeError(new Error("boom")), "boom");
});

test("describeError falls back to the code when the message is empty", () => {
  const timedOut = Object.assign(new AggregateError([], ""), { code: "ETIMEDOUT" });
  assert.equal(describeError(timedOut), "AggregateError (ETIMEDOUT)");
});

test("describeError reads the code from the cause chain", () => {
  const wrapped = new Error("", { cause: { code: "ECONNRESET" } });
  assert.equal(describeError(wrapped), "Error (ECONNRESET)");
});

test("describeError does not repeat a code already present in the message", () => {
  const err = Object.assign(new Error("connect ETIMEDOUT 1.2.3.4"), { code: "ETIMEDOUT" });
  assert.equal(describeError(err), "connect ETIMEDOUT 1.2.3.4");
});

test("describeError stringifies non-errors", () => {
  assert.equal(describeError("plain string"), "plain string");
});
