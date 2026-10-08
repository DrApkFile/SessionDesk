import { confirmAnswer, retireAnswer } from "../../core/answers.js";
import { ERRORS } from "../../core/errors.js";
import { onlyMatch } from "../../core/onlyMatch.js";
import type { AnswerRecord } from "../../core/state.js";
import { reply, type BotAction } from "../shared/incoming.js";
import type { ManagerContext, ManagerDeps } from "./deps.js";

function labelOf(answer: AnswerRecord): string {
  if (answer.state === "retired") return "RETIRED";
  return answer.state === "pending" ? "NOT CONFIRMED" : "confirmed";
}

export function listAnswers(deps: ManagerDeps): BotAction {
  const answers = [...deps.cache.state().answers.values()].sort((left, right) => right.seq - left.seq);
  if (answers.length === 0) return reply("No answers on record yet. I keep one when a manager replies to a member's question, or when a member's reply is thanked.");
  const lines = answers.map((answer) => {
    const who = answer.answeredBy === "manager" ? "manager" : "member";
    const question = answer.questionText === null ? "(question not on record)" : answer.questionText;
    const votes = `helped ${answer.helpful}, did not help ${answer.unhelpful}`;
    return `${answer.answerId} ${labelOf(answer)} by ${who} on ${answer.ts.slice(0, 10)}, ${votes}\n   Q: ${question}\n   A: ${answer.answerText}`;
  });
  const pending = answers.filter((answer) => answer.state === "pending");
  const waiting =
    pending.length === 0
      ? []
      : ["", `${pending.length} answer(s) are not confirmed, so I never reuse them: ${pending.map((answer) => answer.answerId).join(", ")}`, "Confirm one with /confirm <answerId>."];
  const unhelpful = answers.filter((answer) => answer.state === "active" && answer.unhelpful > answer.helpful);
  const warning = unhelpful.length === 0 ? [] : ["", `${unhelpful.length} confirmed answer(s) are voted down more than up: ${unhelpful.map((answer) => answer.answerId).join(", ")}`];
  return reply([`${answers.length} answer(s), newest first:`, ...lines, ...waiting, ...warning, "", "Stop one being reused with /retire <answerId>."].join("\n"));
}

type Found = { readonly kind: "one"; readonly answer: AnswerRecord } | { readonly kind: "refused"; readonly action: BotAction };

function findAnswer(deps: ManagerDeps, rest: string, usage: string): Found {
  const wanted = rest.trim().toLowerCase();
  if (wanted.length === 0) return { kind: "refused", action: reply(`${usage} Run /answers to see them.`) };
  const answers = [...deps.cache.state().answers.values()];
  const exact = answers.find((answer) => answer.answerId.toLowerCase() === wanted);
  if (exact !== undefined) return { kind: "one", answer: exact };
  const matched = onlyMatch(answers, (answer) => answer.answerId.toLowerCase().startsWith(wanted));
  if (matched.kind === "none") return { kind: "refused", action: reply(`${ERRORS.UNKNOWN_ITEM.message} Run /answers to see the ids.`) };
  if (matched.kind === "many") return { kind: "refused", action: reply(`${ERRORS.AMBIGUOUS_TARGET.message} ${wanted} matches ${matched.count} answers.`) };
  return { kind: "one", answer: matched.value };
}

export function retire(deps: ManagerDeps, context: ManagerContext, rest: string): BotAction {
  const found = findAnswer(deps, rest, "Use /retire <answerId>.");
  if (found.kind === "refused") return found.action;

  const retired = retireAnswer(found.answer.state);
  if (!retired.ok) return reply(`${found.answer.answerId} is already retired, so nothing changed.`);

  const recorded = deps.pipeline.commit(
    [{ draft: { type: "ANSWER_RETIRED", answerId: found.answer.answerId, byManagerId: context.managerId }, namespaces: [{ kind: "answers" }] }],
    { chatId: context.message.chatId, messageId: context.message.messageId },
    deps.clock.now(),
  );
  deps.log.say("answer_retired", { answerId: found.answer.answerId, seq: recorded[0]?.event.seq ?? 0 });
  return reply(`${found.answer.answerId} is retired and will not be reused. ${ERRORS.WRITE_PENDING.message}`);
}

export function confirm(deps: ManagerDeps, context: ManagerContext, rest: string): BotAction {
  const found = findAnswer(deps, rest, "Use /confirm <answerId>.");
  if (found.kind === "refused") return found.action;

  const confirmed = confirmAnswer(found.answer.state);
  if (!confirmed.ok) return reply(`${found.answer.answerId} cannot be confirmed: ${confirmed.detail ?? ERRORS[confirmed.code].message}. Nothing changed.`);

  const recorded = deps.pipeline.commit(
    [{ draft: { type: "ANSWER_CONFIRMED", answerId: found.answer.answerId, byManagerId: context.managerId }, namespaces: [{ kind: "answers" }] }],
    { chatId: context.message.chatId, messageId: context.message.messageId },
    deps.clock.now(),
  );
  deps.log.say("answer_confirmed", { answerId: found.answer.answerId, seq: recorded[0]?.event.seq ?? 0 });
  return reply(`${found.answer.answerId} is confirmed, so I can reuse it when the same question comes up. ${ERRORS.WRITE_PENDING.message}`);
}
