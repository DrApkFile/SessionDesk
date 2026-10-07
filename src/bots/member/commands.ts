import { ERRORS } from "../../core/errors.js";
import type { LedgerEvent } from "../../core/events.js";
import { guardStoredText } from "../../core/redactor.js";
import { clipStoredText } from "../../core/text.js";
import { isProfileField } from "../../core/vocabulary.js";
import type { MemberDeps } from "./deps.js";
import { describeLine } from "./describe.js";
import { commandOf, isPrivate, pinnedNotice, reply, type IncomingMessage, type MemberAction } from "../shared/incoming.js";
import {
  ALREADY_CONSENTED,
  CONSENT_IN_GROUP,
  CONSENT_NOTICE,
  CORRECT_NOT_POSSIBLE,
  CORRECT_USAGE,
  GROUP_OPTIN_NOTICE,
  HELP,
  MYDATA_FOOTER,
  NOTHING_HELD,
  SECRET_WARNING,
  correctDone,
  correctUnknownLine,
} from "./notices.js";

export function memberCommands(deps: MemberDeps, message: IncomingMessage, memberH: string): MemberAction {
  const { name, rest } = commandOf(message.text);
  if (name === "/optin") return optin(deps, message);
  if (name === "/start") return start(deps, message, memberH, rest);
  if (name === "/help") return reply(HELP);
  if (name === "/mydata") return myData(deps, memberH);
  if (name === "/correct") return correct(deps, message, memberH, rest);
  return reply(HELP);
}

function optin(deps: MemberDeps, message: IncomingMessage): MemberAction {
  if (isPrivate(message)) return reply(CONSENT_NOTICE, true);
  if (!deps.managerIds.includes(message.userId)) {
    deps.log.say("optin_refused", { chat: String(message.chatId), reason: "not a manager" });
    return { kind: "silent", reason: "optin is for managers only" };
  }
  if (!deps.chat.check(message.chatId).ok) return { kind: "silent", reason: "not the community chat" };
  deps.log.say("optin_posted", { chat: String(message.chatId), byManagerId: message.userId });
  return pinnedNotice(GROUP_OPTIN_NOTICE);
}

function start(deps: MemberDeps, message: IncomingMessage, memberH: string, rest: string): MemberAction {
  if (!isPrivate(message)) return reply(CONSENT_IN_GROUP);
  const member = deps.cache.state().members.get(memberH);
  const consented = member?.consented === true;
  return consented ? reply(ALREADY_CONSENTED) : reply(CONSENT_NOTICE, true);
}

function myData(deps: MemberDeps, memberH: string): MemberAction {
  const lines = deps.cache.memoriesOf(memberH);
  if (lines.length === 0) return reply(NOTHING_HELD);
  const saved = lines.filter((line) => line.state === "saved").length;
  const failed = lines.filter((line) => line.state === "failed").length;
  const saving = lines.length - saved - failed;
  const counts = [`${saved} saved`, saving > 0 ? `${saving} still saving` : "", failed > 0 ? `${failed} that did not save` : ""].filter((part) => part.length > 0);
  const head = `Here is everything I remember about you, ${counts.join(", ")}.`;
  const member = deps.cache.state().members.get(memberH);
  const strandedAddress =
    member !== undefined && member.dmUserId !== null && !member.dmConsent
      ? ["", "You have messages from me turned off, so I no longer use your stored Telegram ID. That line is already on Walrus and I cannot delete it."]
      : [];
  return reply([head, "", ...lines.map((line, index) => describeLine(line, index + 1)), ...strandedAddress, "", MYDATA_FOOTER].join("\n"));
}

function correct(deps: MemberDeps, message: IncomingMessage, memberH: string, rest: string): MemberAction {
  const space = rest.search(/\s/);
  if (space === -1) return reply(CORRECT_USAGE);
  const position = Number(rest.slice(0, space));
  const value = clipStoredText(rest.slice(space + 1));
  if (!Number.isSafeInteger(position) || position < 1 || value.length === 0) return reply(CORRECT_USAGE);

  const guarded = guardStoredText(value);
  if (!guarded.ok) {
    deps.log.say("correct_secret_blocked", { memberH });
    return reply(SECRET_WARNING);
  }

  const held = deps.cache.memoriesOf(memberH);
  const target = held[position - 1];
  if (target === undefined) {
    deps.log.say("correct_unknown", { memberH, position });
    return reply(correctUnknownLine(position));
  }

  const field = correctableField(target.event);
  if (field === null) {
    deps.log.say("correct_not_correctable", { memberH, position, type: target.event.type });
    return reply(CORRECT_NOT_POSSIBLE);
  }

  const recorded = deps.pipeline.commit(
    [{ draft: { type: "CORRECTION", targetSeq: target.event.seq, field, value }, namespaces: [{ kind: "member", memberH }] }],
    { chatId: message.chatId, messageId: message.messageId },
    deps.clock.now(),
  );
  deps.log.say("corrected", { memberH, position, field, seq: recorded[0]?.event.seq ?? 0 });
  return reply(correctDone(value));
}

function correctableField(event: LedgerEvent): string | null {
  if (event.type === "PROFILE_FACT") return isProfileField(event.field) ? event.field : null;
  if (event.type === "ITEM_OPENED") return "text";
  return null;
}
