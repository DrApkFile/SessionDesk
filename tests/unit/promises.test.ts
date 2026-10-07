import { describe, expect, it } from "vitest";
import { byDueThenOverdueFirst, fulfilPromise, isDueToday, isOverdue } from "../../src/core/promises.js";

const now = new Date("2026-10-07T09:00:00.000Z");

describe("promise state machine", () => {
  it("moves an open promise to fulfilled", () => {
    expect(fulfilPromise("open")).toEqual({ ok: true, value: "fulfilled" });
  });

  it("refuses to fulfil an already fulfilled promise", () => {
    const again = fulfilPromise("fulfilled");
    expect(again.ok).toBe(false);
    if (!again.ok) expect(again.code).toBe("INVALID_TRANSITION");
  });

  it("derives overdue from the due day and now, never from a stored flag", () => {
    expect(isOverdue({ state: "open", due: "2026-10-06" }, now)).toBe(true);
    expect(isOverdue({ state: "open", due: "2026-10-07" }, now)).toBe(false);
    expect(isOverdue({ state: "open", due: "2026-10-08" }, now)).toBe(false);
    expect(isOverdue({ state: "fulfilled", due: "2026-10-01" }, now)).toBe(false);
  });

  it("knows what is due today", () => {
    expect(isDueToday({ state: "open", due: "2026-10-07" }, now)).toBe(true);
    expect(isDueToday({ state: "fulfilled", due: "2026-10-07" }, now)).toBe(false);
  });

  it("sorts overdue first, then by due day", () => {
    const promises = [
      { state: "open", due: "2026-10-20" },
      { state: "open", due: "2026-10-05" },
      { state: "open", due: "2026-10-08" },
      { state: "open", due: "2026-10-01" },
    ] as const;
    const sorted = [...promises].sort((left, right) => byDueThenOverdueFirst(left, right, now));
    expect(sorted.map((promise) => promise.due)).toEqual(["2026-10-01", "2026-10-05", "2026-10-08", "2026-10-20"]);
  });
});
