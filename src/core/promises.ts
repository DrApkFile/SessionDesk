import { refuse, ok, type Result } from "./result.js";
import type { PromiseState } from "./vocabulary.js";
import { dayOf, isCalendarDay } from "./dates.js";

export const FIRST_PROMISE_STATE: PromiseState = "open";

export interface PromiseFacts {
  readonly state: PromiseState;
  readonly due: string;
}

export function fulfilPromise(state: PromiseState): Result<PromiseState> {
  if (state !== "open") return refuse("INVALID_TRANSITION", `a ${state} promise cannot be fulfilled again`);
  return ok("fulfilled");
}

export function isOverdue(promise: PromiseFacts, now: Date): boolean {
  if (promise.state !== "open" || !isCalendarDay(promise.due)) return false;
  return promise.due < dayOf(now);
}

export function isDueToday(promise: PromiseFacts, now: Date): boolean {
  return promise.state === "open" && promise.due === dayOf(now);
}

export function byDueThenOverdueFirst(left: PromiseFacts, right: PromiseFacts, now: Date): number {
  const leftOverdue = isOverdue(left, now) ? 0 : 1;
  const rightOverdue = isOverdue(right, now) ? 0 : 1;
  if (leftOverdue !== rightOverdue) return leftOverdue - rightOverdue;
  return left.due < right.due ? -1 : left.due > right.due ? 1 : 0;
}
