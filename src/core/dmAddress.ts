import type { EventDraft } from "./events.js";
import type { Platform } from "../platform/platform.js";

export interface DmAddress {
  readonly platform: Platform;
  readonly address: string;
}

export function dmAddressDraft(platform: Platform, userId: string): EventDraft {
  if (platform === "telegram") return { type: "DM_ADDRESS", telegramUserId: Number(userId) };
  return { type: "DM_HANDLE", platform, address: userId };
}
