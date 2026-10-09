import { isDirect, type ButtonChoice, type ChatKind, type PlatformAction, type PlatformMessage } from "../../platform/platform.js";

export type IncomingMessage = PlatformMessage;
export type BotAction = PlatformAction;
export type MemberAction = PlatformAction;
export type { ChatKind };

export function silent(reason: string): BotAction {
  return { kind: "silent", reason };
}

export function reply(text: string, offerConsent = false): BotAction {
  return { kind: "reply", text, offerConsent };
}

export function replyWithChoices(text: string, choices: readonly ButtonChoice[]): BotAction {
  return choices.length === 0 ? { kind: "reply", text, offerConsent: false } : { kind: "reply", text, offerConsent: false, choices };
}

export function pinnedNotice(text: string): BotAction {
  return { kind: "reply", text, offerConsent: true, pin: true };
}

export function isCommand(text: string): boolean {
  return text.trimStart().startsWith("/");
}

export function commandOf(text: string): { readonly name: string; readonly rest: string } {
  const trimmed = text.trim();
  const space = trimmed.search(/\s/);
  const head = space === -1 ? trimmed : trimmed.slice(0, space);
  const name = (head.split("@")[0] ?? head).toLowerCase();
  return { name, rest: space === -1 ? "" : trimmed.slice(space + 1).trim() };
}

export function isPrivate(message: IncomingMessage): boolean {
  return isDirect(message);
}

export function chatLabel(message: IncomingMessage): string {
  return message.chatKind === "direct" ? "dm" : message.chatId;
}
