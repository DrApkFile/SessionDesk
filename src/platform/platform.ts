export const PLATFORMS = ["telegram", "discord", "slack"] as const;
export type Platform = (typeof PLATFORMS)[number];

export const CHAT_KINDS = ["direct", "community", "other"] as const;
export type ChatKind = (typeof CHAT_KINDS)[number];

export interface PlatformId {
  readonly platform: Platform;
  readonly id: string;
}

export interface PlatformMessage {
  readonly platform: Platform;
  readonly chatId: string;
  readonly chatKind: ChatKind;
  readonly messageId: string;
  readonly userId: string;
  readonly isBot: boolean;
  readonly userName: string | null;
  readonly text: string;
  readonly mentionsBot: boolean;
  readonly replyToUserId: string | null;
  readonly replyToIsBot: boolean;
  readonly replyToText: string | null;
}

export interface PlatformCapabilities {
  readonly canPin: boolean;
  readonly canAnswerPrivately: boolean;
  readonly directMessagesNeedOptIn: boolean;
}

export interface ButtonChoice {
  readonly label: string;
  readonly callback: string;
}

export interface LinkButton {
  readonly label: string;
  readonly url: string;
}

export type PlatformAction =
  | { readonly kind: "silent"; readonly reason: string }
  | {
      readonly kind: "reply";
      readonly text: string;
      readonly offerConsent: boolean;
      readonly pin?: boolean;
      readonly choices?: readonly ButtonChoice[];
    };

export interface ButtonTap {
  readonly platform: Platform;
  readonly userId: string;
  readonly chatId: string;
  readonly chatKind: ChatKind;
  readonly messageId: string;
  readonly callback: string;
}

export interface PlatformSender {
  readonly platform: Platform;
  capabilities(): PlatformCapabilities;
  sendDirect(userId: string, text: string): Promise<void>;
}

const TELEGRAM_ID_SHAPE = /^-?\d+$/;

export function userKey(platform: Platform, id: string): string {
  if (platform !== "telegram") return `${platform}:${id}`;
  return TELEGRAM_ID_SHAPE.test(id) ? id : `telegram:${id}`;
}

export function platformIdOf(message: PlatformMessage): PlatformId {
  return { platform: message.platform, id: message.userId };
}

export function isDirect(message: PlatformMessage): boolean {
  return message.chatKind === "direct";
}

export function isPlatform(candidate: string): candidate is Platform {
  return (PLATFORMS as readonly string[]).includes(candidate);
}
