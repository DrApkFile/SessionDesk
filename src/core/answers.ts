import { onlyMatch } from "./onlyMatch.js";
import { refuse, ok, type Result } from "./result.js";
import type { AnswerRecord, CommunityState, ItemFacts } from "./state.js";
import { ANSWER_MAX_DISTANCE, KNOWN_ISSUE_MAX_DISTANCE } from "./tuning.js";
import type { AnswerState } from "./vocabulary.js";

export interface SearchHit {
  readonly text: string;
  readonly blobId: string;
  readonly distance: number;
}

export type AnswerLookup =
  | { readonly kind: "one"; readonly match: AnswerMatch }
  | { readonly kind: "none"; readonly candidates: number }
  | { readonly kind: "conflicting"; readonly matches: readonly AnswerMatch[] };

export interface AnswerMatch {
  readonly answer: AnswerRecord;
  readonly blobId: string;
  readonly distance: number;
}

export interface KnownIssueMatch {
  readonly item: ItemFacts;
  readonly blobId: string;
  readonly distance: number;
}

export const OPEN_ITEM_STATUSES = ["reported", "acknowledged"] as const;

export function retireAnswer(current: AnswerState): Result<AnswerState> {
  if (current !== "active") return refuse("INVALID_TRANSITION", `a ${current} answer cannot be retired again`);
  return ok("retired");
}

function withinThreshold(hits: readonly SearchHit[], maxDistance: number): readonly SearchHit[] {
  return hits.filter((hit) => hit.distance <= maxDistance);
}

export function lookUpAnswer(
  state: CommunityState,
  hits: readonly SearchHit[],
  idOf: (text: string) => string | null,
  maxDistance: number = ANSWER_MAX_DISTANCE,
): AnswerLookup {
  const candidates = withinThreshold(hits, maxDistance)
    .map((hit) => {
      const answerId = idOf(hit.text);
      const answer = answerId === null ? undefined : state.answers.get(answerId);
      return answer === undefined || answer.state !== "active" ? null : { answer, blobId: hit.blobId, distance: hit.distance };
    })
    .filter((candidate): candidate is AnswerMatch => candidate !== null);
  const unique = [...new Map(candidates.map((candidate) => [candidate.answer.answerId, candidate])).values()].sort((left, right) => left.distance - right.distance);
  const matched = onlyMatch(unique, () => true);
  if (matched.kind === "one") return { kind: "one", match: matched.value };
  if (matched.kind === "none") return { kind: "none", candidates: 0 };
  return { kind: "conflicting", matches: unique };
}

export function matchAnswer(
  state: CommunityState,
  hits: readonly SearchHit[],
  idOf: (text: string) => string | null,
  maxDistance: number = ANSWER_MAX_DISTANCE,
): AnswerMatch | null {
  const looked = lookUpAnswer(state, hits, idOf, maxDistance);
  return looked.kind === "one" ? looked.match : null;
}

export function matchKnownIssue(
  state: CommunityState,
  hits: readonly SearchHit[],
  idOf: (text: string) => string | null,
  maxDistance: number = KNOWN_ISSUE_MAX_DISTANCE,
): KnownIssueMatch | null {
  const open: readonly string[] = OPEN_ITEM_STATUSES;
  const candidates = withinThreshold(hits, maxDistance)
    .map((hit) => {
      const itemId = idOf(hit.text);
      const item = itemId === null ? undefined : state.items.get(itemId);
      return item === undefined || !open.includes(item.status) ? null : { item, blobId: hit.blobId, distance: hit.distance };
    })
    .filter((candidate): candidate is KnownIssueMatch => candidate !== null);
  const unique = [...new Map(candidates.map((candidate) => [candidate.item.itemId, candidate])).values()];
  const matched = onlyMatch(unique, () => true);
  return matched.kind === "one" ? matched.value : null;
}
