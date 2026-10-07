import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { resolve } from "../../src/core/resolver.js";
import type { LedgerEntry } from "../../src/core/state.js";
import { MEMBER_A, MEMBER_B, ambassadorLedger, revokedLedger, sampleLedger } from "../support/ledger.js";
import { snapshotState } from "../support/snapshot.js";

describe("F12 resolver folds by seq", () => {
  it("reaches the same state whatever order walrus returns the entries in", () => {
    const expected = snapshotState(resolve(sampleLedger));
    fc.assert(
      fc.property(fc.shuffledSubarray([...sampleLedger], { minLength: sampleLedger.length, maxLength: sampleLedger.length }), (shuffled) => {
        expect(snapshotState(resolve(shuffled))).toBe(expected);
      }),
      { numRuns: 200 },
    );
  });

  it("lets the newest status win even when the stale one is recalled last", () => {
    const stale: LedgerEntry = { memberH: null, event: { type: "ITEM_STATUS", itemId: "i1", status: "acknowledged", seq: 5, ts: "2026-10-06T09:00:00.000Z" } };
    const state = resolve([...sampleLedger, stale]);
    expect(state.items.get("i1")?.status).toBe("fixed");
    expect(state.items.get("i1")?.statusSeq).toBe(7);
  });

  it("ignores a duplicate copy of the same entry", () => {
    expect(snapshotState(resolve([...sampleLedger, ...sampleLedger]))).toBe(snapshotState(resolve(sampleLedger)));
  });

  it("links an item to the member who opened it even though the items namespace copy has no member", () => {
    const state = resolve(sampleLedger);
    expect(state.items.get("i1")?.openedByH).toBe(MEMBER_A);
    expect(state.members.get(MEMBER_A)?.itemIds).toEqual(["i1"]);
    expect(state.themes.get("t1")?.itemIds).toEqual(["i1"]);
  });

  it("counts active days, points and the derived tier for a member", () => {
    const member = resolve(sampleLedger).members.get(MEMBER_A);
    expect(member?.consented).toBe(true);
    expect(member?.dmConsent).toBe(true);
    expect([...(member?.activeDays ?? [])]).toEqual(["2026-10-05", "2026-10-06", "2026-10-07"]);
    expect(member?.points).toBe(2);
    expect(member?.tier).toBe("regular");
    expect(member?.helperPairDayCounts.get(`${MEMBER_B}:2026-10-07`)).toBe(1);
  });

  it("applies a correction to the fact it names", () => {
    expect(resolve(sampleLedger).members.get(MEMBER_A)?.profile.get("role")).toBe("developer");
  });

  it("keeps the promise, the theme count and the manager note", () => {
    const state = resolve(sampleLedger);
    expect(state.promises.get("p1")?.state).toBe("fulfilled");
    expect(state.themes.get("t1")?.questionCount).toBe(1);
    expect(state.notes).toHaveLength(1);
    expect(state.maxSeq).toBe(12);
    expect(state.rejectedEvents).toBe(0);
  });

  it("refuses a stored status that the state machine does not allow and records it", () => {
    const impossible: LedgerEntry = { memberH: null, event: { type: "ITEM_STATUS", itemId: "i1", status: "acknowledged", seq: 20, ts: "2026-10-08T09:00:00.000Z" } };
    const state = resolve([...sampleLedger, impossible]);
    expect(state.items.get("i1")?.status).toBe("fixed");
    expect(state.rejectedEvents).toBe(1);
  });

  it("reaches the same state whatever order the tier events arrive in", () => {
    for (const ledger of [ambassadorLedger, revokedLedger]) {
      const expected = snapshotState(resolve(ledger));
      fc.assert(
        fc.property(fc.shuffledSubarray([...ledger], { minLength: ledger.length, maxLength: ledger.length }), (shuffled) => {
          expect(snapshotState(resolve(shuffled))).toBe(expected);
        }),
        { numRuns: 150 },
      );
    }
  });

  it("holds a granted ambassador above the earned tier, and drops back to earned on revoke", () => {
    const granted = resolve(ambassadorLedger).members.get(MEMBER_A);
    expect(granted?.grantedTier).toBe("ambassador");
    expect(granted?.tier).toBe("ambassador");
    const revoked = resolve(revokedLedger).members.get(MEMBER_A);
    expect(revoked?.grantedTier).toBeNull();
    expect(revoked?.tier).toBe("regular");
  });

  it("refuses a second grant and a revoke with no grant, and records both", () => {
    const doubled = resolve([...ambassadorLedger, { memberH: MEMBER_A, event: { type: "TIER_SET", memberH: MEMBER_A, tier: "ambassador", byManagerId: 4242, seq: 15, ts: "2026-10-07T12:00:00.000Z" } }]);
    expect(doubled.rejectedEvents).toBe(1);
    expect(doubled.members.get(MEMBER_A)?.tier).toBe("ambassador");
    const emptyRevoke = resolve([...revokedLedger, { memberH: MEMBER_A, event: { type: "TIER_REVOKED", memberH: MEMBER_A, byManagerId: 4242, seq: 16, ts: "2026-10-07T13:00:00.000Z" } }]);
    expect(emptyRevoke.rejectedEvents).toBe(1);
    expect(emptyRevoke.members.get(MEMBER_A)?.tier).toBe("regular");
  });

  it("does not count a manager action as a day the member was active", () => {
    expect([...(resolve(revokedLedger).members.get(MEMBER_A)?.activeDays ?? [])]).toEqual(["2026-10-05", "2026-10-06", "2026-10-07"]);
  });

  it("starts from nothing when walrus returns nothing", () => {
    const state = resolve([]);
    expect(state.members.size).toBe(0);
    expect(state.maxSeq).toBe(0);
  });
});
