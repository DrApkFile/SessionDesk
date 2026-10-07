import { Bot, InlineKeyboard, type Context } from "grammy";
import type { Log } from "../shared/log.js";
import { requirePrivacyDisabled, type BotIdentity, type CommunityChat } from "../shared/startup.js";
import { CHAT_TYPES, type ChatType, type IncomingMessage, type MemberAction } from "../shared/incoming.js";
import { CONSENT_SCOPES, type ConsentScope } from "./notices.js";
import type { MemberService } from "./service.js";

export const CONSENT_PREFIX = "consent:";

export function consentKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text("I agree", `${CONSENT_PREFIX}storage`)
    .text("I agree + DMs", `${CONSENT_PREFIX}storage_and_dm`);
}

function chatTypeOf(raw: string): ChatType {
  return (CHAT_TYPES as readonly string[]).includes(raw) ? (raw as ChatType) : "channel";
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
    chatId: chat.id,
    chatType: chatTypeOf(chat.type),
    messageId: message.message_id,
    userId: from.id,
    isBot: from.is_bot,
    userName: from.username ?? null,
    text,
    mentionsBot: readMention(text, entities, identity.username) || replyTo?.from?.id === identity.id,
    replyToUserId: replyTo?.from?.id ?? null,
    replyToIsBot: replyTo?.from?.is_bot ?? false,
  };
}

async function send(context: Context, action: MemberAction): Promise<void> {
  if (action.kind === "silent") return;
  if (action.offerConsent) {
    await context.reply(action.text, { reply_markup: consentKeyboard() });
    return;
  }
  await context.reply(action.text);
}

function scopeOf(data: string): ConsentScope | null {
  const raw = data.slice(CONSENT_PREFIX.length);
  return (CONSENT_SCOPES as readonly string[]).includes(raw) ? (raw as ConsentScope) : null;
}

export interface MemberBot {
  readonly bot: Bot;
  readonly identity: BotIdentity;
}

export async function buildMemberBot(token: string, service: MemberService, log: Log, chat: CommunityChat): Promise<MemberBot> {
  const bot = new Bot(token);
  const me = await bot.api.getMe();
  const identity: BotIdentity = { id: me.id, username: me.username, canReadAllGroupMessages: me.can_read_all_group_messages };
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
    await send(context, await service.handle(incoming));
  });

  bot.callbackQuery(new RegExp(`^${CONSENT_PREFIX}`), async (context) => {
    const scope = scopeOf(context.callbackQuery.data);
    const from = context.callbackQuery.from;
    if (scope === null) {
      await context.answerCallbackQuery();
      return;
    }
    const action = service.recordConsent(from.id, context.chat?.id ?? from.id, context.callbackQuery.message?.message_id ?? 0, scope);
    await context.answerCallbackQuery();
    await send(context, action);
  });

  bot.catch((error) => {
    log.say("telegram_error", { detail: String(error.message).slice(0, 200) });
  });

  return { bot, identity };
}
