import { describe, expect, it } from "vitest";
import { addDays, dayOf, daysBetween, isCalendarDay, parsePromiseDue } from "../../src/core/dates.js";
import { PROMISE_MAX_DAYS_AHEAD } from "../../src/core/tuning.js";

const now = new Date("2026-10-07T09:00:00.000Z");

describe("F19 promise due dates", () => {
  it("accepts today and any day inside the window", () => {
    expect(parsePromiseDue("2026-10-07", now)).toEqual({ ok: true, value: "2026-10-07" });
    expect(parsePromiseDue(` ${addDays(dayOf(now), PROMISE_MAX_DAYS_AHEAD)} `, now).ok).toBe(true);
  });

  it("refuses a past day, a day beyond the window and a non-date", () => {
    for (const raw of ["2026-10-06", addDays(dayOf(now), PROMISE_MAX_DAYS_AHEAD + 1), "thursday", "2026-13-01", "2026-02-30", "07/10/2026"]) {
      const parsed = parsePromiseDue(raw, now);
      expect(parsed.ok).toBe(false);
      if (!parsed.ok) expect(parsed.code).toBe("INVALID_DATE");
    }
  });

  it("recognises calendar days that really exist", () => {
    expect(isCalendarDay("2026-02-28")).toBe(true);
    expect(isCalendarDay("2026-02-29")).toBe(false);
    expect(isCalendarDay("2024-02-29")).toBe(true);
  });

  it("counts days between two days", () => {
    expect(daysBetween("2026-10-07", "2026-10-09")).toBe(2);
    expect(daysBetween("2026-10-09", "2026-10-07")).toBe(-2);
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
  });
});
