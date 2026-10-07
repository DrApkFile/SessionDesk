import type { EventDraft } from "./events.js";
import type { EventType } from "./vocabulary.js";

export const AUTHORITIES = ["write_gate", "member_command", "manager_command"] as const;
export type Authority = (typeof AUTHORITIES)[number];

export const EVENT_AUTHORITY = {
  CONSENT_GIVEN: "member_command",
  PROFILE_FACT: "write_gate",
  QUESTION_ASKED: "write_gate",
  ITEM_OPENED: "write_gate",
  ITEM_STATUS: "manager_command",
  PROMISE_MADE: "manager_command",
  PROMISE_FULFILLED: "manager_command",
  CONTRIBUTION: "write_gate",
  CORRECTION: "member_command",
  THEME_CREATED: "write_gate",
  MANAGER_NOTE: "manager_command",
  TIER_SET: "manager_command",
  TIER_REVOKED: "manager_command",
} satisfies Record<EventType, Authority>;

export type EventTypeFrom<A extends Authority> = {
  [K in EventType]: (typeof EVENT_AUTHORITY)[K] extends A ? K : never;
}[EventType];

export type DraftFrom<A extends Authority> = Extract<EventDraft, { type: EventTypeFrom<A> }>;

export function authorityOf(type: EventType): Authority {
  return EVENT_AUTHORITY[type];
}

export function eventTypesFrom<A extends Authority>(authority: A): readonly EventType[] {
  return (Object.keys(EVENT_AUTHORITY) as readonly EventType[]).filter((type) => EVENT_AUTHORITY[type] === authority);
}
