import { dayOf } from "./dates.js";
import { isDueToday, isOverdue } from "./promises.js";
import type { CommunityState, PromiseRecord } from "./state.js";

export const FOLLOWUP_AUDIENCES = ["manager", "member"] as const;
export type FollowUpAudience = (typeof FOLLOWUP_AUDIENCES)[number];

export interface DuePromise {
  readonly promise: PromiseRecord;
  readonly overdue: boolean;
  readonly reminderKey: string;
}

export function reminderKey(promiseId: string, day: string): string {
  return `${promiseId}:${day}`;
}

export function duePromises(state: CommunityState, now: Date): readonly DuePromise[] {
  const today = dayOf(now);
  return [...state.promises.values()]
    .filter((promise) => promise.state === "open" && (isDueToday(promise, now) || isOverdue(promise, now)))
    .sort((left, right) => (left.due < right.due ? -1 : left.due > right.due ? 1 : 0))
    .map((promise) => ({ promise, overdue: isOverdue(promise, now), reminderKey: reminderKey(promise.promiseId, today) }));
}

export function managerReminder(due: DuePromise, memberLabel: string): string {
  const head = due.overdue ? `overdue since ${due.promise.due}` : `due today (${due.promise.due})`;
  const item = due.promise.itemId === null ? "" : ` [${due.promise.itemId}]`;
  return [
    `Follow-up: ${due.promise.promiseId} is ${head}.`,
    `You promised ${memberLabel}${item}: ${due.promise.text}`,
    `Mark it kept with /done ${due.promise.promiseId}, or /promise again with a new date if it has slipped.`,
  ].join("\n");
}

export function memberReminder(due: DuePromise): string {
  const head = due.overdue
    ? `A manager promised you this by ${due.promise.due}, and it is not done yet.`
    : `A manager promised you this by today, ${due.promise.due}.`;
  return [head, `The promise was: ${due.promise.text}`, "It is still open on record. The team has been reminded. I will tell you when it is marked done."].join("\n");
}
