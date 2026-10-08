import { refuse, ok, type Result } from "../../core/result.js";

export interface BotHandle {
  username: string;
}

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

export type CommunityFromSetup = () => { readonly platform: string; readonly chatId: string } | null;

export class CommunityChat {
  readonly #configured: string | null;
  readonly #fromSetup: CommunityFromSetup;
  #migratedTo: string | null = null;

  constructor(configured: string | number | null, fromSetup: CommunityFromSetup = () => null) {
    this.#configured = configured === null ? null : String(configured);
    this.#fromSetup = fromSetup;
  }

  source(): "env" | "setup" | "unset" {
    if (this.#configured !== null) return "env";
    return this.#fromSetup() === null ? "unset" : "setup";
  }

  expected(): string | null {
    if (this.#configured !== null) return this.#configured;
    return this.#fromSetup()?.chatId ?? null;
  }

  migratedTo(): string | null {
    return this.#migratedTo;
  }

  recordMigration(newChatId: string | number): void {
    this.#migratedTo = String(newChatId);
  }

  check(rawChatId: string | number): Result<string> {
    const chatId = String(rawChatId);
    if (this.#migratedTo !== null) {
      if (chatId === this.#migratedTo) {
        return refuse("MEMORY_UNAVAILABLE", `this group migrated to ${this.#migratedTo}. Set COMMUNITY_CHAT_ID=${this.#migratedTo} and restart.`);
      }
      return refuse("MEMORY_UNAVAILABLE", `chat ${chatId} is not this community; it migrated to ${this.#migratedTo}`);
    }
    const expected = this.expected();
    if (expected === null) {
      return refuse("MEMORY_UNAVAILABLE", "no community chat is set yet: a manager should send /setup in the group");
    }
    if (chatId !== expected) return refuse("MEMORY_UNAVAILABLE", `chat ${chatId} is not the community chat ${expected}`);
    return ok(chatId);
  }
}
