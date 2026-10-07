import { refuse, ok, type Result } from "./result.js";
import { ITEM_STATUSES, type ItemStatus } from "./vocabulary.js";

export const ITEM_TRANSITIONS = {
  reported: ["acknowledged", "duplicate", "wont_fix"],
  acknowledged: ["fixed", "duplicate", "wont_fix"],
  fixed: ["verified", "reported", "duplicate", "wont_fix"],
  verified: [],
  duplicate: [],
  wont_fix: [],
} satisfies Record<ItemStatus, readonly ItemStatus[]>;

export const REOPEN_FROM: ItemStatus = "fixed";
export const REOPEN_TO: ItemStatus = "reported";

export const FIRST_ITEM_STATUS: ItemStatus = "reported";

export function isItemStatus(candidate: string): candidate is ItemStatus {
  return (ITEM_STATUSES as readonly string[]).includes(candidate);
}

export function isTerminalItemStatus(status: ItemStatus): boolean {
  return ITEM_TRANSITIONS[status].length === 0;
}

export function transitionItem(from: ItemStatus, to: ItemStatus, byManager: boolean): Result<ItemStatus> {
  const allowed: readonly ItemStatus[] = ITEM_TRANSITIONS[from];
  if (!allowed.includes(to)) return refuse("INVALID_TRANSITION", `${from} cannot become ${to}`);
  if (from === REOPEN_FROM && to === REOPEN_TO && !byManager) return refuse("NOT_MANAGER", "only a manager can reopen a fixed item");
  return ok(to);
}
