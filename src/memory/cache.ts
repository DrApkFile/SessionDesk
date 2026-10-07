import type { ErrorCode } from "../core/errors.js";
import type { LedgerEvent } from "../core/events.js";
import { resolve } from "../core/resolver.js";
import type { CommunityState, LedgerEntry } from "../core/state.js";
import type { WriteState } from "./writeQueue.js";

export interface StoredLine {
  readonly seq: number;
  readonly namespace: string;
  readonly memberH: string | null;
  readonly event: LedgerEvent;
  state: WriteState;
  blobId: string | null;
  code: ErrorCode | null;
}

function lineKey(seq: number, namespace: string): string {
  return `${seq}|${namespace}`;
}

export class LedgerCache {
  #lines = new Map<string, StoredLine>();
  #state: CommunityState | null = null;

  replaceAll(lines: readonly StoredLine[]): void {
    this.#lines = new Map(lines.map((line) => [lineKey(line.seq, line.namespace), line]));
    this.#state = null;
  }

  record(line: StoredLine): void {
    this.#lines.set(lineKey(line.seq, line.namespace), line);
    this.#state = null;
  }

  markSaved(seq: number, namespace: string, blobId: string): void {
    const line = this.#lines.get(lineKey(seq, namespace));
    if (line === undefined) return;
    line.state = "saved";
    line.blobId = blobId;
    line.code = null;
  }

  markFailed(seq: number, namespace: string, code: ErrorCode): void {
    const line = this.#lines.get(lineKey(seq, namespace));
    if (line === undefined) return;
    line.state = "failed";
    line.blobId = null;
    line.code = code;
  }

  entries(): readonly LedgerEntry[] {
    return [...this.#lines.values()].map((line) => ({ event: line.event, memberH: line.memberH }));
  }

  lines(): readonly StoredLine[] {
    return [...this.#lines.values()];
  }

  memoriesOf(memberH: string): readonly StoredLine[] {
    return this.lines()
      .filter((line) => line.memberH === memberH)
      .sort((left, right) => left.seq - right.seq);
  }

  state(): CommunityState {
    if (this.#state === null) this.#state = resolve(this.entries());
    return this.#state;
  }

  size(): number {
    return this.#lines.size;
  }
}
