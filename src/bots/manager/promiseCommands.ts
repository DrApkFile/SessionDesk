import { parsePromiseDue } from "../../core/dates.js";
import { ERRORS } from "../../core/errors.js";
import { fulfilPromise, isOverdue } from "../../core/promises.js";
import { guardStoredText } from "../../core/redactor.js";
import { clipStoredText } from "../../core/text.js";
import { reply, type BotAction } from "../shared/incoming.js";
import type { ManagerContext, ManagerDeps } from "./deps.js";
import { openPromises } from "./summary.js";
import { findItem, findMember, findPromise } from "./targets.js";

const PROMISE_USAGE = "Use /promise <itemId or @member> <YYYY-MM-DD> <what you are promising>.";

export function owed(deps: ManagerDeps): BotAction {
  const now = deps.clock.now();
  const promises = openPromises(deps.cache.state(), now);
  if (promises.length === 0) return reply("Nothing is owed: no open promises on record.");
  const lines = promises.map((promise) => {
    const flag = isOverdue(promise, now) ? "OVERDUE" : "due";
    return `${promise.promiseId} ${flag} ${promise.due} to ${deps.directory.label(promise.memberH)}${promise.itemId === null ? "" : ` [${promise.itemId}]`}: ${promise.text}`;
  });
  return reply([`${promises.length} open promise(s), overdue first:`, ...lines, "", "Mark one done with /done <promiseId>."].join("\n"));
}

export function makePromise(deps: ManagerDeps, context: ManagerContext, rest: string): BotAction {
  const parts = rest.trim().split(/\s+/);
  const target = parts[0] ?? "";
  const rawDue = parts[1] ?? "";
  const text = clipStoredText(parts.slice(2).join(" "));
  if (target.length === 0 || rawDue.length === 0 || text.length === 0) return reply(PROMISE_USAGE);

  const due = parsePromiseDue(rawDue, deps.clock.now());
  if (!due.ok) return reply(`${ERRORS.INVALID_DATE.message} ${due.detail ?? ""} ${ERRORS.INVALID_DATE.nextAction}`.trim());

  const guarded = guardStoredText(text);
  if (!guarded.ok) return reply("That promise text looks like it contains a secret, so nothing was stored.");

  const resolved = resolveTarget(deps, target, context.replyToMemberH);
  if (!resolved.ok) return reply(`${ERRORS[resolved.code].message} ${resolved.detail ?? ""}`.trim());

  const promiseId = deps.ids.newPromiseId();
  const recorded = deps.pipeline.commit(
    [
      {
        draft: {
          type: "PROMISE_MADE",
          promiseId,
          memberH: resolved.value.memberH,
          due: due.value,
          text,
          byManagerId: context.managerId,
          ...(resolved.value.itemId === null ? {} : { itemId: resolved.value.itemId }),
        },
        namespaces: [{ kind: "member", memberH: resolved.value.memberH }],
      },
    ],
    { chatId: context.message.chatId, messageId: context.message.messageId },
    deps.clock.now(),
  );
  deps.log.say("promise_made", { promiseId, memberH: resolved.value.memberH, due: due.value, byManagerId: context.managerId, seq: recorded[0]?.event.seq ?? 0 });
  return reply(`Promised ${promiseId} to ${deps.directory.label(resolved.value.memberH)} by ${due.value}: ${text}. ${ERRORS.WRITE_PENDING.message}`);
}

function resolveTarget(deps: ManagerDeps, target: string, replyToMemberH: string | null) {
  const item = findItem(deps, target);
  if (item.ok) {
    if (item.value.openedByH === null) return { ok: false as const, code: "UNKNOWN_ITEM" as const, detail: `${item.value.itemId} has nobody on record who filed it` };
    return { ok: true as const, value: { memberH: item.value.openedByH, itemId: item.value.itemId } };
  }
  const member = findMember(deps.directory, target, replyToMemberH);
  if (!member.ok) return member;
  return { ok: true as const, value: { memberH: member.value, itemId: null } };
}

export function donePromise(deps: ManagerDeps, context: ManagerContext, rest: string): BotAction {
  const found = findPromise(deps, rest);
  if (!found.ok) return reply(`${ERRORS[found.code].message} ${found.detail ?? ""}`.trim());
  const promise = deps.cache.state().promises.get(found.value);
  if (promise === undefined) return reply(ERRORS.UNKNOWN_ITEM.message);
  const fulfilled = fulfilPromise(promise.state);
  if (!fulfilled.ok) return reply(`${found.value} is already ${promise.state}, so nothing changed.`);

  const recorded = deps.pipeline.commit(
    [{ draft: { type: "PROMISE_FULFILLED", promiseId: found.value }, namespaces: [{ kind: "member", memberH: promise.memberH }] }],
    { chatId: context.message.chatId, messageId: context.message.messageId },
    deps.clock.now(),
  );
  deps.log.say("promise_done", { promiseId: found.value, byManagerId: context.managerId, seq: recorded[0]?.event.seq ?? 0 });
  return reply(`${found.value} is done. ${deps.directory.label(promise.memberH)} is no longer owed it. ${ERRORS.WRITE_PENDING.message}`);
}
