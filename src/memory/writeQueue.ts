import type { ErrorCode } from "../core/errors.js";
import type { Sleep } from "../core/ports.js";
import { BUDGET_PAUSE_RECHECK_MS, WRITE_ATTEMPTS, WRITE_PAUSE_LIMIT, WRITE_RETRY_BACKOFF_MS, WRITE_TIMEOUT_MS } from "../core/tuning.js";
import type { MemoryPort } from "./port.js";

export const WRITE_STATES = ["saving", "saved", "failed"] as const;
export type WriteState = (typeof WRITE_STATES)[number];

export interface WriteRequest {
  readonly seq: number;
  readonly namespace: string;
  readonly text: string;
  readonly idempotencyKey: string;
}

export interface WriteJob extends WriteRequest {
  state: WriteState;
  blobId: string | null;
  code: ErrorCode | null;
  attempts: number;
}

export type WriteListener = (job: Readonly<WriteJob>) => void;

export function backoffFor(attempt: number): number {
  return WRITE_RETRY_BACKOFF_MS[attempt - 1] ?? WRITE_RETRY_BACKOFF_MS[WRITE_RETRY_BACKOFF_MS.length - 1] ?? 0;
}

export class WriteQueue {
  readonly #memory: MemoryPort;
  readonly #sleep: Sleep;
  readonly #listener: WriteListener;
  readonly #pending: WriteJob[] = [];
  #runner: Promise<void> | null = null;
  #paused = false;

  constructor(memory: MemoryPort, sleep: Sleep, listener: WriteListener) {
    this.#memory = memory;
    this.#sleep = sleep;
    this.#listener = listener;
  }

  enqueue(request: WriteRequest): Readonly<WriteJob> {
    const job: WriteJob = { ...request, state: "saving", blobId: null, code: null, attempts: 0 };
    this.#pending.push(job);
    this.#start();
    return job;
  }

  depth(): number {
    return this.#pending.length;
  }

  paused(): boolean {
    return this.#paused;
  }

  async settled(): Promise<void> {
    while (this.#runner !== null) await this.#runner;
  }

  #start(): void {
    if (this.#runner !== null) return;
    this.#runner = this.#drain().finally(() => {
      this.#runner = null;
    });
  }

  async #drain(): Promise<void> {
    for (;;) {
      const job = this.#pending.shift();
      if (job === undefined) return;
      await this.#writeOne(job);
    }
  }

  async #writeOne(job: WriteJob): Promise<void> {
    let pauses = 0;
    for (;;) {
      const written = await this.#memory.remember(
        { namespace: job.namespace, text: job.text, idempotencyKey: job.idempotencyKey },
        WRITE_TIMEOUT_MS,
      );
      if (written.ok) {
        this.#settle(job, "saved", written.value.blobId, null);
        return;
      }
      if (written.code === "BUDGET_EXHAUSTED") {
        pauses += 1;
        if (pauses > WRITE_PAUSE_LIMIT) {
          this.#settle(job, "failed", null, "BUDGET_EXHAUSTED");
          return;
        }
        this.#paused = true;
        await this.#sleep(BUDGET_PAUSE_RECHECK_MS);
        this.#paused = false;
        continue;
      }
      job.attempts += 1;
      if (job.attempts >= WRITE_ATTEMPTS) {
        this.#settle(job, "failed", null, written.code);
        return;
      }
      await this.#sleep(backoffFor(job.attempts));
    }
  }

  #settle(job: WriteJob, state: WriteState, blobId: string | null, code: ErrorCode | null): void {
    job.state = state;
    job.blobId = blobId;
    job.code = code;
    this.#listener(job);
  }
}
