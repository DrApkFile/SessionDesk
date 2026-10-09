import { onlyMatch } from "./onlyMatch.js";
import { agreeOnKeyTerms, agreeOnReportTerms, type TermAgreement } from "./keyTerms.js";
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
  | { readonly kind: "unclear"; readonly match: AnswerMatch; readonly agreement: TermAgreement }
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
  if (current === "retired") return refuse("INVALID_TRANSITION", "that answer is already retired");
  return ok("retired");
}

export function confirmAnswer(current: AnswerState): Result<AnswerState> {
  if (current === "active") return refuse("INVALID_TRANSITION", "that answer is already confirmed");
  if (current === "retired") return refuse("INVALID_TRANSITION", "that answer was retired, so it cannot be confirmed");
  return ok("active");
}

function withinThreshold(hits: readonly SearchHit[], maxDistance: number): readonly SearchHit[] {
  return hits.filter((hit) => hit.distance <= maxDistance);
}

export function lookUpAnswer(
  state: CommunityState,
  hits: readonly SearchHit[],
  idOf: (text: string) => string | null,
  question: string,
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
  if (matched.kind === "none") return { kind: "none", candidates: 0 };
  if (matched.kind === "many") return { kind: "conflicting", matches: unique };
  const agreement = agreeOnKeyTerms(question, matched.value.answer.questionText, matched.value.answer.answerText);
  if (!agreement.agree) return { kind: "unclear", match: matched.value, agreement };
  return { kind: "one", match: matched.value };
}

export function matchAnswer(
  state: CommunityState,
  hits: readonly SearchHit[],
  idOf: (text: string) => string | null,
  question: string,
  maxDistance: number = ANSWER_MAX_DISTANCE,
): AnswerMatch | null {
  const looked = lookUpAnswer(state, hits, idOf, question, maxDistance);
  return looked.kind === "one" ? looked.match : null;
}

export type KnownIssueLookup =
  | { readonly kind: "one"; readonly match: KnownIssueMatch; readonly agreement: TermAgreement }
  | { readonly kind: "none" }
  | { readonly kind: "terms_differ"; readonly match: KnownIssueMatch; readonly agreement: TermAgreement };

export function lookUpKnownIssue(
  state: CommunityState,
  hits: readonly SearchHit[],
  idOf: (text: string) => string | null,
  report: string,
  maxDistance: number = KNOWN_ISSUE_MAX_DISTANCE,
): KnownIssueLookup {
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
  if (matched.kind !== "one") return { kind: "none" };
  const agreement = agreeOnReportTerms(report, matched.value.item.text);
  if (!agreement.agree) return { kind: "terms_differ", match: matched.value, agreement };
  return { kind: "one", match: matched.value, agreement };
}

export function matchKnownIssue(
  state: CommunityState,
  hits: readonly SearchHit[],
  idOf: (text: string) => string | null,
  report: string,
  maxDistance: number = KNOWN_ISSUE_MAX_DISTANCE,
): KnownIssueMatch | null {
  const looked = lookUpKnownIssue(state, hits, idOf, report, maxDistance);
  return looked.kind === "one" ? looked.match : null;
}
