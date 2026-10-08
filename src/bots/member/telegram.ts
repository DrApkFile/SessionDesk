import { Bot, InlineKeyboard, type Context } from "grammy";
import type { Log } from "../shared/log.js";
import { requirePrivacyDisabled, type BotHandle, type BotIdentity, type CommunityChat } from "../shared/startup.js";
import type { IncomingMessage, MemberAction } from "../shared/incoming.js";
import { chatKindOfTelegram } from "../../platform/telegramShapes.js";
import { CONSENT_SCOPES, dmStartLink, type ConsentScope } from "./notices.js";
import type { MemberService } from "./service.js";

export const CONSENT_PREFIX = "consent:";

export function consentKeyboard(botUsername: string): InlineKeyboard {
  return new InlineKeyboard()
    .text("I agree", `${CONSENT_PREFIX}storage`)
    .text("I agree + DMs", `${CONSENT_PREFIX}storage_and_dm`)
    .row()
    .url("Open DMs with me", dmStartLink(botUsername));
}

export function readMention(text: string, entities: ReadonlyArray<{ type: string; offset: number; length: number }>, username: string): boolean {
  const handle = `@${username.toLowerCase()}`;
  return entities.some(
    (entity) => (entity.type === "mention" || entity.type === "bot_command") && text.slice(entity.offset, entity.offset + entity.length).toLowerCase().includes(handle),
  );
}

export function toIncoming(context: Context, identity: BotIdentity): IncomingMessage | null {
  const message = context.message;
  const from = message?.from;
  const chat = message?.chat;
  if (message === undefined || from === undefined || chat === undefined) return null;
  const text = message.text ?? message.caption ?? "";
  if (text.length === 0) return null;
  const entities = message.entities ?? message.caption_entities ?? [];
  const replyTo = message.reply_to_message;
  return {
    platform: "telegram",
    chatId: String(chat.id),
    chatKind: chatKindOfTelegram(chat.type),
    messageId: String(message.message_id),
    userId: String(from.id),
    isBot: from.is_bot,
    userName: from.username ?? null,
    text,
    mentionsBot: readMention(text, entities, identity.username) || replyTo?.from?.id === identity.id,
    replyToUserId: replyTo?.from?.id === undefined ? null : String(replyTo.from.id),
    replyToIsBot: replyTo?.from?.is_bot ?? false,
    replyToText: replyTo?.text ?? replyTo?.caption ?? null,
  };
}

async function send(context: Context, action: MemberAction, self: BotHandle, log: Log): Promise<void> {
  if (action.kind === "silent") return;
  const sent = action.offerConsent
    ? await context.reply(action.text, { reply_markup: consentKeyboard(self.username) })
    : await context.reply(action.text);
  if (action.pin !== true) return;
  try {
    await context.api.pinChatMessage(sent.chat.id, sent.message_id, { disable_notification: true });
    log.say("optin_pinned", { chat: String(sent.chat.id) });
  } catch (error) {
    log.say("optin_pin_failed", { chat: String(sent.chat.id), detail: String(error instanceof Error ? error.message : error).slice(0, 160) });
  }
}

function scopeOf(data: string): ConsentScope | null {
  const raw = data.slice(CONSENT_PREFIX.length);
  return (CONSENT_SCOPES as readonly string[]).includes(raw) ? (raw as ConsentScope) : null;
}

export interface MemberBot {
  readonly bot: Bot;
  readonly identity: BotIdentity;
}

export async function buildMemberBot(token: string, service: MemberService, log: Log, chat: CommunityChat, self: BotHandle): Promise<MemberBot> {
  const bot = new Bot(token);
  const me = await bot.api.getMe();
  const identity: BotIdentity = { id: me.id, username: me.username, canReadAllGroupMessages: me.can_read_all_group_messages };
  self.username = me.username;
  log.say("identity", { username: identity.username, id: identity.id, canReadAllGroupMessages: identity.canReadAllGroupMessages });

  const privacy = requirePrivacyDisabled(identity);
  if (!privacy.ok) throw new Error(privacy.detail ?? privacy.code);

  bot.on("message:migrate_to_chat_id", async (context) => {
    const newChatId = context.message.migrate_to_chat_id;
    chat.recordMigration(newChatId);
    log.say("chat_migrated", { from: context.chat.id, to: newChatId, action: "set COMMUNITY_CHAT_ID and restart" });
  });

  bot.on("message", async (context) => {
    const incoming = toIncoming(context, identity);
    if (incoming === null) return;
    await send(context, await service.handle(incoming), self, log);
  });

  bot.callbackQuery(new RegExp(`^${CONSENT_PREFIX}`), async (context) => {
    const scope = scopeOf(context.callbackQuery.data);
    const from = context.callbackQuery.from;
    if (scope === null) {
      await context.answerCallbackQuery();
      return;
    }
    const outcome = service.consentFromTap({
      platform: "telegram",
      userId: String(from.id),
      chatId: String(context.chat?.id ?? from.id),
      chatKind: chatKindOfTelegram(context.chat?.type ?? "private"),
      messageId: String(context.callbackQuery.message?.message_id ?? 0),
      scope,
    });
    if (outcome.ignored) {
      await context.answerCallbackQuery();
      return;
    }
    await context.answerCallbackQuery({ text: outcome.alert, show_alert: true });
  });

  bot.catch((error) => {
    log.say("telegram_error", { detail: String(error.message).slice(0, 200) });
  });

  return { bot, identity };
}
