import { App } from "@slack/bolt";
import type { SlackSettings } from "../../config.js";
import type { ManagerService } from "../../bots/manager/service.js";
import type { MemberService } from "../../bots/member/service.js";
import { CONSENT_PREFIX } from "../../bots/member/telegram.js";
import { CONSENT_SCOPES, dmStartLink, type ConsentScope } from "../../bots/member/notices.js";
import type { BotAction, IncomingMessage } from "../../bots/shared/incoming.js";
import type { Log } from "../../bots/shared/log.js";
import { PollingSupervisor, type Pollable } from "../../bots/shared/polling.js";
import type { Clock, Sleep } from "../../core/ports.js";
import type { PlatformRuntime } from "../runtime.js";
import { chatKindOfSlack, mentionsSlackBot, strippedSlackText } from "./shapes.js";

export interface SlackStart {
  readonly settings: SlackSettings;
  readonly member: MemberService;
  readonly manager: ManagerService;
  readonly log: Log;
  readonly sleep: Sleep;
  readonly clock: Clock;
}

export interface SlackRawMessage {
  readonly channel: string;
  readonly channel_type?: string;
  readonly ts: string;
  readonly user?: string;
  readonly text?: string;
  readonly bot_id?: string;
  readonly thread_ts?: string;
}

export function consentBlocks(text: string, botUsername: string): readonly unknown[] {
  return [
    { type: "section", text: { type: "mrkdwn", text } },
    {
      type: "actions",
      elements: [
        { type: "button", text: { type: "plain_text", text: "I agree" }, action_id: `${CONSENT_PREFIX}storage`, value: "storage", style: "primary" },
        { type: "button", text: { type: "plain_text", text: "I agree + DMs" }, action_id: `${CONSENT_PREFIX}storage_and_dm`, value: "storage_and_dm" },
        { type: "button", text: { type: "plain_text", text: "Open DMs with me" }, url: dmStartLink(botUsername), action_id: "open_dms" },
      ],
    },
  ];
}

export interface SlackParentMessage {
  readonly user?: string | undefined;
  readonly text?: string | undefined;
  readonly bot_id?: string | undefined;
}

export function toSlackIncoming(
  raw: SlackRawMessage,
  botUserId: string,
  communityChannelId: string,
  parent: SlackParentMessage | null = null,
): IncomingMessage | null {
  const text = raw.text ?? "";
  const userId = raw.user;
  if (text.length === 0 || userId === undefined) return null;
  const kind = chatKindOfSlack({ channelType: raw.channel_type ?? "channel", channelId: raw.channel, communityChannelId });
  return {
    platform: "slack",
    chatId: raw.channel,
    chatKind: kind,
    messageId: raw.ts,
    userId,
    isBot: raw.bot_id !== undefined,
    userName: null,
    text: strippedSlackText(text, botUserId),
    mentionsBot: mentionsSlackBot(text, botUserId, kind === "direct") || parent?.user === botUserId,
    replyToUserId: parent?.user ?? null,
    replyToIsBot: parent?.bot_id !== undefined || parent?.user === botUserId,
    replyToText: parent?.text === undefined ? null : strippedSlackText(parent.text, botUserId),
  };
}

export function isThreadReply(raw: SlackRawMessage): boolean {
  return raw.thread_ts !== undefined && raw.thread_ts !== raw.ts;
}

export function scopeOfAction(actionId: string): ConsentScope | null {
  const raw = actionId.slice(CONSENT_PREFIX.length);
  return (CONSENT_SCOPES as readonly string[]).includes(raw) ? (raw as ConsentScope) : null;
}

export async function startSlack(start: SlackStart): Promise<PlatformRuntime> {
  const app = new App({ token: start.settings.botToken, appToken: start.settings.appToken, socketMode: true });
  const log = start.log;
  let botUserId = "";
  let botUsername = "sessiondesk";

  const deliver = async (channel: string, action: BotAction): Promise<void> => {
    if (action.kind === "silent") return;
    const posted = await app.client.chat.postMessage(
      action.offerConsent
        ? { channel, text: action.text, blocks: consentBlocks(action.text, botUsername) as never }
        : { channel, text: action.text },
    );
    if (action.pin !== true || typeof posted.ts !== "string") return;
    try {
      await app.client.pins.add({ channel, timestamp: posted.ts });
      log.say("optin_pinned", { channel });
    } catch (error) {
      log.say("optin_pin_failed", { channel, detail: String(error instanceof Error ? error.message : error).slice(0, 160) });
    }
  };

  app.message(async ({ message }) => {
    const raw = message as SlackRawMessage;
    let parent: SlackParentMessage | null = null;
    if (isThreadReply(raw) && raw.thread_ts !== undefined) {
      try {
        const thread = await app.client.conversations.replies({ channel: raw.channel, ts: raw.thread_ts, limit: 1, inclusive: true });
        const first = thread.messages?.[0];
        if (first !== undefined) parent = { user: first.user, text: first.text, bot_id: first.bot_id };
      } catch (error) {
        log.say("thread_parent_unreadable", { channel: raw.channel, detail: String(error instanceof Error ? error.message : error).slice(0, 160) });
      }
    }
    const incoming = toSlackIncoming(raw, botUserId, start.settings.channelId, parent);
    if (incoming === null) return;
    const action = await start.member.handle(incoming);
    await deliver(incoming.chatId, action);
  });

  app.action(new RegExp(`^${CONSENT_PREFIX}`), async ({ ack, body, respond }) => {
    await ack();
    const actionId = "actions" in body && Array.isArray(body.actions) ? String((body.actions[0] as { action_id?: string }).action_id ?? "") : "";
    const scope = scopeOfAction(actionId);
    if (scope === null) return;
    const channelId = "channel" in body && body.channel !== undefined ? String((body.channel as { id?: string }).id ?? "") : "";
    const outcome = start.member.consentFromTap({
      platform: "slack",
      userId: body.user.id,
      chatId: channelId,
      chatKind: chatKindOfSlack({ channelType: "channel", channelId, communityChannelId: start.settings.channelId }),
      messageId: "message" in body && body.message !== undefined ? String((body.message as { ts?: string }).ts ?? "") : "",
      scope,
    });
    if (outcome.ignored) {
      await respond({ text: "I only take that button in this community's channel.", response_type: "ephemeral" });
      return;
    }
    await respond({ text: outcome.alert, response_type: "ephemeral" });
  });

  const pollable: Pollable = {
    name: "slack",
    start: async (onPolling) => {
      await app.start();
      const self = await app.client.auth.test({ token: start.settings.botToken });
      botUserId = typeof self.user_id === "string" ? self.user_id : "";
      botUsername = typeof self.user === "string" ? self.user : botUsername;
      log.say("identity", { platform: "slack", user: botUsername, team: typeof self.team === "string" ? self.team : "—" });
      onPolling();
      await new Promise<void>(() => {});
    },
    stop: async () => {
      await app.stop();
    },
  };

  return {
    platform: "slack",
    supervisors: [new PollingSupervisor(pollable, start.sleep, start.clock, log)],
    toManager: async (userId, text) => {
      await app.client.chat.postMessage({ channel: userId, text });
    },
    toMember: async (userId, text) => {
      await app.client.chat.postMessage({ channel: userId, text });
    },
    detail: { channelId: start.settings.channelId, managers: start.settings.managerIds.length },
    stop: async () => {
      await app.stop();
    },
  };
}
