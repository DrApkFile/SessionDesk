import { Bot, InlineKeyboard, type Context } from "grammy";
import type { Log } from "../shared/log.js";
import type { BotAction, IncomingMessage } from "../shared/incoming.js";
import { chatKindOfTelegram } from "../../platform/telegramShapes.js";
import { ANSWER_DECISION_PREFIX } from "../shared/answerDecisions.js";
import { sendInParts } from "../shared/sending.js";
import type { ButtonChoice } from "../../platform/platform.js";
import { strippedTelegramText } from "../../platform/telegram/mentions.js";
import type { ManagerService } from "./service.js";

export function toManagerIncoming(context: Context, botUsername = ""): IncomingMessage | null {
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
    text: botUsername.length === 0 ? text : strippedTelegramText(text, botUsername),
    mentionsBot: true,
    replyToUserId: replyTo?.from?.id === undefined ? null : String(replyTo.from.id),
    replyToIsBot: replyTo?.from?.is_bot ?? false,
    replyToText: ((): string | null => {
      const parent = replyTo?.text ?? replyTo?.caption ?? null;
      if (parent === null) return null;
      return botUsername.length === 0 ? parent : strippedTelegramText(parent, botUsername);
    })(),
  };
}

export function keyboardFor(choices: readonly ButtonChoice[]): InlineKeyboard | undefined {
  if (choices.length === 0) return undefined;
  return choices.reduce((built, choice, index) => (index % 2 === 0 && index > 0 ? built.row() : built).text(choice.label, choice.callback), new InlineKeyboard());
}

async function send(context: Context, action: BotAction, log: Log): Promise<void> {
  if (action.kind === "silent") return;
  const keyboard = keyboardFor(action.choices ?? []);
  await sendInParts(
    action.text,
    async (part, index, total) => {
      const last = index === total - 1;
      await context.reply(part, keyboard === undefined || !last ? undefined : { reply_markup: keyboard });
    },
    log,
    "manager",
  );
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
    const incoming = toManagerIncoming(context, me.username);
    if (incoming === null) return;
    await send(context, await service.handle(incoming), log);
  });

  bot.callbackQuery(new RegExp(`^${ANSWER_DECISION_PREFIX}`), async (context) => {
    const from = context.callbackQuery.from;
    const outcome = service.decisionFromTap({
      platform: "telegram",
      userId: String(from.id),
      chatId: String(context.chat?.id ?? from.id),
      chatKind: chatKindOfTelegram(context.chat?.type ?? "private"),
      messageId: String(context.callbackQuery.message?.message_id ?? 0),
      callback: context.callbackQuery.data,
    });
    if (outcome.ignored) {
      await context.answerCallbackQuery();
      return;
    }
    await context.answerCallbackQuery({ text: outcome.alert.slice(0, 190), show_alert: true });
  });

  bot.catch((error) => {
    log.say("telegram_error", { detail: String(error.message).slice(0, 200) });
  });

  return { bot, username: me.username };
}
