import { describe, expect, it } from "vitest";
import { encode } from "../../src/core/codec.js";
import { recordedSleep } from "../../src/core/ports.js";
import { LedgerCache, type StoredLine } from "../../src/memory/cache.js";
import { WriteQueue } from "../../src/memory/writeQueue.js";
import { MEMBER_A, namespaceOf, onAccountA, sampleLedger } from "../support/ledger.js";
import { FakeMemory } from "../support/fakeMemory.js";

function lineOf(index: number): StoredLine {
  const entry = onAccountA(sampleLedger)[index];
  if (entry === undefined) throw new Error("fixture index out of range");
  return { seq: entry.event.seq, namespace: namespaceOf(entry), memberH: entry.memberH, event: entry.event, state: "saving", blobId: null, code: null };
}

describe("the derived cache", () => {
  it("answers from an event the moment it is accepted, before walrus has it", () => {
    const cache = new LedgerCache();
    cache.record(lineOf(0));
    expect(cache.state().members.get(MEMBER_A)?.consented).toBe(true);
    expect(cache.memoriesOf(MEMBER_A)[0]?.state).toBe("saving");
    expect(cache.memoriesOf(MEMBER_A)[0]?.blobId).toBeNull();
  });

  it("shows a blob receipt once the write lands", () => {
    const cache = new LedgerCache();
    const line = lineOf(0);
    cache.record(line);
    cache.markSaved(line.seq, line.namespace, "blob42");
    expect(cache.memoriesOf(MEMBER_A)[0]).toMatchObject({ state: "saved", blobId: "blob42", code: null });
  });

  it("shows a failed write as failed, never as saved", () => {
    const cache = new LedgerCache();
    const line = lineOf(0);
    cache.record(line);
    cache.markFailed(line.seq, line.namespace, "WRITE_FAILED");
    expect(cache.memoriesOf(MEMBER_A)[0]).toMatchObject({ state: "failed", blobId: null, code: "WRITE_FAILED" });
  });

  it("keeps one line per event per namespace, so a redelivery does not double count", () => {
    const cache = new LedgerCache();
    cache.record(lineOf(2));
    cache.record(lineOf(2));
    expect(cache.size()).toBe(1);
  });

  it("recomputes the state after every change", () => {
    const cache = new LedgerCache();
    cache.record(lineOf(0));
    const before = cache.state();
    cache.record(lineOf(1));
    expect(cache.state()).not.toBe(before);
    expect(cache.state().themes.size).toBe(1);
  });

  it("is replaced wholesale by a boot rebuild", () => {
    const cache = new LedgerCache();
    cache.record(lineOf(0));
    cache.replaceAll([]);
    expect(cache.size()).toBe(0);
    expect(cache.state().members.size).toBe(0);
  });

  it("follows the queue from saving to saved without the caller waiting", async () => {
    const memory = new FakeMemory({ writeDelayMs: 10 });
    const cache = new LedgerCache();
    const queue = new WriteQueue(memory, recordedSleep([]), (job) => {
      if (job.state === "saved" && job.blobId !== null) cache.markSaved(job.seq, job.namespace, job.blobId);
      if (job.state === "failed" && job.code !== null) cache.markFailed(job.seq, job.namespace, job.code);
    });
    const line = lineOf(0);
    cache.record(line);
    queue.enqueue({ seq: line.seq, namespace: line.namespace, text: encode(line.event), idempotencyKey: "key-1" });
    expect(cache.memoriesOf(MEMBER_A)[0]?.state).toBe("saving");
    await queue.settled();
    expect(cache.memoriesOf(MEMBER_A)[0]?.state).toBe("saved");
  });
});
