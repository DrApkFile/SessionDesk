import type { ChatKind } from "../platform.js";

export const SLACK_REQUIRED_SCOPES = ["app_mentions:read", "channels:history", "chat:write", "im:history", "im:write", "pins:write", "users:read"] as const;

export interface SlackChatShape {
  readonly channelType: string;
  readonly channelId: string;
  readonly communityChannelId: string;
}

export function chatKindOfSlack(shape: SlackChatShape): ChatKind {
  if (shape.channelType === "im" || shape.channelType === "mpim") return "direct";
  return shape.channelId === shape.communityChannelId ? "community" : "other";
}

export function mentionsSlackBot(text: string, botUserId: string, isDirect: boolean): boolean {
  return isDirect || text.includes(`<@${botUserId}>`);
}

export function strippedSlackText(text: string, botUserId: string): string {
  return text.replace(new RegExp(`<@${botUserId}>`, "g"), "").replace(/\s+/g, " ").trim();
}

export function missingScopes(granted: readonly string[]): readonly string[] {
  return SLACK_REQUIRED_SCOPES.filter((scope) => !granted.includes(scope));
}

export function scopeFix(missing: readonly string[]): string {
  return [
    `This Slack app is missing ${missing.length} scope(s): ${missing.join(", ")}.`,
    "Open api.slack.com/apps, pick this app, open OAuth & Permissions, add them under Bot Token Scopes, then reinstall the app to the workspace.",
  ].join(" ");
}
