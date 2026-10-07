import { ERRORS } from "../../core/errors.js";
import type { LedgerEvent } from "../../core/events.js";
import { guardStoredText } from "../../core/redactor.js";
import { clipStoredText } from "../../core/text.js";
import { isProfileField } from "../../core/vocabulary.js";
import type { MemberDeps } from "./deps.js";
import { describeLine } from "./describe.js";
import { commandOf, isPrivate, pinnedNotice, reply, type IncomingMessage, type MemberAction } from "../shared/incoming.js";
import { ALREADY_CONSENTED, CONSENT_IN_GROUP, CONSENT_NOTICE, GROUP_OPTIN_NOTICE, HELP, SECRET_WARNING } from "./notices.js";

const CORRECT_USAGE = "Use /correct <number> <new value>, where the number is the one shown beside the line in /mydata.";

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
  if (lines.length === 0) return reply("I hold nothing about you yet. Send /start to agree, then talk to me and I will keep track.");
  const saved = lines.filter((line) => line.state === "saved").length;
  const failed = lines.filter((line) => line.state === "failed").length;
  const head = `I hold ${lines.length} line(s) about you: ${saved} saved on Walrus, ${lines.length - saved - failed} still saving, ${failed} failed.`;
  const member = deps.cache.state().members.get(memberH);
  const strandedAddress =
    member !== undefined && member.dmUserId !== null && !member.dmConsent
      ? ["", "You have turned direct messages off, so I no longer use your stored Telegram ID. That line is already on Walrus and cannot be deleted by me or anyone."]
      : [];
  const tail = "Forgetting means I stop indexing your namespace. Lines already written stay on Walrus and cannot be deleted.";
  return reply([head, "", ...lines.map(describeLine), ...strandedAddress, "", tail].join("\n"));
}

function correct(deps: MemberDeps, message: IncomingMessage, memberH: string, rest: string): MemberAction {
  const space = rest.search(/\s/);
  if (space === -1) return reply(CORRECT_USAGE);
  const targetSeq = Number(rest.slice(0, space));
  const value = clipStoredText(rest.slice(space + 1));
  if (!Number.isSafeInteger(targetSeq) || targetSeq < 1 || value.length === 0) return reply(CORRECT_USAGE);

  const guarded = guardStoredText(value);
  if (!guarded.ok) {
    deps.log.say("correct_secret_blocked", { memberH });
    return reply(SECRET_WARNING);
  }

  const target = deps.cache.memoriesOf(memberH).find((line) => line.event.seq === targetSeq);
  if (target === undefined) {
    deps.log.say("correct_unknown", { memberH, targetSeq });
    return reply(`I have no line ${targetSeq} for you, so nothing changed. ${CORRECT_USAGE}`);
  }

  const field = correctableField(target.event);
  if (field === null) {
    deps.log.say("correct_not_correctable", { memberH, targetSeq, type: target.event.type });
    return reply(`Line ${targetSeq} is not one you can correct, so nothing changed. You can correct a fact about yourself or the text of something you filed.`);
  }

  const recorded = deps.pipeline.commit(
    [{ draft: { type: "CORRECTION", targetSeq, field, value }, namespaces: [{ kind: "member", memberH }] }],
    { chatId: message.chatId, messageId: message.messageId },
    deps.clock.now(),
  );
  const seq = recorded[0]?.event.seq ?? 0;
  deps.log.say("corrected", { memberH, targetSeq, field, seq });
  return reply(`Noted. Line ${targetSeq} now reads ${field} = ${value}. ${ERRORS.WRITE_PENDING.message} ${ERRORS.WRITE_PENDING.nextAction}`);
}

function correctableField(event: LedgerEvent): string | null {
  if (event.type === "PROFILE_FACT") return isProfileField(event.field) ? event.field : null;
  if (event.type === "ITEM_OPENED") return "text";
  return null;
}
