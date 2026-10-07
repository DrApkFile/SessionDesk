import { z } from "zod";
import {
  ANSWER_SOURCES,
  CONTRIBUTION_KINDS,
  EVENT_TYPES,
  GRANTABLE_TIERS,
  ITEM_KINDS,
  ITEM_STATUSES,
  PROFILE_FIELDS,
  type EventType,
} from "./vocabulary.js";
import { MAX_STORED_TEXT_CHARS, MAX_THEME_LABEL_CHARS } from "./tuning.js";

const identifier = z.string().min(1).max(64).regex(/^[A-Za-z0-9_-]+$/);
const memberHash = z.string().regex(/^[0-9a-f]{24}$/);
const storedText = z.string().min(1).max(MAX_STORED_TEXT_CHARS);
const calendarDay = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const wholeNumber = z.coerce.number().int();

export const EVENT_PAYLOADS = {
  CONSENT_GIVEN: z.object({ scope: z.enum(["storage", "storage_and_dm"]) }).strict(),
  PROFILE_FACT: z.object({ field: z.enum(PROFILE_FIELDS), value: z.string().min(1).max(120) }).strict(),
  QUESTION_ASKED: z.object({ themeId: identifier }).strict(),
  ITEM_OPENED: z.object({ itemId: identifier, kind: z.enum(ITEM_KINDS), themeId: identifier, text: storedText }).strict(),
  ITEM_STATUS: z.object({ itemId: identifier, status: z.enum(ITEM_STATUSES) }).strict(),
  PROMISE_MADE: z
    .object({
      promiseId: identifier,
      memberH: memberHash,
      itemId: identifier.optional(),
      due: calendarDay,
      text: storedText,
      byManagerId: wholeNumber.positive(),
    })
    .strict(),
  PROMISE_FULFILLED: z.object({ promiseId: identifier }).strict(),
  CONTRIBUTION: z.object({ kind: z.enum(CONTRIBUTION_KINDS), toMemberH: memberHash.optional() }).strict(),
  CORRECTION: z.object({ targetSeq: wholeNumber.nonnegative(), field: identifier, value: storedText }).strict(),
  THEME_CREATED: z.object({ themeId: identifier, label: z.string().min(1).max(MAX_THEME_LABEL_CHARS) }).strict(),
  MANAGER_NOTE: z.object({ memberH: memberHash.optional(), text: storedText }).strict(),
  TIER_SET: z.object({ memberH: memberHash, tier: z.enum(GRANTABLE_TIERS), byManagerId: wholeNumber.positive() }).strict(),
  TIER_REVOKED: z.object({ memberH: memberHash, byManagerId: wholeNumber.positive() }).strict(),
  ANSWER: z
    .object({
      answerId: identifier,
      questionText: storedText.optional(),
      answerText: storedText,
      answeredBy: z.enum(ANSWER_SOURCES),
      themeId: identifier,
    })
    .strict(),
  ANSWER_RETIRED: z.object({ answerId: identifier, byManagerId: wholeNumber.positive() }).strict(),
  ITEM_AFFECTS: z.object({ itemId: identifier, memberH: memberHash }).strict(),
  DM_ADDRESS: z.object({ telegramUserId: wholeNumber.positive() }).strict(),
  ANSWER_FEEDBACK: z.object({ answerId: identifier, helpful: z.enum(["true", "false"]).transform((raw) => raw === "true") }).strict(),
} satisfies Record<EventType, z.ZodObject>;

export type PayloadOf<K extends EventType> = z.infer<(typeof EVENT_PAYLOADS)[K]>;

export type DraftOf<K extends EventType> = { readonly type: K } & PayloadOf<K>;
export type EventDraft = { [K in EventType]: DraftOf<K> }[EventType];

export type EventOf<K extends EventType> = { readonly seq: number; readonly ts: string } & DraftOf<K>;
export type LedgerEvent = { [K in EventType]: EventOf<K> }[EventType];

export function payloadKeys(type: EventType): readonly string[] {
  return Object.keys(EVENT_PAYLOADS[type].shape);
}

export function isEventType(candidate: string): candidate is EventType {
  return (EVENT_TYPES as readonly string[]).includes(candidate);
}

export function stamp(draft: EventDraft, seq: number, ts: string): LedgerEvent {
  return { ...draft, seq, ts } as LedgerEvent;
}
