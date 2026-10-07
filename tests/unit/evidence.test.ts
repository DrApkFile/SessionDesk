import { describe, expect, it } from "vitest";
import { A06_MIN_MEMBERS, A06_MIN_MEMORIES, aggregateNamespace, publicEvidence, summarise } from "../../src/evidence/aggregate.js";
import { encode } from "../../src/core/codec.js";
import type { LedgerEvent } from "../../src/core/events.js";
import type { RecalledLine } from "../../src/memory/port.js";

const COMMUNITY = "c1";
const MEMBER_A = "a".repeat(24);

function line(event: LedgerEvent, blobId: string): RecalledLine {
  return { text: encode(event), blobId, createdAt: null };
}

function question(seq: number, day: string): LedgerEvent {
  return { type: "QUESTION_ASKED", themeId: "t1", seq, ts: `${day}T09:00:00.000Z` };
}

const memberNamespace = `sd-${COMMUNITY}-m-${MEMBER_A}`;

describe("A06 counts saved memories per member", () => {
  it("counts one memory per decodable line and keeps its blob id", () => {
    const found = aggregateNamespace(COMMUNITY, memberNamespace, [
      line(question(1, "2026-10-07"), "blob1"),
      line(question(2, "2026-10-07"), "blob2"),
    ]);
    expect(found.memories).toBe(2);
    expect(found.blobIds).toEqual(["blob1", "blob2"]);
    expect(found.memberCode).toBe("aaaaaaaa");
    expect(found.kind).toBe("member");
  });

  it("counts the distinct days a member was active, not the number of lines", () => {
    const found = aggregateNamespace(COMMUNITY, memberNamespace, [
      line(question(1, "2026-10-07"), "b1"),
      line(question(2, "2026-10-07"), "b2"),
      line(question(3, "2026-10-08"), "b3"),
    ]);
    expect(found.activeDays).toEqual(["2026-10-07", "2026-10-08"]);
    expect(found.firstSeen).toBe("2026-10-07T09:00:00.000Z");
    expect(found.lastSeen).toBe("2026-10-08T09:00:00.000Z");
  });

  it("counts a line it cannot decode as undecodable, never as a memory", () => {
    const found = aggregateNamespace(COMMUNITY, memberNamespace, [
      line(question(1, "2026-10-07"), "b1"),
      { text: "SD9|seq=1|t=QUESTION_ASKED|themeId=t1|ts=2026-10-07T09:00:00.000Z", blobId: "b2", createdAt: null },
      { text: "not a ledger line", blobId: "b3", createdAt: null },
    ]);
    expect(found.memories).toBe(1);
    expect(found.undecodable).toBe(2);
    expect(found.blobIds).toEqual(["b1"]);
  });

  it("breaks a member's memories down by event type", () => {
    const found = aggregateNamespace(COMMUNITY, memberNamespace, [
      line({ type: "CONSENT_GIVEN", scope: "storage", seq: 1, ts: "2026-10-07T09:00:00.000Z" }, "b1"),
      line({ type: "ITEM_OPENED", itemId: "i1", kind: "bug", themeId: "t1", text: "fails", seq: 2, ts: "2026-10-07T09:01:00.000Z" }, "b2"),
      line(question(3, "2026-10-07"), "b3"),
    ]);
    expect(found.eventTypes).toEqual({ CONSENT_GIVEN: 1, ITEM_OPENED: 1, QUESTION_ASKED: 1 });
  });

  it("gives a shared namespace no member code, so it is never counted as a member", () => {
    const items = aggregateNamespace(COMMUNITY, `sd-${COMMUNITY}-items`, [line(question(1, "2026-10-07"), "b1")]);
    expect(items.memberCode).toBeNull();
    expect(items.kind).toBe("items");
    expect(summarise([items]).members).toEqual([]);
  });

  it("never puts a full member hash in the evidence that gets published", () => {
    const found = aggregateNamespace(COMMUNITY, memberNamespace, [line(question(1, "2026-10-07"), "b1")]);
    expect(found.memberCode).toHaveLength(8);
    const published = JSON.stringify(publicEvidence(found));
    expect(published).not.toContain(MEMBER_A);
    expect(published).not.toContain(memberNamespace);
    expect(published).toContain('"label":"member:aaaaaaaa"');
    expect(published).toContain('"memories":1');
  });

  it("keeps the real namespace name for a shared namespace, which holds nobody's code", () => {
    const items = aggregateNamespace(COMMUNITY, `sd-${COMMUNITY}-items`, [line(question(1, "2026-10-07"), "b1")]);
    expect(publicEvidence(items).label).toBe("sd-c1-items");
  });
});

describe("the A06 threshold is reported, never assumed", () => {
  function member(code: string, memories: number, days: readonly string[]) {
    return {
      namespace: `sd-c1-m-${code.repeat(3)}`,
      kind: "member" as const,
      memberCode: code,
      memories,
      undecodable: 0,
      activeDays: days,
      firstSeen: null,
      lastSeen: null,
      eventTypes: {},
      blobIds: Array.from({ length: memories }, (_unused, index) => `${code}-${index}`),
    };
  }

  it("is met by three members with ten memories each", () => {
    const summary = summarise([member("aaaaaaaa", 12, ["2026-10-07", "2026-10-08"]), member("bbbbbbbb", 10, ["2026-10-08"]), member("cccccccc", 10, ["2026-10-08"])]);
    expect(summary.met).toBe(true);
    expect(summary.membersMeetingThreshold).toBe(3);
    expect(summary.blobs).toBe(32);
    expect(summary.distinctDaysAcross).toEqual(["2026-10-07", "2026-10-08"]);
  });

  it("is not met when only two members reach the count", () => {
    const summary = summarise([member("aaaaaaaa", 12, []), member("bbbbbbbb", 11, []), member("cccccccc", 9, [])]);
    expect(summary.met).toBe(false);
    expect(summary.membersMeetingThreshold).toBe(2);
    expect(summary.membersWithAnyMemory).toBe(3);
  });

  it("is not met by one very active member", () => {
    expect(summarise([member("aaaaaaaa", 99, [])]).met).toBe(false);
  });

  it("is not met by an empty community, and says so with zeros", () => {
    const summary = summarise([]);
    expect(summary).toMatchObject({ met: false, membersMeetingThreshold: 0, membersWithAnyMemory: 0, blobs: 0 });
    expect(summary.distinctDaysAcross).toEqual([]);
  });

  it("does not count a member with no memories towards the count of members", () => {
    const summary = summarise([member("aaaaaaaa", 0, [])]);
    expect(summary.membersWithAnyMemory).toBe(0);
    expect(summary.members).toHaveLength(1);
  });

  it("lists the busiest member first", () => {
    const summary = summarise([member("bbbbbbbb", 3, []), member("aaaaaaaa", 7, [])]);
    expect(summary.members.map((found) => found.memberCode)).toEqual(["aaaaaaaa", "bbbbbbbb"]);
  });

  it("uses the thresholds the event asked for", () => {
    expect(A06_MIN_MEMBERS).toBe(3);
    expect(A06_MIN_MEMORIES).toBe(10);
  });
});
