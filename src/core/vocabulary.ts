export const EVENT_TYPES = [
  "CONSENT_GIVEN",
  "PROFILE_FACT",
  "QUESTION_ASKED",
  "ITEM_OPENED",
  "ITEM_STATUS",
  "PROMISE_MADE",
  "PROMISE_FULFILLED",
  "CONTRIBUTION",
  "CORRECTION",
  "THEME_CREATED",
  "MANAGER_NOTE",
  "TIER_SET",
  "TIER_REVOKED",
] as const;
export type EventType = (typeof EVENT_TYPES)[number];

export const ITEM_STATUSES = ["reported", "acknowledged", "fixed", "verified", "duplicate", "wont_fix"] as const;
export type ItemStatus = (typeof ITEM_STATUSES)[number];

export const ITEM_KINDS = ["bug", "feature", "feedback"] as const;
export type ItemKind = (typeof ITEM_KINDS)[number];

export const PROFILE_FIELDS = ["interest", "skill", "language", "role"] as const;
export type ProfileField = (typeof PROFILE_FIELDS)[number];

export const CONTRIBUTION_KINDS = ["helped", "valid_report"] as const;
export type ContributionKind = (typeof CONTRIBUTION_KINDS)[number];

export const MEMBER_TIERS = ["new", "regular", "contributor", "ambassador"] as const;
export type MemberTier = (typeof MEMBER_TIERS)[number];

export const GRANTABLE_TIERS = ["ambassador"] as const;
export type GrantableTier = (typeof GRANTABLE_TIERS)[number];

export const PROMISE_STATES = ["open", "fulfilled"] as const;
export type PromiseState = (typeof PROMISE_STATES)[number];

export const MESSAGE_KINDS = ["question", "bug", "feature", "feedback", "thanks", "profile", "chit_chat", "other"] as const;
export type MessageKind = (typeof MESSAGE_KINDS)[number];

export function isProfileField(candidate: string): candidate is ProfileField {
  return (PROFILE_FIELDS as readonly string[]).includes(candidate);
}
