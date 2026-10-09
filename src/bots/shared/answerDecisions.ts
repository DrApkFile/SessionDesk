import type { ButtonChoice } from "../../platform/platform.js";

export const ANSWER_DECISION_PREFIX = "answer:";
export const ANSWER_DECISIONS = ["keep", "retire"] as const;
export type AnswerDecision = (typeof ANSWER_DECISIONS)[number];

export interface AnswerDecisionTap {
  readonly decision: AnswerDecision;
  readonly answerId: string;
}

export function answerDecisionCallback(decision: AnswerDecision, answerId: string): string {
  return `${ANSWER_DECISION_PREFIX}${decision}:${answerId}`;
}

export function answerDecisionIn(callback: string): AnswerDecisionTap | null {
  if (!callback.startsWith(ANSWER_DECISION_PREFIX)) return null;
  const parts = callback.slice(ANSWER_DECISION_PREFIX.length).split(":");
  const decision = parts[0];
  const answerId = parts.slice(1).join(":");
  if (decision === undefined || answerId.length === 0) return null;
  if (!(ANSWER_DECISIONS as readonly string[]).includes(decision)) return null;
  return { decision: decision as AnswerDecision, answerId };
}

export function decisionChoices(answerIds: readonly string[]): readonly ButtonChoice[] {
  return answerIds.flatMap((answerId, index) => [
    { label: `Keep ${index + 1}`, callback: answerDecisionCallback("keep", answerId) },
    { label: `Retire ${index + 1}`, callback: answerDecisionCallback("retire", answerId) },
  ]);
}

export function captureChoices(answerId: string): readonly ButtonChoice[] {
  return [
    { label: "Keep", callback: answerDecisionCallback("keep", answerId) },
    { label: "Discard", callback: answerDecisionCallback("retire", answerId) },
  ];
}

export function pendingChoices(answerIds: readonly string[]): readonly ButtonChoice[] {
  return answerIds.flatMap((answerId) => [
    { label: `Keep ${answerId}`, callback: answerDecisionCallback("keep", answerId) },
    { label: `Discard ${answerId}`, callback: answerDecisionCallback("retire", answerId) },
  ]);
}

export const ONLY_MANAGERS_POPUP = "Only managers can do this. Nothing changed.";
