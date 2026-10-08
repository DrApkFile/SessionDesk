import type { ChatKind } from "./platform.js";

export function chatKindOfTelegram(rawChatType: string): ChatKind {
  if (rawChatType === "private") return "direct";
  if (rawChatType === "group" || rawChatType === "supergroup") return "community";
  return "other";
}
