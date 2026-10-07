import { describe, expect, it, vi } from "vitest";
import { recordedSleep } from "../../src/core/ports.js";
import { BUDGET_PAUSE_RECHECK_MS, WRITE_ATTEMPTS, WRITE_RETRY_BACKOFF_MS } from "../../src/core/tuning.js";
import { WriteQueue, backoffFor, type WriteJob } from "../../src/memory/writeQueue.js";
import { FakeMemory } from "../support/fakeMemory.js";

function request(seq: number) {
  return { seq, namespace: "sd-c1-items", text: `SD1|seq=${seq}|t=QUESTION_ASKED|themeId=t1|ts=2026-10-07T09:00:00.000Z`, idempotencyKey: `key-${seq}` };
}

describe("F01 the reply path never awaits a write", () => {
  it("returns a saving job before the walrus write has finished", async () => {
    const memory = new FakeMemory({ writeDelayMs: 30 });
    const queue = new WriteQueue(memory, recordedSleep([]), () => {});
    const before = Date.now();
    const job = queue.enqueue(request(1));
    expect(Date.now() - before).toBeLessThan(10);
    expect(job.state).toBe("saving");
    expect(job.blobId).toBeNull();
    await queue.settled();
    expect(job.state).toBe("saved");
  });

  it("accepts a burst of writes without blocking the caller", () => {
    const memory = new FakeMemory({ writeDelayMs: 20 });
    const queue = new WriteQueue(memory, recordedSleep([]), () => {});
    for (let seq = 1; seq <= 5; seq += 1) queue.enqueue(request(seq));
    expect(queue.depth()).toBeGreaterThan(0);
  });

  it("writes one at a time, in order", async () => {
    const memory = new FakeMemory({ writeDelayMs: 5 });
    const queue = new WriteQueue(memory, recordedSleep([]), () => {});
    for (let seq = 1; seq <= 4; seq += 1) queue.enqueue(request(seq));
    await queue.settled();
    expect(memory.writeCalls.map((write) => write.idempotencyKey)).toEqual(["key-1", "key-2", "key-3", "key-4"]);
  });
});

describe("F02 a failed write is retried and then kept on record as failed", () => {
  it("retries with the same idempotency key so a completed write is not duplicated", async () => {
    const memory = new FakeMemory({ failWritesBefore: 2 });
    const queue = new WriteQueue(memory, recordedSleep([]), () => {});
    const job = queue.enqueue(request(7));
    await queue.settled();
    expect(memory.writeCalls).toHaveLength(3);
    expect(new Set(memory.writeCalls.map((write) => write.idempotencyKey))).toEqual(new Set(["key-7"]));
    expect(job.state).toBe("saved");
    expect(job.attempts).toBe(2);
  });

  it("gives up after the configured attempts and reports WRITE_FAILED, never a fake success", async () => {
    const memory = new FakeMemory({ failWritesBefore: 99 });
    const settled: WriteJob[] = [];
    const queue = new WriteQueue(memory, recordedSleep([]), (job) => settled.push({ ...job }));
    const job = queue.enqueue(request(8));
    await queue.settled();
    expect(memory.writeCalls).toHaveLength(WRITE_ATTEMPTS);
    expect(job.state).toBe("failed");
    expect(job.code).toBe("WRITE_FAILED");
    expect(job.blobId).toBeNull();
    expect(settled).toHaveLength(1);
  });

  it("backs off between attempts", async () => {
    const waits: number[] = [];
    const memory = new FakeMemory({ failWritesBefore: 99 });
    const queue = new WriteQueue(memory, recordedSleep(waits), () => {});
    queue.enqueue(request(9));
    await queue.settled();
    expect(waits).toEqual([...WRITE_RETRY_BACKOFF_MS].slice(0, WRITE_ATTEMPTS - 1));
    expect(backoffFor(99)).toBe(WRITE_RETRY_BACKOFF_MS[WRITE_RETRY_BACKOFF_MS.length - 1]);
  });
});

describe("F07 the queue pauses instead of overspending the points budget", () => {
  it("waits and retries without consuming an attempt while the budget is exhausted", async () => {
    const waits: number[] = [];
    const memory = new FakeMemory({ failWritesBefore: 2, writeFailureCode: "BUDGET_EXHAUSTED" });
    const queue = new WriteQueue(memory, recordedSleep(waits), () => {});
    const job = queue.enqueue(request(10));
    await queue.settled();
    expect(waits).toEqual([BUDGET_PAUSE_RECHECK_MS, BUDGET_PAUSE_RECHECK_MS]);
    expect(job.attempts).toBe(0);
    expect(job.state).toBe("saved");
    expect(queue.paused()).toBe(false);
  });

  it("keeps a rate-limited write pending for as long as the limit lasts, never marking it failed", async () => {
    const waits: number[] = [];
    const memory = new FakeMemory({ failWritesBefore: 4, writeFailureCode: "BUDGET_EXHAUSTED" });
    const queue = new WriteQueue(memory, recordedSleep(waits), () => {});
    const job = queue.enqueue(request(11));
    await queue.settled();
    expect(waits).toEqual(Array.from({ length: 4 }, () => BUDGET_PAUSE_RECHECK_MS));
    expect(job.attempts).toBe(0);
    expect(job.state).toBe("saved");
    expect(queue.pauses()).toBe(4);
  });
});

describe("the queue tells the cache what happened", () => {
  it("notifies once per job with the blob id", async () => {
    const listener = vi.fn();
    const memory = new FakeMemory();
    const queue = new WriteQueue(memory, recordedSleep([]), listener);
    queue.enqueue(request(1));
    queue.enqueue(request(2));
    await queue.settled();
    expect(listener).toHaveBeenCalledTimes(2);
    expect(listener.mock.calls.map((call) => (call[0] as WriteJob).blobId)).toEqual(["blob1", "blob2"]);
  });
});
