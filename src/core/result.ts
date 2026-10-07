import type { ErrorCode } from "./errors.js";

export interface Refusal {
  readonly ok: false;
  readonly code: ErrorCode;
  readonly detail?: string;
}

export interface Success<T> {
  readonly ok: true;
  readonly value: T;
}

export type Result<T> = Success<T> | Refusal;

export function ok<T>(value: T): Success<T> {
  return { ok: true, value };
}

export function refuse(code: ErrorCode, detail?: string): Refusal {
  return detail === undefined ? { ok: false, code } : { ok: false, code, detail };
}
