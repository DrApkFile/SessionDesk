import { InlineKeyboard, type Bot } from "grammy";
import { buildManagerBot } from "../../bots/manager/telegram.js";
import { buildMemberBot } from "../../bots/member/telegram.js";
import type { MemberService } from "../../bots/member/service.js";
import type { ManagerService } from "../../bots/manager/service.js";
import type { Log } from "../../bots/shared/log.js";
import { PollingSupervisor, type Pollable } from "../../bots/shared/polling.js";
import type { CommunityChat, BotHandle } from "../../bots/shared/startup.js";
import type { Clock, Sleep } from "../../core/ports.js";
import type { TelegramSettings } from "../../config.js";
import type { PlatformRuntime } from "../runtime.js";

export interface TelegramStart {
  readonly settings: TelegramSettings;
  readonly member: MemberService;
  readonly manager: ManagerService;
  readonly chat: CommunityChat;
  readonly self: BotHandle;
  readonly log: Log;
  readonly sleep: Sleep;
  readonly clock: Clock;
}

function pollable(name: string, bot: Bot, log: Log): Pollable {
  return {
    name,
    start: (onPolling) =>
      bot.start({
        onStart: (me) => {
          log.say("polling", { bot: name, username: me.username });
          onPolling();
        },
      }),
    stop: () => bot.stop(),
  };
}

export async function startTelegram(start: TelegramStart): Promise<PlatformRuntime> {
  const memberBot = await buildMemberBot(start.settings.memberBotToken, start.member, start.log.child("member"), start.chat, start.self);
  const managerBot = await buildManagerBot(start.settings.managerBotToken, start.manager, start.log.child("manager"));

  const group = await memberBot.bot.api.getChat(start.settings.communityChatId).catch((error: unknown) => {
    start.log.say("group_unreachable", {
      configured: start.settings.communityChatId,
      detail: String(error instanceof Error ? error.message : error).slice(0, 200),
      action: "add the member bot to the group, then check COMMUNITY_CHAT_ID",
    });
    return null;
  });
  if (group === null) throw new Error("the member bot cannot see COMMUNITY_CHAT_ID");
  start.log.say("group", {
    configured: start.settings.communityChatId,
    seen: group.id,
    type: group.type,
    title: ("title" in group ? group.title : null) ?? "—",
  });
  if (String(group.id) !== String(start.settings.communityChatId)) {
    throw new Error(`COMMUNITY_CHAT_ID is ${start.settings.communityChatId} but the bot sees ${group.id}; set it and restart`);
  }

  const supervisors = [
    new PollingSupervisor(pollable("member", memberBot.bot, start.log), start.sleep, start.clock, start.log.child("member")),
    new PollingSupervisor(pollable("manager", managerBot.bot, start.log), start.sleep, start.clock, start.log.child("manager")),
  ];

  return {
    platform: "telegram",
    supervisors,
    toManager: async (chatId, text, choices) => {
      const keyboard = choices === undefined || choices.length === 0 ? undefined : choices.reduce((built, choice) => built.text(choice.label, choice.callback), new InlineKeyboard());
      await managerBot.bot.api.sendMessage(chatId, text, keyboard === undefined ? undefined : { reply_markup: keyboard });
    },
    toMember: async (chatId, text) => {
      await memberBot.bot.api.sendMessage(chatId, text);
    },
    detail: { memberBot: memberBot.identity.username, managerBot: managerBot.username, communityChatId: start.settings.communityChatId },
    stop: async () => {
      await memberBot.bot.stop();
      await managerBot.bot.stop();
    },
  };
}
