import { describe, expect, it } from "vitest";
import { BudgetGovernor } from "../../src/core/budget.js";
import type { Clock } from "../../src/core/ports.js";
import { BUDGET_WINDOW_MS, POINTS_PER_RECALL, POINTS_PER_REMEMBER } from "../../src/core/tuning.js";

function movableClock(start: string): Clock & { advance(ms: number): void } {
  let at = new Date(start).getTime();
  return { now: () => new Date(at), advance: (ms: number) => { at += ms; } };
}

describe("F07 points budget governor", () => {
  it("charges remember and recall at their point costs", () => {
    const clock = movableClock("2026-10-07T09:00:00.000Z");
    const governor = new BudgetGovernor(clock, 100, BUDGET_WINDOW_MS);
    expect(governor.spend("remember")).toEqual({ ok: true, value: { spent: POINTS_PER_REMEMBER, usedInWindow: POINTS_PER_REMEMBER, remaining: 100 - POINTS_PER_REMEMBER } });
    expect(governor.spend("recall").ok).toBe(true);
    expect(governor.usedInWindow()).toBe(POINTS_PER_REMEMBER + POINTS_PER_RECALL);
  });

  it("pauses with BUDGET_EXHAUSTED instead of overspending the window", () => {
    const clock = movableClock("2026-10-07T09:00:00.000Z");
    const governor = new BudgetGovernor(clock, 10, BUDGET_WINDOW_MS);
    expect(governor.spend("remember").ok).toBe(true);
    expect(governor.spend("remember").ok).toBe(true);
    const refused = governor.spend("remember");
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.code).toBe("BUDGET_EXHAUSTED");
    expect(governor.remaining()).toBe(0);
  });

  it("frees points again as the rolling window passes", () => {
    const clock = movableClock("2026-10-07T09:00:00.000Z");
    const governor = new BudgetGovernor(clock, 10, BUDGET_WINDOW_MS);
    governor.spend("remember");
    governor.spend("remember");
    expect(governor.spend("recall").ok).toBe(false);
    clock.advance(BUDGET_WINDOW_MS + 1);
    expect(governor.usedInWindow()).toBe(0);
    expect(governor.spend("remember").ok).toBe(true);
  });

  it("says how long the queue must wait", () => {
    const clock = movableClock("2026-10-07T09:00:00.000Z");
    const governor = new BudgetGovernor(clock, 5, BUDGET_WINDOW_MS);
    governor.spend("remember");
    clock.advance(60_000);
    const refused = governor.spend("remember");
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.detail).toBe(`retry after ${BUDGET_WINDOW_MS - 60_000} ms`);
  });
});
