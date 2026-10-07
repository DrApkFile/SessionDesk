import { ITEM_KINDS, ITEM_STATUSES, PROFILE_FIELDS, type ItemKind, type ItemStatus, type ProfileField } from "./vocabulary.js";

export const PLAIN_STATUS = {
  reported: "with the team",
  acknowledged: "the team is on it",
  fixed: "fixed",
  verified: "fixed and confirmed",
  duplicate: "already known",
  wont_fix: "won't be changed",
} as const satisfies Record<ItemStatus, string>;

export const PLAIN_KIND = {
  bug: "a problem",
  feature: "an idea",
  feedback: "some feedback",
} as const satisfies Record<ItemKind, string>;

export const PLAIN_PROFILE = {
  role: "what you do",
  skill: "something you know",
  language: "a language you speak",
  interest: "something you are interested in",
} as const satisfies Record<ProfileField, string>;

export function plainStatus(status: ItemStatus): string {
  return PLAIN_STATUS[status];
}

export function plainKind(kind: ItemKind): string {
  return PLAIN_KIND[kind];
}

export function plainProfile(field: ProfileField): string {
  return PLAIN_PROFILE[field];
}

export function statusBehindPlainWords(text: string): readonly ItemStatus[] {
  const lowered = text.toLowerCase();
  return ITEM_STATUSES.filter((status) => lowered.includes(PLAIN_STATUS[status].toLowerCase()));
}

export function plainDay(iso: string): string {
  return iso.slice(0, 10);
}

export const PLAIN_VOCABULARY = { ITEM_STATUSES, ITEM_KINDS, PROFILE_FIELDS } as const;
