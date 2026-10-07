import { describe, expect, it } from "vitest";
import { ITEM_TRANSITIONS, isTerminalItemStatus, transitionItem } from "../../src/core/items.js";
import { ITEM_STATUSES, type ItemStatus } from "../../src/core/vocabulary.js";

const allPairs: ReadonlyArray<readonly [ItemStatus, ItemStatus]> = ITEM_STATUSES.flatMap((from) => ITEM_STATUSES.map((to) => [from, to] as const));

describe("item state machine", () => {
  it.each(allPairs.filter(([from, to]) => (ITEM_TRANSITIONS[from] as readonly ItemStatus[]).includes(to)))(
    "allows %s -> %s for a manager",
    (from, to) => {
      const moved = transitionItem(from, to, true);
      expect(moved).toEqual({ ok: true, value: to });
    },
  );

  it.each(allPairs.filter(([from, to]) => !(ITEM_TRANSITIONS[from] as readonly ItemStatus[]).includes(to)))(
    "refuses %s -> %s with INVALID_TRANSITION and changes nothing",
    (from, to) => {
      const moved = transitionItem(from, to, true);
      expect(moved.ok).toBe(false);
      if (!moved.ok) expect(moved.code).toBe("INVALID_TRANSITION");
    },
  );

  it("walks the forward path reported -> acknowledged -> fixed -> verified", () => {
    expect(transitionItem("reported", "acknowledged", true).ok).toBe(true);
    expect(transitionItem("acknowledged", "fixed", true).ok).toBe(true);
    expect(transitionItem("fixed", "verified", true).ok).toBe(true);
  });

  it("allows the one named backward edge only for a manager", () => {
    expect(transitionItem("fixed", "reported", true)).toEqual({ ok: true, value: "reported" });
    const byMember = transitionItem("fixed", "reported", false);
    expect(byMember.ok).toBe(false);
    if (!byMember.ok) expect(byMember.code).toBe("NOT_MANAGER");
  });

  it("treats verified, duplicate and wont_fix as terminal", () => {
    expect(isTerminalItemStatus("verified")).toBe(true);
    expect(isTerminalItemStatus("duplicate")).toBe(true);
    expect(isTerminalItemStatus("wont_fix")).toBe(true);
    expect(isTerminalItemStatus("reported")).toBe(false);
  });

  it("refuses a no-op transition to the same status", () => {
    for (const status of ITEM_STATUSES) expect(transitionItem(status, status, true).ok).toBe(false);
  });
});
