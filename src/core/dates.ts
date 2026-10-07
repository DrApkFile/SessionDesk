import { refuse, ok, type Result } from "./result.js";
import { PROMISE_MAX_DAYS_AHEAD } from "./tuning.js";

const CALENDAR_DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

export function isCalendarDay(candidate: string): boolean {
  if (!CALENDAR_DAY_PATTERN.test(candidate)) return false;
  const parsed = new Date(`${candidate}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === candidate;
}

export function dayOf(moment: Date): string {
  return moment.toISOString().slice(0, 10);
}

export function addDays(day: string, days: number): string {
  return new Date(new Date(`${day}T00:00:00.000Z`).getTime() + days * MS_PER_DAY).toISOString().slice(0, 10);
}

export function daysBetween(from: string, to: string): number {
  return Math.round((new Date(`${to}T00:00:00.000Z`).getTime() - new Date(`${from}T00:00:00.000Z`).getTime()) / MS_PER_DAY);
}

export function parsePromiseDue(raw: string, now: Date): Result<string> {
  const candidate = raw.trim();
  if (!isCalendarDay(candidate)) return refuse("INVALID_DATE", "due date must be YYYY-MM-DD");
  const today = dayOf(now);
  const ahead = daysBetween(today, candidate);
  if (ahead < 0) return refuse("INVALID_DATE", "due date is in the past");
  if (ahead > PROMISE_MAX_DAYS_AHEAD) return refuse("INVALID_DATE", `due date is more than ${PROMISE_MAX_DAYS_AHEAD} days ahead`);
  return ok(candidate);
}
