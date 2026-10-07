import { describe, expect, it } from "vitest";
import { BudgetGovernor } from "../../src/core/budget.js";
import type { Clock } from "../../src/core/ports.js";
import { BUDGET_PAUSE_RECHECK_MS, BUDGET_WINDOW_MS } from "../../src/core/tuning.js";
import { MemwalAdapter, type MemWalLike } from "../../src/memory/memwalAdapter.js";
import { isRateLimited, relayerStatus, retryAfterMs } from "../../src/memory/relayerError.js";
import { WriteQueue } from "../../src/memory/writeQueue.js";
import type { MemoryPort, MemoryWrite, NamespaceRecall, StoredMemory } from "../../src/memory/port.js";
import { refuse, ok, type Result } from "../../src/core/result.js";

const clock: Clock = { now: () => new Date("2026-10-08T09:00:00.000Z") };

function rateLimited(seconds?: number): Error {
  const error = new Error("Too Many Requests");
  Object.assign(error, { status: 429, ...(seconds === undefined ? {} : { retryAfterSeconds: seconds }) });
  return error;
}

function adapterThatThrows(error: unknown): MemwalAdapter {
  const client: MemWalLike = {
    rememberAndWait: async () => {
      throw error;
    },
    recall: async () => {
      throw error;
    },
    listNamespaces: async () => ({ namespaces: [], next_cursor: null, has_more: false }),
  };
  return new MemwalAdapter(client, new BudgetGovernor(clock, 10_000, BUDGET_WINDOW_MS));
}

describe("F07 a relayer 429 is a budget problem, not a write failure", () => {
  it("reads the status and the retry-after the relayer sent", () => {
    expect(relayerStatus(rateLimited(60))).toBe(429);
    expect(isRateLimited(rateLimited())).toBe(true);
    expect(isRateLimited(new Error("boom"))).toBe(false);
    expect(isRateLimited(null)).toBe(false);
    expect(retryAfterMs(rateLimited(60))).toBe(60_000);
    expect(retryAfterMs(rateLimited())).toBeNull();
    expect(retryAfterMs(new Error("boom"))).toBeNull();
  });

  it("refuses a rate-limited write as BUDGET_EXHAUSTED, never as WRITE_FAILED", async () => {
    const written = await adapterThatThrows(rateLimited(45)).remember({ namespace: "sd-c1-items", text: "x", idempotencyKey: "k" }, 1000);
    expect(written.ok).toBe(false);
    if (written.ok) return;
    expect(written.code).toBe("BUDGET_EXHAUSTED");
    expect(written.retryAfterMs).toBe(45_000);
    expect(written.detail).toContain("relayer rate limit (429)");
  });

  it("still refuses a genuine server error as WRITE_FAILED, with the status attached", async () => {
    const error = Object.assign(new Error("Internal Server Error"), { status: 500 });
    const written = await adapterThatThrows(error).remember({ namespace: "sd-c1-items", text: "x", idempotencyKey: "k" }, 1000);
    expect(written.ok).toBe(false);
    if (written.ok) return;
    expect(written.code).toBe("WRITE_FAILED");
    expect(written.detail).toContain("status=500");
  });

  it("treats a rate-limited recall as BUDGET_EXHAUSTED too, so boot does not call it unavailable", async () => {
    const recalled = await adapterThatThrows(rateLimited(30)).recallNamespace("sd-c1-items", 100);
    expect(recalled.ok).toBe(false);
    if (!recalled.ok) expect(recalled.code).toBe("BUDGET_EXHAUSTED");
  });

  it("carries the local governor's own retry window the same way", () => {
    const governor = new BudgetGovernor(clock, 5, BUDGET_WINDOW_MS);
    governor.spend("remember");
    const refused = governor.spend("remember");
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.retryAfterMs).toBe(BUDGET_WINDOW_MS);
  });
});

class RateLimitingMemory implements MemoryPort {
  readonly waits: number[] = [];
  attempts = 0;
  readonly #limitFor: number;
  readonly #retryAfterMs: number | null;

  constructor(limitFor: number, retryAfterMsValue: number | null) {
    this.#limitFor = limitFor;
    this.#retryAfterMs = retryAfterMsValue;
  }

  async remember(write: MemoryWrite): Promise<Result<StoredMemory>> {
    this.attempts += 1;
    if (this.attempts <= this.#limitFor) {
      return this.#retryAfterMs === null
        ? refuse("BUDGET_EXHAUSTED", "relayer rate limit (429)")
        : refuse("BUDGET_EXHAUSTED", "relayer rate limit (429)", this.#retryAfterMs);
    }
    return ok({ blobId: `blob${this.attempts}`, namespace: write.namespace });
  }

  async recallNamespace(namespace: string): Promise<Result<NamespaceRecall>> {
    return ok({ namespace, lines: [], droppedCount: 0, atLimit: false });
  }

  async search(namespace: string): Promise<Result<NamespaceRecall>> {
    return ok({ namespace, lines: [], droppedCount: 0, atLimit: false });
  }

  async namespacesWithPrefix(): Promise<Result<readonly string[]>> {
    return ok([]);
  }
}

describe("the queue pauses on a 429 and keeps the write", () => {
  const request = { seq: 1, namespace: "sd-c1-items", text: "SD1|seq=1|t=QUESTION_ASKED|themeId=t1|ts=2026-10-08T09:00:00.000Z", idempotencyKey: "k1" };

  it("waits exactly as long as the relayer asked, then saves the same write", async () => {
    const waits: number[] = [];
    const memory = new RateLimitingMemory(2, 90_000);
    const queue = new WriteQueue(memory, async (ms) => {
      waits.push(ms);
    }, () => {});
    const job = queue.enqueue(request);
    await queue.settled();
    expect(waits).toEqual([90_000, 90_000]);
    expect(job.state).toBe("saved");
    expect(job.code).toBeNull();
    expect(job.attempts).toBe(0);
    expect(memory.attempts).toBe(3);
  });

  it("falls back to the recheck interval when the relayer sent no retry-after", async () => {
    const waits: number[] = [];
    const memory = new RateLimitingMemory(1, null);
    const queue = new WriteQueue(memory, async (ms) => {
      waits.push(ms);
    }, () => {});
    await queue.enqueue(request);
    await queue.settled();
    expect(waits).toEqual([BUDGET_PAUSE_RECHECK_MS]);
  });

  it("shows the queue as paused while it waits, and never settles the job as failed", async () => {
    const memory = new RateLimitingMemory(1, 1_000);
    let pausedDuringWait = false;
    const settled: string[] = [];
    const queue = new WriteQueue(
      memory,
      async () => {
        pausedDuringWait = queue.paused();
      },
      (job) => settled.push(job.state),
    );
    const job = queue.enqueue(request);
    expect(job.state).toBe("saving");
    await queue.settled();
    expect(pausedDuringWait).toBe(true);
    expect(queue.paused()).toBe(false);
    expect(queue.pauses()).toBe(1);
    expect(settled).toEqual(["saved"]);
    expect(queue.counts()).toEqual({ saved: 1, failed: 0, pending: 0 });
  });

  it("leaves a rate-limited write pending rather than failed when shutdown closes the queue", async () => {
    const memory = new RateLimitingMemory(1_000, 1_000);
    const queue = new WriteQueue(memory, async () => {}, () => {}, clock);
    const job = queue.enqueue(request);
    queue.close();
    await queue.settled();
    expect(job.state).toBe("saving");
    expect(job.code).toBeNull();
    expect(queue.counts()).toEqual({ saved: 0, failed: 0, pending: 1 });
  });
});
