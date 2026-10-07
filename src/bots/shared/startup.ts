import { refuse, ok, type Result } from "../../core/result.js";

export interface BotIdentity {
  readonly id: number;
  readonly username: string;
  readonly canReadAllGroupMessages: boolean;
}

export const PRIVACY_FIX = "In @BotFather run /setprivacy for this bot and choose Disable, then remove and re-add the bot to the group.";

export function requirePrivacyDisabled(identity: BotIdentity): Result<BotIdentity> {
  if (!identity.canReadAllGroupMessages) {
    return refuse("MEMORY_UNAVAILABLE", `privacy mode is on for @${identity.username}, so it cannot see group messages. ${PRIVACY_FIX}`);
  }
  return ok(identity);
}

export class CommunityChat {
  readonly #configured: number;
  #migratedTo: number | null = null;

  constructor(configured: number) {
    this.#configured = configured;
  }

  expected(): number {
    return this.#configured;
  }

  migratedTo(): number | null {
    return this.#migratedTo;
  }

  recordMigration(newChatId: number): void {
    this.#migratedTo = newChatId;
  }

  check(chatId: number): Result<number> {
    if (this.#migratedTo !== null) {
      if (chatId === this.#migratedTo) {
        return refuse("MEMORY_UNAVAILABLE", `this group migrated to ${this.#migratedTo}. Set COMMUNITY_CHAT_ID=${this.#migratedTo} and restart.`);
      }
      return refuse("MEMORY_UNAVAILABLE", `chat ${chatId} is not this community; it migrated to ${this.#migratedTo}`);
    }
    if (chatId !== this.#configured) return refuse("MEMORY_UNAVAILABLE", `chat ${chatId} is not the configured community chat ${this.#configured}`);
    return ok(chatId);
  }
}
