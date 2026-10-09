import { decode } from "../../core/codec.js";
import { lookUpAnswer, lookUpKnownIssue, type AnswerLookup, type AnswerMatch, type KnownIssueLookup, type KnownIssueMatch, type SearchHit } from "../../core/answers.js";
import { resolveNamespace } from "../../core/namespace.js";
import { keyTermsIn } from "../../core/keyTerms.js";
import {
  ANSWER_MAX_DISTANCE,
  ANSWER_SEARCH_LIMIT,
  KNOWN_ISSUE_MAX_DISTANCE,
  KNOWN_ISSUE_SEARCH_LIMIT,
} from "../../core/tuning.js";
import type { CommunityState } from "../../core/state.js";
import type { MemoryPort } from "../../memory/port.js";
import { plainDay, plainStatus } from "../../core/plainWords.js";
import { blobLink } from "./notices.js";

export function answerIdIn(text: string): string | null {
  const event = decode(text);
  return event !== null && event.type === "ANSWER" ? event.answerId : null;
}

export function itemIdIn(text: string): string | null {
  const event = decode(text);
  return event !== null && event.type === "ITEM_OPENED" ? event.itemId : null;
}

async function hitsFor(memory: MemoryPort, namespace: string, query: string, limit: number, maxDistance: number): Promise<readonly SearchHit[]> {
  const found = await memory.search(namespace, query, limit, maxDistance);
  if (!found.ok) return [];
  return found.value.lines.map((line) => ({ text: line.text, blobId: line.blobId, distance: line.distance ?? maxDistance }));
}

export interface ReuseTerms {
  readonly asked: readonly string[];
  readonly stored: readonly string[];
  readonly onlyAsked: readonly string[];
  readonly onlyStored: readonly string[];
}

export interface ReuseAttempt {
  readonly lookup: AnswerLookup;
  readonly candidates: number;
  readonly topDistances: readonly number[];
  readonly terms: ReuseTerms;
}

export function termsSaid(terms: readonly string[]): string {
  return terms.length === 0 ? "none" : terms.join(" ");
}

export async function findEarlierAnswer(memory: MemoryPort, communityKey: string, state: CommunityState, question: string): Promise<ReuseAttempt> {
  const namespace = resolveNamespace(communityKey, { kind: "answers" });
  const hits = await hitsFor(memory, namespace, question, ANSWER_SEARCH_LIMIT, ANSWER_MAX_DISTANCE);
  const lookup = lookUpAnswer(state, hits, answerIdIn, question);
  const agreement = lookup.kind === "unclear" ? lookup.agreement : null;
  return {
    lookup,
    candidates: hits.length,
    topDistances: hits.slice(0, 3).map((hit) => Math.round(hit.distance * 1000) / 1000),
    terms: {
      asked: agreement === null ? keyTermsIn(question).map((key) => key.term) : agreement.asked,
      stored: agreement === null ? [] : agreement.stored,
      onlyAsked: agreement === null ? [] : agreement.onlyAsked.map((key) => key.term),
      onlyStored: agreement === null ? [] : agreement.onlyStored.map((key) => key.term),
    },
  };
}

export const CONFLICTING_ANSWERS_REPLY = "I've seen different answers to this, so I've asked the team to confirm.";

export function clarifyWhichReply(storedTerm: string, askedTerm: string): string {
  return [
    `I have an answer about ${storedTerm}. Is that what you mean, or are you asking about ${askedTerm}?`,
    "Reply yes and I will show you that answer, or no and I will answer your question as it stands.",
  ].join("\n");
}

export function conflictingAnswersReply(): string {
  return CONFLICTING_ANSWERS_REPLY;
}

export function conflictNoteForManagers(question: string, matches: readonly AnswerMatch[]): string {
  return [
    "Two answers on record match the same question closely, so I did not reuse either.",
    `A member asked: ${question}`,
    ...matches.slice(0, 2).map((match, index) => `${index + 1}. ${match.answer.answerText}`),
    "Keep the one that is right and retire the other: tap a button below, or send /confirm <answerId> or /retire <answerId> to the manager bot.",
  ].join("\n");
}

export async function findKnownIssue(memory: MemoryPort, communityKey: string, state: CommunityState, report: string): Promise<KnownIssueLookup> {
  const namespace = resolveNamespace(communityKey, { kind: "items" });
  const hits = await hitsFor(memory, namespace, report, KNOWN_ISSUE_SEARCH_LIMIT, KNOWN_ISSUE_MAX_DISTANCE);
  return lookUpKnownIssue(state, hits, itemIdIn, report);
}

export function earlierAnswerReply(match: AnswerMatch): string {
  const who = match.answer.answeredBy === "manager" ? "a manager" : "someone here";
  return [
    `This came up before. ${who} answered it on ${plainDay(match.answer.ts)}:`,
    "",
    match.answer.answerText,
    "",
    `Receipt: ${blobLink(match.blobId)}`,
    "Did this help? Reply yes or no and I will act on it.",
  ].join("\n");
}

export function knownIssueReply(match: KnownIssueMatch, affectedNow: number): string {
  const others = affectedNow === 1 ? "You are the first to say it affects you too" : `${affectedNow} others have said it affects them too`;
  return [
    `The team already knows about this: it is ${plainStatus(match.item.status)} as of ${plainDay(match.item.statusTs)}.`,
    `What was raised: ${match.item.text}`,
    `${others}, so I have added you to it rather than raising the same thing twice. Receipt: ${blobLink(match.blobId)}`,
  ].join("\n");
}
