import type { LedgerEvent } from "./events.js";
import { FIRST_TIER } from "./tier.js";
import type { AnswerSource, AnswerState, ItemKind, ItemStatus, MemberTier, ProfileField, PromiseState } from "./vocabulary.js";

export interface LedgerEntry {
  readonly event: LedgerEvent;
  readonly memberH: string | null;
}

export interface MemberFacts {
  readonly memberH: string;
  consented: boolean;
  dmConsent: boolean;
  tier: MemberTier;
  grantedTier: MemberTier | null;
  readonly profile: Map<ProfileField, string>;
  readonly activeDays: Set<string>;
  points: number;
  dmUserId: number | null;
  readonly itemIds: string[];
  readonly helperPairDayCounts: Map<string, number>;
  lastSeq: number;
}

export interface ItemFacts {
  readonly itemId: string;
  readonly kind: ItemKind;
  themeId: string;
  text: string;
  status: ItemStatus;
  openedByH: string | null;
  readonly openedSeq: number;
  readonly openedTs: string;
  statusSeq: number;
  statusTs: string;
  affected: number;
  readonly affectedBy: string[];
}

export interface PromiseRecord {
  readonly promiseId: string;
  readonly memberH: string;
  readonly itemId: string | null;
  readonly due: string;
  readonly text: string;
  readonly byManagerId: number;
  state: PromiseState;
  readonly madeSeq: number;
  readonly madeTs: string;
  fulfilledTs: string | null;
}

export interface AnswerRecord {
  readonly answerId: string;
  readonly questionText: string | null;
  readonly answerText: string;
  readonly answeredBy: AnswerSource;
  readonly themeId: string;
  readonly seq: number;
  readonly ts: string;
  state: AnswerState;
  retiredTs: string | null;
}

export interface ThemeFacts {
  readonly themeId: string;
  label: string;
  questionCount: number;
  readonly itemIds: string[];
  readonly createdTs: string;
}

export interface NoteRecord {
  readonly seq: number;
  readonly ts: string;
  readonly memberH: string | null;
  readonly text: string;
}

export interface CommunityState {
  readonly members: Map<string, MemberFacts>;
  readonly items: Map<string, ItemFacts>;
  readonly promises: Map<string, PromiseRecord>;
  readonly themes: Map<string, ThemeFacts>;
  readonly answers: Map<string, AnswerRecord>;
  readonly notes: NoteRecord[];
  maxSeq: number;
  rejectedEvents: number;
}

export function emptyState(): CommunityState {
  return { members: new Map(), items: new Map(), promises: new Map(), themes: new Map(), answers: new Map(), notes: [], maxSeq: 0, rejectedEvents: 0 };
}

export function emptyMember(memberH: string): MemberFacts {
  return {
    memberH,
    consented: false,
    dmConsent: false,
    tier: FIRST_TIER,
    grantedTier: null,
    profile: new Map(),
    activeDays: new Set(),
    points: 0,
    dmUserId: null,
    itemIds: [],
    helperPairDayCounts: new Map(),
    lastSeq: 0,
  };
}

export function memberIn(state: CommunityState, memberH: string): MemberFacts {
  const existing = state.members.get(memberH);
  if (existing !== undefined) return existing;
  const created = emptyMember(memberH);
  state.members.set(memberH, created);
  return created;
}
