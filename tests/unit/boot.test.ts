import { describe, expect, it } from "vitest";
import { encode } from "../../src/core/codec.js";
import { idempotencyKey } from "../../src/core/idempotency.js";
import { recordedSleep } from "../../src/core/ports.js";
import { resolve } from "../../src/core/resolver.js";
import { RECALL_LIMIT } from "../../src/core/tuning.js";
import { bootProblem, describeBoot, rebuildFromWalrus } from "../../src/memory/boot.js";
import { LedgerCache } from "../../src/memory/cache.js";
import { WriteQueue } from "../../src/memory/writeQueue.js";
import { COMMUNITY_KEY, MEMBER_A, namespaceOf, onAccountA, revokedLedger } from "../support/ledger.js";
import { FakeMemory } from "../support/fakeMemory.js";
import { snapshotState } from "../support/snapshot.js";

const accountA = onAccountA(revokedLedger);

async function writeLedgerThrough(memory: FakeMemory): Promise<void> {
  const queue = new WriteQueue(memory, recordedSleep([]), () => {});
  accountA.forEach((entry, index) => {
    queue.enqueue({
      seq: entry.event.seq,
      namespace: namespaceOf(entry),
      text: encode(entry.event),
      idempotencyKey: idempotencyKey({ communityKey: COMMUNITY_KEY, chatId: -1001, messageId: 100 + index, eventType: entry.event.type, index: 0 }),
    });
  });
  await queue.settled();
}

describe("F16 boot rebuilds the cache from walrus", () => {
  it("reaches the same state after the process restarts and the cache is wiped", async () => {
    const memory = new FakeMemory();
    await writeLedgerThrough(memory);

    const rebuilt = new LedgerCache();
    const report = await rebuildFromWalrus(memory, COMMUNITY_KEY, rebuilt);
    expect(report.ok).toBe(true);
    if (!report.ok) return;

    expect(snapshotState(rebuilt.state())).toBe(snapshotState(resolve(accountA)));
    expect(report.value.decoded).toBe(accountA.length);
    expect(report.value.undecodable).toBe(0);
    expect(report.value.complete).toBe(true);
    expect(bootProblem(report.value)).toBeNull();
  });

  it("F12 reaches that state although walrus returns each namespace newest first", async () => {
    const memory = new FakeMemory();
    await writeLedgerThrough(memory);
    const namespace = `sd-${COMMUNITY_KEY}-m-${MEMBER_A}`;
    const recalled = await memory.recallNamespace(namespace, RECALL_LIMIT);
    expect(recalled.ok).toBe(true);
    if (!recalled.ok) return;
    const seqs = recalled.value.lines.map((line) => Number(/seq=(\d+)/.exec(line.text)?.[1]));
    expect(seqs).toEqual([...seqs].sort((left, right) => right - left));

    const rebuilt = new LedgerCache();
    await rebuildFromWalrus(memory, COMMUNITY_KEY, rebuilt);
    expect(rebuilt.state().items.get("i1")?.status).toBe("fixed");
    expect(rebuilt.state().members.get(MEMBER_A)?.tier).toBe("regular");
  });

  it("resumes the sequence after the highest seq found on walrus", async () => {
    const memory = new FakeMemory();
    await writeLedgerThrough(memory);
    const rebuilt = new LedgerCache();
    const report = await rebuildFromWalrus(memory, COMMUNITY_KEY, rebuilt);
    expect(report.ok && report.value.maxSeq).toBe(14);
    expect(report.ok && report.value.nextSeq).toBe(15);
  });

  it("keeps the manager notes namespace out of the account A rebuild", async () => {
    const memory = new FakeMemory();
    await writeLedgerThrough(memory);
    const rebuilt = new LedgerCache();
    await rebuildFromWalrus(memory, COMMUNITY_KEY, rebuilt);
    expect(rebuilt.state().notes).toEqual([]);
    expect(rebuilt.lines().some((line) => line.namespace.endsWith("-notes"))).toBe(false);
  });

  it("starts an empty community without inventing anything", async () => {
    const report = await rebuildFromWalrus(new FakeMemory(), COMMUNITY_KEY, new LedgerCache());
    expect(report.ok && report.value).toMatchObject({ namespaces: 0, decoded: 0, maxSeq: 0, nextSeq: 1, complete: true });
  });
});

describe("boot reports what it could not read", () => {
  it("F03 refuses to boot at all when walrus cannot list the namespaces", async () => {
    const memory = new FakeMemory({ listFails: true });
    const report = await rebuildFromWalrus(memory, COMMUNITY_KEY, new LedgerCache());
    expect(report.ok).toBe(false);
    if (!report.ok) expect(report.code).toBe("MEMORY_UNAVAILABLE");
  });

  it("F03 names a namespace it could not recall instead of treating it as empty", async () => {
    const memory = new FakeMemory();
    await writeLedgerThrough(memory);
    const namespace = `sd-${COMMUNITY_KEY}-m-${MEMBER_A}`;
    memory.configure({ recallFailures: new Set([namespace]) });
    const cache = new LedgerCache();
    const report = await rebuildFromWalrus(memory, COMMUNITY_KEY, cache);
    expect(report.ok).toBe(true);
    if (!report.ok) return;
    expect(report.value.failures).toEqual([{ namespace, code: "MEMORY_UNAVAILABLE" }]);
    expect(report.value.complete).toBe(false);
    expect(bootProblem(report.value)).toBe("MEMORY_UNAVAILABLE");
  });

  it("F04 flags a partial read when walrus dropped blobs it could not decrypt", async () => {
    const memory = new FakeMemory();
    await writeLedgerThrough(memory);
    const namespace = `sd-${COMMUNITY_KEY}-m-${MEMBER_A}`;
    memory.configure({ droppedPerNamespace: new Map([[namespace, 2]]) });
    const report = await rebuildFromWalrus(memory, COMMUNITY_KEY, new LedgerCache());
    expect(report.ok && report.value.dropped).toBe(2);
    expect(report.ok && report.value.partialNamespaces).toEqual([namespace]);
    expect(report.ok && bootProblem(report.value)).toBe("MEMORY_PARTIAL");
  });

  it("F05 flags a namespace that filled the recall limit", async () => {
    const memory = new FakeMemory();
    await writeLedgerThrough(memory);
    const report = await rebuildFromWalrus(memory, COMMUNITY_KEY, new LedgerCache(), 2);
    expect(report.ok && report.value.atLimitNamespaces.length).toBeGreaterThan(0);
    expect(report.ok && bootProblem(report.value)).toBe("MEMORY_PARTIAL");
  });

  it("counts a line it cannot decode rather than guessing at it", async () => {
    const memory = new FakeMemory();
    await writeLedgerThrough(memory);
    memory.seed(`sd-${COMMUNITY_KEY}-items`, ["SD9|seq=1|t=ITEM_OPENED|ts=2026-10-07T09:00:00.000Z", "not a ledger line at all"]);
    const report = await rebuildFromWalrus(memory, COMMUNITY_KEY, new LedgerCache());
    expect(report.ok && report.value.undecodable).toBe(2);
    expect(report.ok && bootProblem(report.value)).toBe("MEMORY_PARTIAL");
  });

  it("describes the boot in one line for the startup log", async () => {
    const memory = new FakeMemory();
    await writeLedgerThrough(memory);
    const report = await rebuildFromWalrus(memory, COMMUNITY_KEY, new LedgerCache());
    expect(report.ok && describeBoot(report.value)).toContain(`decoded=${accountA.length}`);
  });
});
