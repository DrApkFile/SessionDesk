import { collapseWhitespace } from "./text.js";
import type { MessageKind } from "./vocabulary.js";

export const MIN_QUESTION_CHARS = 12;
export const MIN_QUESTION_WORDS = 3;
export const MIN_ANSWER_CHARS = 20;
export const MIN_ANSWER_WORDS = 4;

export const REUSABLE_QUESTION_KINDS: readonly MessageKind[] = ["question", "bug", "feature", "feedback"];

export type CaptureVerdict =
  | { readonly worth: true }
  | { readonly worth: false; readonly because: "question_not_reusable" | "question_too_thin" | "answer_too_thin" | "answer_is_a_question" };

function words(text: string): number {
  return collapseWhitespace(text).split(" ").filter((word) => word.length > 0).length;
}

export function looksLikeAQuestion(text: string): boolean {
  const lowered = collapseWhitespace(text).toLowerCase();
  if (lowered.includes("?")) return true;
  return /^(how|what|where|when|why|who|which|can|could|does|do|did|is|are|will|would|should|any|anyone|has|have)\b/.test(lowered);
}

export function captureVerdict(questionKind: MessageKind, questionText: string, answerText: string): CaptureVerdict {
  if (!REUSABLE_QUESTION_KINDS.includes(questionKind) && !looksLikeAQuestion(questionText)) {
    return { worth: false, because: "question_not_reusable" };
  }
  const question = collapseWhitespace(questionText);
  const answer = collapseWhitespace(answerText);
  if (question.length < MIN_QUESTION_CHARS || words(question) < MIN_QUESTION_WORDS) return { worth: false, because: "question_too_thin" };
  if (answer.length < MIN_ANSWER_CHARS || words(answer) < MIN_ANSWER_WORDS) return { worth: false, because: "answer_too_thin" };
  if (answer.endsWith("?") && !answer.includes(".")) return { worth: false, because: "answer_is_a_question" };
  return { worth: true };
}
