import assert from "node:assert/strict";
import test from "node:test";

import { JobQueue, QueueBusyError } from "./job-queue";

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve: (value: T) => void = () => {};
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

/** Let the queue's completion handlers run before asserting on the job. */
async function settle(): Promise<void> {
  await new Promise<void>((done) => setImmediate(done));
}

test("a started job reports running until the work resolves", async () => {
  const queue = new JobQueue<string>({ makeId: () => "job1" });
  const gate = deferred<string>();

  const job = queue.start("topic", async () => gate.promise);
  assert.equal(job.id, "job1");
  assert.equal(job.state, "running");
  assert.equal(queue.running().length, 1);

  gate.resolve("草稿");
  await settle();
  assert.equal(job.state, "done");
  assert.equal(job.result, "草稿");
  assert.equal(job.error, null);
  assert.ok(job.finishedAt);
  assert.equal(queue.running().length, 0);
});

test("a throwing job records the message and frees its slot", async () => {
  const queue = new JobQueue<null>({ makeId: () => "job1" });
  queue.start("digest", async () => {
    throw new Error("抓取失败：正文为空");
  });
  await settle();

  const job = queue.get("job1");
  assert.ok(job);
  assert.equal(job.state, "failed");
  assert.equal(job.error, "抓取失败：正文为空");
  assert.equal(job.result, null);
  assert.equal(queue.running().length, 0);

  // The slot must be reusable after a failure, otherwise one bad run would
  // wedge the page until restart.
  const next = queue.start("digest", async () => null);
  assert.equal(next.state, "running");
});

test("a second submission is refused while the only slot is busy", async () => {
  const queue = new JobQueue<null>({ makeId: (() => {
    let n = 0;
    return () => `job${++n}`;
  })() });
  const gate = deferred<null>();
  queue.start("topic：英伟达", async () => gate.promise);

  assert.throws(
    () => queue.start("digest", async () => null),
    (error: unknown) =>
      error instanceof QueueBusyError &&
      error.running.includes("topic：英伟达") &&
      /已有任务在跑/.test((error as Error).message),
  );

  gate.resolve(null);
  await settle();
  const third = queue.start("digest", async () => null);
  assert.equal(third.state, "running");
});

test("concurrency above one admits parallel jobs up to the limit", async () => {
  const queue = new JobQueue<null>({ concurrency: 2 });
  const gate = deferred<null>();
  queue.start("a", async () => gate.promise);
  queue.start("b", async () => gate.promise);
  assert.equal(queue.running().length, 2);
  assert.throws(() => queue.start("c", async () => null), QueueBusyError);
  gate.resolve(null);
  await settle();
});

test("stage and log lines stay readable while the job runs", async () => {
  const queue = new JobQueue<null>({ makeId: () => "job1" });
  const gate = deferred<null>();
  queue.start("topic", async (handle) => {
    handle.setStage("抓取正文");
    handle.log("取回正文：文章 A（1200 字）");
    await gate.promise;
    return null;
  });
  await settle();

  const job = queue.get("job1");
  assert.ok(job);
  assert.equal(job.stage, "抓取正文");
  assert.deepEqual(job.log, ["取回正文：文章 A（1200 字）"]);

  gate.resolve(null);
  await settle();
  assert.equal(job.stage, "完成");
});

test("finished jobs beyond keep are dropped, newest listed first", async () => {
  let n = 0;
  const queue = new JobQueue<number>({ keep: 2, makeId: () => `job${++n}` });
  for (const value of [1, 2, 3]) {
    queue.start(`run ${value}`, async () => value);
    await settle();
  }
  const ids = queue.list().map((job) => job.id);
  assert.deepEqual(ids, ["job3", "job2"]);
  assert.equal(queue.get("job1"), null);
});
