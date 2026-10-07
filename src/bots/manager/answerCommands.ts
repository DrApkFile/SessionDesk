import { retireAnswer } from "../../core/answers.js";
import { ERRORS } from "../../core/errors.js";
import { onlyMatch } from "../../core/onlyMatch.js";
import { reply, type BotAction } from "../shared/incoming.js";
import type { ManagerContext, ManagerDeps } from "./deps.js";

export function listAnswers(deps: ManagerDeps): BotAction {
  const answers = [...deps.cache.state().answers.values()].sort((left, right) => right.seq - left.seq);
  if (answers.length === 0) return reply("No answers on record yet. I keep one when a manager replies to a member's question, or when a member's reply is thanked.");
  const lines = answers.map((answer) => {
    const who = answer.answeredBy === "manager" ? "manager" : "member";
    const state = answer.state === "retired" ? "RETIRED" : "active";
    const question = answer.questionText === null ? "(question not on record)" : answer.questionText;
    const votes = `helped ${answer.helpful}, did not help ${answer.unhelpful}`;
    return `${answer.answerId} ${state} by ${who} on ${answer.ts.slice(0, 10)}, ${votes}\n   Q: ${question}\n   A: ${answer.answerText}`;
  });
  const unhelpful = answers.filter((answer) => answer.state === "active" && answer.unhelpful > answer.helpful);
  const warning = unhelpful.length === 0 ? [] : ["", `${unhelpful.length} active answer(s) are voted down more than up: ${unhelpful.map((answer) => answer.answerId).join(", ")}`];
  return reply([`${answers.length} answer(s), newest first:`, ...lines, ...warning, "", "Stop one being reused with /retire <answerId>."].join("\n"));
}

export function retire(deps: ManagerDeps, context: ManagerContext, rest: string): BotAction {
  const wanted = rest.trim().toLowerCase();
  if (wanted.length === 0) return reply("Use /retire <answerId>. Run /answers to see them.");
  const answers = [...deps.cache.state().answers.values()];
  const exact = answers.find((answer) => answer.answerId.toLowerCase() === wanted);
  const matched = exact === undefined ? onlyMatch(answers, (answer) => answer.answerId.toLowerCase().startsWith(wanted)) : ({ kind: "one", value: exact } as const);
  if (matched.kind === "none") return reply(`${ERRORS.UNKNOWN_ITEM.message} Run /answers to see the ids.`);
  if (matched.kind === "many") return reply(`${ERRORS.AMBIGUOUS_TARGET.message} ${wanted} matches ${matched.count} answers.`);

  const retired = retireAnswer(matched.value.state);
  if (!retired.ok) return reply(`${matched.value.answerId} is already retired, so nothing changed.`);

  const recorded = deps.pipeline.commit(
    [{ draft: { type: "ANSWER_RETIRED", answerId: matched.value.answerId, byManagerId: context.managerId }, namespaces: [{ kind: "answers" }] }],
    { chatId: context.message.chatId, messageId: context.message.messageId },
    deps.clock.now(),
  );
  deps.log.say("answer_retired", { answerId: matched.value.answerId, byManagerId: context.managerId, seq: recorded[0]?.event.seq ?? 0 });
  return reply(`${matched.value.answerId} is retired and will not be reused. ${ERRORS.WRITE_PENDING.message}`);
}
