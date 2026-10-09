import type { AnswerSource } from "../../core/vocabulary.js";

export function answerToConfirmNotice(source: AnswerSource, question: string | null, answer: string, answerId: string): string {
  const opening =
    source === "manager"
      ? "A manager answered a member's question in the group. Should I reuse that answer when someone asks the same thing?"
      : "A member's answer was thanked in the group. Should I reuse it when someone asks the same thing?";
  return [
    opening,
    question === null ? "I do not have the question it answered." : `They asked: ${question}`,
    `The answer: ${answer}`,
    "Tap Keep to let me reuse it, or Discard to forget it. Until one of you does, I will not reuse it.",
    `Its id is ${answerId}, so /confirm ${answerId} and /retire ${answerId} do the same thing.`,
  ].join("\n");
}

export const NO_MANAGER_REACHABLE = "could not reach any manager, the answer stays unconfirmed and is never reused";
