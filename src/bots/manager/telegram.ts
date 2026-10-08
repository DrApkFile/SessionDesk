import { Bot, type Context } from "grammy";
import type { Log } from "../shared/log.js";
import type { BotAction, IncomingMessage } from "../shared/incoming.js";
import { chatKindOfTelegram } from "../../platform/telegramShapes.js";
import type { ManagerService } from "./service.js";

export function toManagerIncoming(context: Context): IncomingMessage | null {
  const message = context.message;
  const from = message?.from;
  const chat = message?.chat;
  if (message === undefined || from === undefined || chat === undefined) return null;
  const text = message.text ?? message.caption ?? "";
  if (text.length === 0) return null;
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
    mentionsBot: true,
    replyToUserId: replyTo?.from?.id === undefined ? null : String(replyTo.from.id),
    replyToIsBot: replyTo?.from?.is_bot ?? false,
    replyToText: replyTo?.text ?? replyTo?.caption ?? null,
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
