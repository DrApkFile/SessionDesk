import type { ErrorCode } from "../core/errors.js";
import { systemClock, type Clock, type Sleep } from "../core/ports.js";
import { BUDGET_PAUSE_RECHECK_MS, DRAIN_POLL_MS, WRITE_ATTEMPTS, WRITE_RETRY_BACKOFF_MS, WRITE_TIMEOUT_MS } from "../core/tuning.js";
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

export interface WriteCounts {
  readonly saved: number;
  readonly failed: number;
  readonly pending: number;
}

function yieldToTimers(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

export function backoffFor(attempt: number): number {
  return WRITE_RETRY_BACKOFF_MS[attempt - 1] ?? WRITE_RETRY_BACKOFF_MS[WRITE_RETRY_BACKOFF_MS.length - 1] ?? 0;
}

export class WriteQueue {
  readonly #memory: MemoryPort;
  readonly #sleep: Sleep;
  readonly #listener: WriteListener;
  readonly #pending: WriteJob[] = [];
  readonly #clock: Clock;
  #runner: Promise<void> | null = null;
  #paused = false;
  #closed = false;
  #inFlight: WriteJob | null = null;
  #saved = 0;
  #failed = 0;
  #refused = 0;
  #pauses = 0;

  constructor(memory: MemoryPort, sleep: Sleep, listener: WriteListener, clock: Clock = systemClock) {
    this.#memory = memory;
    this.#sleep = sleep;
    this.#listener = listener;
    this.#clock = clock;
  }

  enqueue(request: WriteRequest): Readonly<WriteJob> {
    const job: WriteJob = { ...request, state: "saving", blobId: null, code: null, attempts: 0 };
    if (this.#closed) {
      this.#refused += 1;
      this.#settle(job, "failed", null, "WRITE_FAILED");
      return job;
    }
    this.#pending.push(job);
    this.#start();
    return job;
  }

  close(): void {
    this.#closed = true;
  }

  closed(): boolean {
    return this.#closed;
  }

  refused(): number {
    return this.#refused;
  }

  counts(): WriteCounts {
    return { saved: this.#saved, failed: this.#failed, pending: this.#pending.length + (this.#inFlight === null ? 0 : 1) };
  }

  async drain(timeoutMs: number): Promise<WriteCounts> {
    const startedAt = this.#clock.now().getTime();
    while (this.counts().pending > 0 && this.#clock.now().getTime() - startedAt < timeoutMs) {
      await Promise.race([this.#runner ?? Promise.resolve(), this.#sleep(DRAIN_POLL_MS)]);
      await yieldToTimers();
    }
    return this.counts();
  }

  depth(): number {
    return this.#pending.length;
  }

  paused(): boolean {
    return this.#paused;
  }

  pauses(): number {
    return this.#pauses;
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
      this.#inFlight = job;
      await this.#writeOne(job);
      if (job.state === "saving") {
        this.#pending.unshift(job);
        this.#inFlight = null;
        return;
      }
      this.#inFlight = null;
    }
  }

  async #writeOne(job: WriteJob): Promise<void> {
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
        this.#pauses += 1;
        this.#paused = true;
        await this.#sleep(written.retryAfterMs ?? BUDGET_PAUSE_RECHECK_MS);
        this.#paused = false;
        if (this.#closed) return;
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
    if (state === "saved") this.#saved += 1;
    if (state === "failed") this.#failed += 1;
    job.state = state;
    job.blobId = blobId;
    job.code = code;
    this.#listener(job);
  }
}
