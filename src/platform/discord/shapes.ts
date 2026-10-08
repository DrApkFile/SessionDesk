import type { ChatKind } from "../platform.js";

export const DISCORD_MESSAGE_CONTENT_INTENT = 1 << 15;

export interface DiscordChatShape {
  readonly isDirect: boolean;
  readonly channelId: string;
  readonly communityChannelId: string;
}

export function chatKindOfDiscord(shape: DiscordChatShape): ChatKind {
  if (shape.isDirect) return "direct";
  return shape.channelId === shape.communityChannelId ? "community" : "other";
}

export function mentionsDiscordBot(text: string, botUserId: string, mentionedUserIds: readonly string[], repliedToBot: boolean): boolean {
  if (repliedToBot) return true;
  if (mentionedUserIds.includes(botUserId)) return true;
  return text.includes(`<@${botUserId}>`) || text.includes(`<@!${botUserId}>`);
}

export function strippedDiscordText(text: string, botUserId: string): string {
  return text.replace(new RegExp(`<@!?${botUserId}>`, "g"), "").replace(/\s+/g, " ").trim();
}

export function hasMessageContentIntent(intents: number): boolean {
  return (intents & DISCORD_MESSAGE_CONTENT_INTENT) !== 0;
}

export const MESSAGE_CONTENT_FIX = [
  "The Message Content intent is off for this Discord application, so the bot cannot read what members write.",
  "Open the Discord Developer Portal, pick this application, open Bot, and turn on Message Content Intent under Privileged Gateway Intents.",
].join(" ");
