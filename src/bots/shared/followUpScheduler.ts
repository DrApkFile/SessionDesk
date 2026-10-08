import { duePromises, managerReminder, memberReminder, type DuePromise } from "../../core/followUps.js";
import { mayDirectMessage } from "../../core/consent.js";
import type { Clock } from "../../core/ports.js";
import { FOLLOWUP_CHECK_MINUTES } from "../../core/tuning.js";
import type { LedgerCache } from "../../memory/cache.js";
import type { MemberDirectory } from "./directory.js";
import type { Log } from "./log.js";

export interface SentReminder {
  readonly audience: "manager" | "member";
  readonly chatId: string;
  readonly promiseId: string;
}

export type ReminderSender = (chatId: string, text: string) => Promise<void>;

export interface FollowUpDeps {
  readonly cache: LedgerCache;
  readonly directory: MemberDirectory;
  readonly managerIds: readonly string[];
  readonly clock: Clock;
  readonly log: Log;
  readonly toManager: ReminderSender;
  readonly toMember: ReminderSender;
}

export class FollowUpScheduler {
  readonly #deps: FollowUpDeps;
  readonly #sent = new Set<string>();
  #timer: NodeJS.Timeout | null = null;
  #ticks = 0;

  constructor(deps: FollowUpDeps) {
    this.#deps = deps;
  }

  ticks(): number {
    return this.#ticks;
  }

  start(everyMinutes: number = FOLLOWUP_CHECK_MINUTES): void {
    if (this.#timer !== null) return;
    this.#timer = setInterval(() => void this.tick(), everyMinutes * 60 * 1000);
    this.#deps.log.say("followups_started", { everyMinutes });
  }

  stop(): void {
    if (this.#timer === null) return;
    clearInterval(this.#timer);
    this.#timer = null;
  }

  async tick(): Promise<readonly SentReminder[]> {
    this.#ticks += 1;
    const now = this.#deps.clock.now();
    const sent: SentReminder[] = [];
    for (const due of duePromises(this.#deps.cache.state(), now)) {
      if (this.#sent.has(due.reminderKey)) continue;
      this.#sent.add(due.reminderKey);
      sent.push(...(await this.#remindManagers(due)));
      const toMember = await this.#remindMember(due);
      if (toMember !== null) sent.push(toMember);
    }
    if (sent.length > 0) this.#deps.log.say("followups_sent", { reminders: sent.length, tick: this.#ticks });
    return sent;
  }

  async #remindManagers(due: DuePromise): Promise<readonly SentReminder[]> {
    const label = this.#deps.directory.label(due.promise.memberH);
    const sent: SentReminder[] = [];
    for (const managerId of this.#deps.managerIds) {
      const delivered = await this.#send(this.#deps.toManager, managerId, managerReminder(due, label), "manager", due);
      if (delivered !== null) sent.push(delivered);
    }
    return sent;
  }

  async #remindMember(due: DuePromise): Promise<SentReminder | null> {
    const member = this.#deps.cache.state().members.get(due.promise.memberH);
    if (member === undefined || !mayDirectMessage({ consented: member.consented, dmConsent: member.dmConsent })) {
      this.#deps.log.say("followup_member_skipped", { promiseId: due.promise.promiseId, reason: "no dm consent on record" });
      return null;
    }
    const fromLedger = member.dmAddress?.address ?? (member.dmUserId === null ? null : String(member.dmUserId));
    const fromDirectory = this.#deps.directory.byMemberH(due.promise.memberH)?.userId ?? null;
    const chatId = fromLedger ?? fromDirectory;
    if (chatId === null) {
      this.#deps.log.say("followup_member_skipped", { promiseId: due.promise.promiseId, reason: "no dm address on record and not seen since boot" });
      return null;
    }
    return this.#send(this.#deps.toMember, chatId, memberReminder(due), "member", due);
  }

  async #send(sender: ReminderSender, chatId: string, text: string, audience: "manager" | "member", due: DuePromise): Promise<SentReminder | null> {
    try {
      await sender(chatId, text);
      this.#deps.log.say("followup_sent", { audience, promiseId: due.promise.promiseId, overdue: due.overdue });
      return { audience, chatId, promiseId: due.promise.promiseId };
    } catch (error) {
      this.#deps.log.say("followup_failed", { audience, promiseId: due.promise.promiseId, detail: String(error instanceof Error ? error.message : error).slice(0, 160) });
      return null;
    }
  }
}
