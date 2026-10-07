import { createHash } from "node:crypto";
import type { EventType } from "./vocabulary.js";

export interface WriteOrigin {
  readonly communityKey: string;
  readonly chatId: number;
  readonly messageId: number;
  readonly eventType: EventType;
  readonly index: number;
}

export const IDEMPOTENCY_KEY_CHARS = 32;

export function idempotencyKey(origin: WriteOrigin): string {
  const material = [origin.communityKey, origin.chatId, origin.messageId, origin.eventType, origin.index].join("|");
  return createHash("sha256").update(material).digest("hex").slice(0, IDEMPOTENCY_KEY_CHARS);
}
