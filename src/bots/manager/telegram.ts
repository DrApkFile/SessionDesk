import { Bot, type Context } from "grammy";
import type { Log } from "../shared/log.js";
import { CHAT_TYPES, type BotAction, type ChatType, type IncomingMessage } from "../shared/incoming.js";
import type { ManagerService } from "./service.js";

function chatTypeOf(raw: string): ChatType {
  return (CHAT_TYPES as readonly string[]).includes(raw) ? (raw as ChatType) : "channel";
}

export function toManagerIncoming(context: Context): IncomingMessage | null {
  const message = context.message;
  const from = message?.from;
  const chat = message?.chat;
  if (message === undefined || from === undefined || chat === undefined) return null;
  const text = message.text ?? message.caption ?? "";
  if (text.length === 0) return null;
  const replyTo = message.reply_to_message;
  return {
    chatId: chat.id,
    chatType: chatTypeOf(chat.type),
    messageId: message.message_id,
    userId: from.id,
    isBot: from.is_bot,
    userName: from.username ?? null,
    text,
    mentionsBot: true,
    replyToUserId: replyTo?.from?.id ?? null,
    replyToIsBot: replyTo?.from?.is_bot ?? false,
  };
}

async function send(context: Context, action: BotAction): Promise<void> {
  if (action.kind === "silent") return;
  await context.reply(action.text);
}

export interface ManagerBot {
  readonly bot: Bot;
  readonly username: string;
}

export async function buildManagerBot(token: string, service: ManagerService, log: Log): Promise<ManagerBot> {
  const bot = new Bot(token);
  const me = await bot.api.getMe();
  log.say("identity", { username: me.username, id: me.id });

  bot.on("message", async (context) => {
    const incoming = toManagerIncoming(context);
    if (incoming === null) return;
    await send(context, await service.handle(incoming));
  });

  bot.catch((error) => {
    log.say("telegram_error", { detail: String(error.message).slice(0, 200) });
  });

  return { bot, username: me.username };
}
