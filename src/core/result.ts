import type { ErrorCode } from "./errors.js";

export interface Refusal {
  readonly ok: false;
  readonly code: ErrorCode;
  readonly detail?: string;
  readonly retryAfterMs?: number;
}

export interface Success<T> {
  readonly ok: true;
  readonly value: T;
}

export type Result<T> = Success<T> | Refusal;

export function ok<T>(value: T): Success<T> {
  return { ok: true, value };
}

export function refuse(code: ErrorCode, detail?: string, retryAfterMs?: number): Refusal {
  const base = detail === undefined ? { ok: false as const, code } : { ok: false as const, code, detail };
  return retryAfterMs === undefined ? base : { ...base, retryAfterMs };
}
