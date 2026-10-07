import { describe, expect, it } from "vitest";
import type { Clock } from "../../src/core/ports.js";
import { DRAIN_POLL_MS, SHUTDOWN_DRAIN_SECONDS } from "../../src/core/tuning.js";
import { WriteQueue } from "../../src/memory/writeQueue.js";
import { FakeMemory } from "../support/fakeMemory.js";

function request(seq: number) {
  return { seq, namespace: "sd-c1-items", text: `SD1|seq=${seq}|t=QUESTION_ASKED|themeId=t1|ts=2026-10-07T09:00:00.000Z`, idempotencyKey: `key-${seq}` };
}

function tickingClock(stepMs: number): Clock {
  let at = new Date("2026-10-08T09:00:00.000Z").getTime();
  return {
    now: () => {
      const moment = new Date(at);
      at += stepMs;
      return moment;
    },
  };
}

const frozenClock: Clock = { now: () => new Date("2026-10-08T09:00:00.000Z") };

describe("SIGTERM stops accepting writes and drains what is already queued", () => {
  it("saves everything already queued and reports the counts", async () => {
    const memory = new FakeMemory({ writeDelayMs: 5 });
    const queue = new WriteQueue(memory, async () => {}, () => {}, frozenClock);
    for (let seq = 1; seq <= 3; seq += 1) queue.enqueue(request(seq));
    queue.close();
    const drained = await queue.drain(SHUTDOWN_DRAIN_SECONDS * 1000);
    expect(drained).toEqual({ saved: 3, failed: 0, pending: 0 });
    expect(memory.writeCalls).toHaveLength(3);
  });

  it("refuses a new write once closed, and shows it as failed rather than saved", async () => {
    const memory = new FakeMemory();
    const queue = new WriteQueue(memory, async () => {}, () => {}, frozenClock);
    queue.close();
    const job = queue.enqueue(request(9));
    expect(queue.closed()).toBe(true);
    expect(job.state).toBe("failed");
    expect(job.code).toBe("WRITE_FAILED");
    expect(job.blobId).toBeNull();
    expect(queue.refused()).toBe(1);
    expect(memory.writeCalls).toHaveLength(0);
  });

  it("reports what is still pending when the drain window runs out, and never calls it saved", async () => {
    const memory = new FakeMemory({ writeDelayMs: 60_000 });
    const queue = new WriteQueue(memory, async () => {}, () => {}, tickingClock(DRAIN_POLL_MS));
    queue.enqueue(request(1));
    queue.enqueue(request(2));
    queue.close();
    const drained = await queue.drain(2_000);
    expect(drained.saved).toBe(0);
    expect(drained.pending).toBe(2);
    expect(drained.failed).toBe(0);
  });

  it("counts a write that failed its retries separately from one still pending", async () => {
    const memory = new FakeMemory({ failWritesBefore: 99 });
    const queue = new WriteQueue(memory, async () => {}, () => {}, frozenClock);
    queue.enqueue(request(1));
    queue.close();
    const drained = await queue.drain(SHUTDOWN_DRAIN_SECONDS * 1000);
    expect(drained).toEqual({ saved: 0, failed: 1, pending: 0 });
  });

  it("returns at once when there was nothing to drain", async () => {
    const queue = new WriteQueue(new FakeMemory(), async () => {}, () => {}, frozenClock);
    queue.close();
    expect(await queue.drain(SHUTDOWN_DRAIN_SECONDS * 1000)).toEqual({ saved: 0, failed: 0, pending: 0 });
  });

  it("counts the in-flight write as pending, not as saved", async () => {
    const memory = new FakeMemory({ writeDelayMs: 20 });
    const queue = new WriteQueue(memory, async () => {}, () => {}, frozenClock);
    queue.enqueue(request(1));
    queue.enqueue(request(2));
    expect(queue.counts()).toEqual({ saved: 0, failed: 0, pending: 2 });
    expect(queue.depth()).toBe(1);
    await queue.settled();
    expect(queue.counts()).toEqual({ saved: 2, failed: 0, pending: 0 });
  });
});
