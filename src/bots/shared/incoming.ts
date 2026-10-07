export const CHAT_TYPES = ["private", "group", "supergroup", "channel"] as const;
export type ChatType = (typeof CHAT_TYPES)[number];

export interface IncomingMessage {
  readonly chatId: number;
  readonly chatType: ChatType;
  readonly messageId: number;
  readonly userId: number;
  readonly isBot: boolean;
  readonly userName: string | null;
  readonly text: string;
  readonly mentionsBot: boolean;
  readonly replyToUserId: number | null;
  readonly replyToIsBot: boolean;
}

export type BotAction =
  | { readonly kind: "silent"; readonly reason: string }
  | { readonly kind: "reply"; readonly text: string; readonly offerConsent: boolean };

export function silent(reason: string): BotAction {
  return { kind: "silent", reason };
}

export function reply(text: string, offerConsent = false): BotAction {
  return { kind: "reply", text, offerConsent };
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
  return message.chatType === "private";
}

export type MemberAction = BotAction;
