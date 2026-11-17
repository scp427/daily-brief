import crypto from "node:crypto";

/**
 * In-memory job table for work that outlives an HTTP response.
 *
 * Writing a piece runs several fetches and one long model call; the reverse
 * proxy cuts a request after 60s, so a synchronous handler would report a
 * failure for work that is still running. Jobs are held here instead and read
 * back by polling. A restart drops the table — the drafts themselves are on
 * disk, so nothing the operator needs is lost.
 */

export type JobState = "running" | "done" | "failed";

export interface Job<T> {
  id: string;
  label: string;
  state: JobState;
  /** Human-readable current step, replaced as the job advances. */
  stage: string;
  /** Append-only progress lines, newest last. */
  log: string[];
  startedAt: string;
  finishedAt: string | null;
  error: string | null;
  result: T | null;
}

export interface JobHandle {
  setStage(stage: string): void;
  log(line: string): void;
}

export class QueueBusyError extends Error {
  constructor(
    message: string,
    readonly running: string[],
  ) {
    super(message);
    this.name = "QueueBusyError";
  }
}

export interface JobQueueOptions {
  /** Jobs allowed to run at once. One by default: runners share model quota. */
  concurrency?: number;
  /** Finished jobs kept for polling; the oldest are dropped first. */
  keep?: number;
  /** Id source, injectable so tests can assert on ids. */
  makeId?: () => string;
}

export class JobQueue<T> {
  private readonly jobs = new Map<string, Job<T>>();
  private readonly concurrency: number;
  private readonly keep: number;
  private readonly makeId: () => string;

  constructor(options: JobQueueOptions = {}) {
    this.concurrency = options.concurrency ?? 1;
    this.keep = options.keep ?? 20;
    this.makeId = options.makeId ?? (() => crypto.randomUUID().slice(0, 8));
  }

  /** Newest first, so a poller listing jobs sees its submission at the top. */
  list(): Job<T>[] {
    return [...this.jobs.values()].reverse();
  }

  get(id: string): Job<T> | null {
    return this.jobs.get(id) ?? null;
  }

  running(): Job<T>[] {
    return [...this.jobs.values()].filter((job) => job.state === "running");
  }

  /**
   * Begin a job. Throws `QueueBusyError` when every slot is taken, so a caller
   * can answer 409 instead of queueing work the operator did not ask for.
   */
  start(label: string, run: (handle: JobHandle) => Promise<T>): Job<T> {
    const active = this.running();
    if (active.length >= this.concurrency) {
      throw new QueueBusyError(
        `已有任务在跑（${active.map((job) => job.label).join(", ")}），等它结束再提交。`,
        active.map((job) => job.label),
      );
    }
    const job: Job<T> = {
      id: this.makeId(),
      label,
      state: "running",
      stage: "排队中",
      log: [],
      startedAt: new Date().toISOString(),
      finishedAt: null,
      error: null,
      result: null,
    };
    this.jobs.set(job.id, job);
    this.trim();

    const handle: JobHandle = {
      setStage: (stage) => {
        job.stage = stage;
      },
      log: (line) => {
        job.log.push(line);
      },
    };
    void (async () => {
      try {
        job.result = await run(handle);
        job.state = "done";
        job.stage = "完成";
      } catch (error) {
        job.state = "failed";
        job.error = error instanceof Error ? error.message : String(error);
        job.stage = "失败";
      } finally {
        job.finishedAt = new Date().toISOString();
      }
    })();
    return job;
  }

  /** Drop the oldest finished jobs once the table is full; running jobs stay. */
  private trim(): void {
    if (this.jobs.size <= this.keep) return;
    for (const [id, job] of this.jobs) {
      if (this.jobs.size <= this.keep) return;
      if (job.state === "running") continue;
      this.jobs.delete(id);
    }
  }
}
