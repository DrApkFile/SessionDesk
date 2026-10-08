import type { Clock, Sleep } from "../../core/ports.js";
import { PENDING_BUFFER_LIMIT, PENDING_MAX_ATTEMPTS, PENDING_RETRY_BACKOFF_MS } from "../../core/tuning.js";
import type { Log } from "./log.js";

export interface HeldMessage {
  readonly memberH: string;
  readonly text: string;
  readonly chatId: string;
  readonly messageId: string;
  readonly receivedAt: Date;
  readonly replyToMemberH: string | null;
  attempts: number;
}

export type RetryOutcome = "classified" | "model_down";
export type RetryHandler = (held: HeldMessage) => Promise<RetryOutcome>;

export function pendingBackoff(attempt: number): number {
  return PENDING_RETRY_BACKOFF_MS[Math.min(attempt, PENDING_RETRY_BACKOFF_MS.length - 1)] ?? 0;
}

export class PendingClassifications {
  readonly #sleep: Sleep;
  readonly #clock: Clock;
  readonly #retry: RetryHandler;
  readonly #log: Log;
  #held: HeldMessage[] = [];
  #runner: Promise<void> | null = null;
  #dropped = 0;

  constructor(sleep: Sleep, clock: Clock, retry: RetryHandler, log: Log) {
    this.#sleep = sleep;
    this.#clock = clock;
    this.#retry = retry;
    this.#log = log;
  }

  hold(message: Omit<HeldMessage, "attempts">): void {
    if (this.#held.length >= PENDING_BUFFER_LIMIT) {
      const oldest = this.#held.shift();
      this.#dropped += 1;
      this.#log.say("pending_dropped_full", { memberH: oldest?.memberH ?? "", messageId: oldest?.messageId ?? 0, limit: PENDING_BUFFER_LIMIT });
    }
    this.#held.push({ ...message, attempts: 0 });
    this.#log.say("pending_held", { memberH: message.memberH, messageId: message.messageId, waiting: this.#held.length });
    this.#start();
  }

  waiting(): number {
    return this.#held.length;
  }

  dropped(): number {
    return this.#dropped;
  }

  describe(): string {
    return `waiting=${this.#held.length} dropped=${this.#dropped}`;
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
    while (this.#held.length > 0) {
      const batch = [...this.#held];
      const wait = pendingBackoff(Math.min(...batch.map((held) => held.attempts)));
      await this.#sleep(wait);
      for (const held of batch) {
        held.attempts += 1;
        const outcome = await this.#retry(held);
        if (outcome === "classified") {
          this.#held = this.#held.filter((candidate) => candidate !== held);
          this.#log.say("pending_classified", { memberH: held.memberH, messageId: held.messageId, attempts: held.attempts, waitedMs: this.#clock.now().getTime() - held.receivedAt.getTime() });
          continue;
        }
        if (held.attempts >= PENDING_MAX_ATTEMPTS) {
          this.#held = this.#held.filter((candidate) => candidate !== held);
          this.#dropped += 1;
          this.#log.say("pending_dropped_unclassified", { memberH: held.memberH, messageId: held.messageId, attempts: held.attempts, stored: false });
        }
      }
    }
  }
}
