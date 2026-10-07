import { decode } from "../../core/codec.js";
import { matchAnswer, matchKnownIssue, type AnswerMatch, type KnownIssueMatch, type SearchHit } from "../../core/answers.js";
import { resolveNamespace } from "../../core/namespace.js";
import {
  ANSWER_MAX_DISTANCE,
  ANSWER_SEARCH_LIMIT,
  KNOWN_ISSUE_MAX_DISTANCE,
  KNOWN_ISSUE_SEARCH_LIMIT,
} from "../../core/tuning.js";
import type { CommunityState } from "../../core/state.js";
import type { MemoryPort } from "../../memory/port.js";
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

export async function findEarlierAnswer(memory: MemoryPort, communityKey: string, state: CommunityState, question: string): Promise<AnswerMatch | null> {
  const namespace = resolveNamespace(communityKey, { kind: "answers" });
  const hits = await hitsFor(memory, namespace, question, ANSWER_SEARCH_LIMIT, ANSWER_MAX_DISTANCE);
  return matchAnswer(state, hits, answerIdIn);
}

export async function findKnownIssue(memory: MemoryPort, communityKey: string, state: CommunityState, report: string): Promise<KnownIssueMatch | null> {
  const namespace = resolveNamespace(communityKey, { kind: "items" });
  const hits = await hitsFor(memory, namespace, report, KNOWN_ISSUE_SEARCH_LIMIT, KNOWN_ISSUE_MAX_DISTANCE);
  return matchKnownIssue(state, hits, itemIdIn);
}

export function earlierAnswerReply(match: AnswerMatch): string {
  const who = match.answer.answeredBy === "manager" ? "a manager" : "a member";
  return [
    `This came up before. ${who} answered it on ${match.answer.ts.slice(0, 10)}:`,
    "",
    match.answer.answerText,
    "",
    `Receipt: ${blobLink(match.blobId)}`,
    "Did this help? If not, say so and I will file it as a new question.",
  ].join("\n");
}

export function knownIssueReply(match: KnownIssueMatch, affectedNow: number): string {
  return [
    `This is already known: ${match.item.itemId} is on record as ${match.item.status} since ${match.item.statusTs.slice(0, 10)}.`,
    `What was filed: ${match.item.text}`,
    `I have counted you as affected (${affectedNow} now), rather than opening a second item for the same thing.`,
    `Receipt for the original report: ${blobLink(match.blobId)}`,
  ].join("\n");
}
