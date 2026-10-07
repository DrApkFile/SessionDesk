import type { Clock } from "./ports.js";
import { refuse, ok, type Result } from "./result.js";
import { BUDGET_POINTS_PER_WINDOW, BUDGET_WINDOW_MS, POINTS_PER_RECALL, POINTS_PER_REMEMBER } from "./tuning.js";

export const OPERATION_POINTS = { remember: POINTS_PER_REMEMBER, recall: POINTS_PER_RECALL } as const;

export type BudgetOperation = keyof typeof OPERATION_POINTS;

export interface BudgetGrant {
  readonly spent: number;
  readonly usedInWindow: number;
  readonly remaining: number;
}

interface Charge {
  readonly at: number;
  readonly points: number;
}

export class BudgetGovernor {
  readonly #clock: Clock;
  readonly #limit: number;
  readonly #windowMs: number;
  #charges: Charge[] = [];

  constructor(clock: Clock, limit: number = BUDGET_POINTS_PER_WINDOW, windowMs: number = BUDGET_WINDOW_MS) {
    this.#clock = clock;
    this.#limit = limit;
    this.#windowMs = windowMs;
  }

  spend(operation: BudgetOperation): Result<BudgetGrant> {
    const points = OPERATION_POINTS[operation];
    const at = this.#clock.now().getTime();
    this.#forget(at);
    const used = this.#used();
    if (used + points > this.#limit) {
      return refuse("BUDGET_EXHAUSTED", `retry after ${this.retryAfterMs(operation, at)} ms`);
    }
    this.#charges.push({ at, points });
    const usedInWindow = used + points;
    return ok({ spent: points, usedInWindow, remaining: this.#limit - usedInWindow });
  }

  usedInWindow(): number {
    this.#forget(this.#clock.now().getTime());
    return this.#used();
  }

  remaining(): number {
    return this.#limit - this.usedInWindow();
  }

  retryAfterMs(operation: BudgetOperation, at: number = this.#clock.now().getTime()): number {
    const points = OPERATION_POINTS[operation];
    let freed = this.#limit - this.#used();
    for (const charge of this.#charges) {
      freed += charge.points;
      if (freed >= points) return Math.max(0, charge.at + this.#windowMs - at);
    }
    return this.#windowMs;
  }

  #forget(at: number): void {
    this.#charges = this.#charges.filter((charge) => charge.at > at - this.#windowMs);
  }

  #used(): number {
    return this.#charges.reduce((total, charge) => total + charge.points, 0);
  }
}
