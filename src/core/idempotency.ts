import { createHash } from "node:crypto";
import type { EventType } from "./vocabulary.js";

export interface WriteOrigin {
  readonly communityKey: string;
  readonly chatId: string | number;
  readonly messageId: string | number;
  readonly eventType: EventType;
  readonly index: number;
}

export const IDEMPOTENCY_KEY_CHARS = 32;

export function idempotencyKey(origin: WriteOrigin): string {
  return keyFromMaterial([origin.communityKey, origin.chatId, origin.messageId, origin.eventType, origin.index].join("|"));
}

export function keyFromMaterial(material: string): string {
  return createHash("sha256").update(material).digest("hex").slice(0, IDEMPOTENCY_KEY_CHARS);
}

export function consentKey(communityKey: string, memberH: string, scope: string): string {
  return keyFromMaterial(`consent|${communityKey}|${memberH}|${scope}`);
}

export function dmAddressKey(communityKey: string, memberH: string): string {
  return keyFromMaterial(`dm-address|${communityKey}|${memberH}`);
}
