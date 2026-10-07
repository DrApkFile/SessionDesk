import type { Clock, Sleep } from "../../core/ports.js";
import { CONFLICT_BACKOFF_MS, POLLING_RESTART_BACKOFF_MS } from "../../core/tuning.js";
import type { Log } from "./log.js";

export const POLLING_STATES = ["starting", "polling", "conflict_backoff", "retry_backoff", "stopped", "unauthorized"] as const;
export type PollingState = (typeof POLLING_STATES)[number];

export interface Pollable {
  readonly name: string;
  start(onPolling: () => void): Promise<void>;
  stop(): Promise<void>;
}

export function telegramErrorCode(error: unknown): number | null {
  if (typeof error !== "object" || error === null) return null;
  const code = (error as { error_code?: unknown }).error_code;
  return typeof code === "number" ? code : null;
}

export function isConflict(error: unknown): boolean {
  return telegramErrorCode(error) === 409;
}

export function isUnauthorized(error: unknown): boolean {
  return telegramErrorCode(error) === 401;
}

export function conflictBackoff(conflicts: number): number {
  const index = Math.min(Math.max(conflicts - 1, 0), CONFLICT_BACKOFF_MS.length - 1);
  return CONFLICT_BACKOFF_MS[index] ?? POLLING_RESTART_BACKOFF_MS;
}

export class PollingSupervisor {
  readonly #target: Pollable;
  readonly #sleep: Sleep;
  readonly #clock: Clock;
  readonly #log: Log;
  #state: PollingState = "starting";
  #conflicts = 0;
  #restarts = 0;
  #stopping = false;
  #pollingSince: string | null = null;

  constructor(target: Pollable, sleep: Sleep, clock: Clock, log: Log) {
    this.#target = target;
    this.#sleep = sleep;
    this.#clock = clock;
    this.#log = log;
  }

  state(): PollingState {
    return this.#state;
  }

  polling(): boolean {
    return this.#state === "polling";
  }

  conflicts(): number {
    return this.#conflicts;
  }

  restarts(): number {
    return this.#restarts;
  }

  pollingSince(): string | null {
    return this.#pollingSince;
  }

  async stop(): Promise<void> {
    this.#stopping = true;
    this.#state = "stopped";
    this.#pollingSince = null;
    await this.#target.stop();
  }

  async run(): Promise<void> {
    while (!this.#stopping) {
      try {
        this.#state = "starting";
        await this.#target.start(() => {
          this.#state = "polling";
          this.#pollingSince = this.#clock.now().toISOString();
        });
        if (this.#stopping) return;
        this.#state = "retry_backoff";
        this.#log.say("polling_ended", { bot: this.#target.name, action: "restarting", state: this.#state });
        await this.#sleep(POLLING_RESTART_BACKOFF_MS);
      } catch (error) {
        if (this.#stopping) return;
        if (isUnauthorized(error)) {
          this.#state = "unauthorized";
          this.#pollingSince = null;
          this.#log.say("polling_unauthorized", { bot: this.#target.name, action: "check the bot token; not retrying" });
          return;
        }
        this.#pollingSince = null;
        if (isConflict(error)) {
          this.#conflicts += 1;
          this.#state = "conflict_backoff";
          const wait = conflictBackoff(this.#conflicts);
          this.#log.say("polling_conflict", { bot: this.#target.name, conflicts: this.#conflicts, waitMs: wait, cause: "another instance is polling this token" });
          await this.#sleep(wait);
        } else {
          this.#state = "retry_backoff";
          this.#log.say("polling_error", { bot: this.#target.name, detail: String(error instanceof Error ? error.message : error).slice(0, 200) });
          await this.#sleep(POLLING_RESTART_BACKOFF_MS);
        }
      }
      this.#restarts += 1;
    }
  }
}
