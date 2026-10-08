import type { LedgerEntry } from "../../src/core/state.js";

export const MEMBER_A = "a".repeat(24);
export const MEMBER_B = "b".repeat(24);

const DAY_ONE = "2026-10-05T09:00:00.000Z";
const DAY_TWO = "2026-10-06T09:00:00.000Z";
const DAY_THREE = "2026-10-07T09:00:00.000Z";

export const sampleLedger: readonly LedgerEntry[] = [
  { memberH: MEMBER_A, event: { type: "CONSENT_GIVEN", scope: "storage_and_dm", seq: 1, ts: DAY_ONE } },
  { memberH: null, event: { type: "THEME_CREATED", themeId: "t1", label: "login", seq: 2, ts: DAY_ONE } },
  { memberH: MEMBER_A, event: { type: "ITEM_OPENED", itemId: "i1", kind: "bug", themeId: "t1", text: "android login fails", seq: 3, ts: DAY_ONE } },
  { memberH: null, event: { type: "ITEM_OPENED", itemId: "i1", kind: "bug", themeId: "t1", text: "android login fails", seq: 3, ts: DAY_ONE } },
  { memberH: MEMBER_A, event: { type: "QUESTION_ASKED", themeId: "t1", seq: 4, ts: DAY_TWO } },
  { memberH: null, event: { type: "ITEM_STATUS", itemId: "i1", status: "acknowledged", seq: 5, ts: DAY_TWO } },
  { memberH: MEMBER_A, event: { type: "PROMISE_MADE", promiseId: "p1", memberH: MEMBER_A, itemId: "i1", due: "2026-10-09", text: "we will check by thursday", byManagerId: "4242", seq: 6, ts: DAY_TWO } },
  { memberH: null, event: { type: "ITEM_STATUS", itemId: "i1", status: "fixed", seq: 7, ts: DAY_THREE } },
  { memberH: MEMBER_A, event: { type: "CONTRIBUTION", kind: "helped", toMemberH: MEMBER_B, seq: 8, ts: DAY_THREE } },
  { memberH: MEMBER_A, event: { type: "PROMISE_FULFILLED", promiseId: "p1", seq: 9, ts: DAY_THREE } },
  { memberH: MEMBER_A, event: { type: "PROFILE_FACT", field: "role", value: "designer", seq: 10, ts: DAY_THREE } },
  { memberH: MEMBER_A, event: { type: "CORRECTION", targetSeq: 10, field: "role", value: "developer", seq: 11, ts: DAY_THREE } },
  { memberH: null, event: { type: "MANAGER_NOTE", memberH: MEMBER_A, text: "keen reporter", seq: 12, ts: DAY_THREE } },
];

export const MANAGER_ID = 4242;

export const ambassadorLedger: readonly LedgerEntry[] = [
  ...sampleLedger,
  { memberH: MEMBER_A, event: { type: "TIER_SET", memberH: MEMBER_A, tier: "ambassador", byManagerId: String(MANAGER_ID), seq: 13, ts: "2026-10-07T10:00:00.000Z" } },
];

export const revokedLedger: readonly LedgerEntry[] = [
  ...ambassadorLedger,
  { memberH: MEMBER_A, event: { type: "TIER_REVOKED", memberH: MEMBER_A, byManagerId: String(MANAGER_ID), seq: 14, ts: "2026-10-07T11:00:00.000Z" } },
];

export const COMMUNITY_KEY = "c1";

export function namespaceOf(entry: LedgerEntry): string {
  if (entry.event.type === "MANAGER_NOTE") return `sd-${COMMUNITY_KEY}-notes`;
  if (entry.memberH !== null) return `sd-${COMMUNITY_KEY}-m-${entry.memberH}`;
  if (entry.event.type === "THEME_CREATED") return `sd-${COMMUNITY_KEY}-themes`;
  return `sd-${COMMUNITY_KEY}-items`;
}

export function onAccountA(entries: readonly LedgerEntry[]): readonly LedgerEntry[] {
  return entries.filter((entry) => entry.event.type !== "MANAGER_NOTE");
}
