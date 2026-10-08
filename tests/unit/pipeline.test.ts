import { describe, expect, it } from "vitest";
import { EventPipeline } from "../../src/bots/shared/pipeline.js";
import { decode } from "../../src/core/codec.js";
import { SeqAllocator } from "../../src/core/seq.js";
import { LedgerCache } from "../../src/memory/cache.js";
import { WriteQueue } from "../../src/memory/writeQueue.js";
import { FakeMemory } from "../support/fakeMemory.js";

const MEMBER = "a".repeat(24);
const now = new Date("2026-10-08T09:00:00.000Z");

function field(options: { writeDelayMs?: number } = {}) {
  const memory = new FakeMemory(options);
  const cache = new LedgerCache();
  const queue = new WriteQueue(memory, async () => {}, (job) => {
    if (job.state === "saved" && job.blobId !== null) cache.markSaved(job.seq, job.namespace, job.blobId);
  });
  return { memory, cache, queue, pipeline: new EventPipeline(new SeqAllocator(5), () => cache, queue, "c1") };
}

describe("the write pipeline", () => {
  it("gives every event the next sequence number and one line per namespace", () => {
    const { pipeline, cache } = field();
    const recorded = pipeline.commit(
      [
        { draft: { type: "THEME_CREATED", themeId: "t1", label: "login" }, namespaces: [{ kind: "themes" }] },
        { draft: { type: "ITEM_OPENED", itemId: "i1", kind: "bug", themeId: "t1", text: "fails" }, namespaces: [{ kind: "member", memberH: MEMBER }, { kind: "items" }] },
      ],
      { chatId: "-100", messageId: "7" },
      now,
    );
    expect(recorded.map((write) => write.event.seq)).toEqual([5, 6]);
    expect(recorded[1]?.namespaces).toEqual([`sd-c1-m-${MEMBER}`, "sd-c1-items"]);
    expect(cache.size()).toBe(3);
    expect(cache.memoriesOf(MEMBER)).toHaveLength(1);
  });

  it("writes exactly what the codec can read back", async () => {
    const { pipeline, memory, queue } = field();
    pipeline.commit([{ draft: { type: "QUESTION_ASKED", themeId: "t1" }, namespaces: [{ kind: "member", memberH: MEMBER }] }], { chatId: "-100", messageId: "1" }, now);
    await queue.settled();
    const stored = memory.stored.get(`sd-c1-m-${MEMBER}`)?.[0]?.text ?? "";
    expect(decode(stored)).toEqual({ type: "QUESTION_ASKED", themeId: "t1", seq: 5, ts: now.toISOString() });
  });

  it("gives each namespace copy of one event its own idempotency key", async () => {
    const { pipeline, memory, queue } = field();
    pipeline.commit(
      [{ draft: { type: "ITEM_OPENED", itemId: "i1", kind: "bug", themeId: "t1", text: "fails" }, namespaces: [{ kind: "member", memberH: MEMBER }, { kind: "items" }] }],
      { chatId: "-100", messageId: "7" },
      now,
    );
    await queue.settled();
    const keys = memory.writeCalls.map((write) => write.idempotencyKey);
    expect(new Set(keys).size).toBe(2);
  });

  it("F01 returns before the write and leaves the line saving", async () => {
    const { pipeline, cache, queue, memory } = field({ writeDelayMs: 30 });
    pipeline.commit([{ draft: { type: "CONSENT_GIVEN", scope: "storage" }, namespaces: [{ kind: "member", memberH: MEMBER }] }], { chatId: "-100", messageId: "1" }, now);
    expect(cache.memoriesOf(MEMBER)[0]?.state).toBe("saving");
    expect(memory.stored.size).toBe(0);
    await queue.settled();
    expect(cache.memoriesOf(MEMBER)[0]?.state).toBe("saved");
  });
});
