import { ERRORS } from "../../core/errors.js";
import { guardStoredText } from "../../core/redactor.js";
import { clipStoredText } from "../../core/text.js";
import { reply, type BotAction } from "../shared/incoming.js";
import type { ManagerContext, ManagerDeps } from "./deps.js";
import { findMember } from "./targets.js";

const NOTE_USAGE = "Use /note <text>, or reply to a member's message with /note <text> to attach it to them.";

export function writeNote(deps: ManagerDeps, context: ManagerContext, rest: string): BotAction {
  const parts = rest.trim().split(/\s+/);
  const first = parts[0] ?? "";
  const attached = first.startsWith("@") ? findMember(deps.directory, first, context.replyToMemberH) : null;
  const body = clipStoredText(attached !== null && attached.ok ? parts.slice(1).join(" ") : rest);
  if (body.length === 0) return reply(NOTE_USAGE);

  const guarded = guardStoredText(body);
  if (!guarded.ok) return reply("That note looks like it contains a secret, so nothing was stored.");

  const memberH = attached !== null && attached.ok ? attached.value : context.replyToMemberH;
  const recorded = deps.pipeline.commit(
    [{ draft: { type: "MANAGER_NOTE", text: body, ...(memberH === null ? {} : { memberH }) }, namespaces: [{ kind: "notes" }] }],
    { chatId: context.message.chatId, messageId: context.message.messageId },
    deps.clock.now(),
  );
  deps.log.say("note_written", { memberH: memberH ?? "none", seq: recorded[0]?.event.seq ?? 0, account: "B" });
  const about = memberH === null ? "the community" : deps.directory.label(memberH);
  return reply(`Noted about ${about}, on the manager-only account. The member bot has no path to it. ${ERRORS.WRITE_PENDING.message}`);
}

export function listNotes(deps: ManagerDeps): BotAction {
  const notes = deps.notesCache.state().notes;
  if (notes.length === 0) return reply("No manager notes on record yet. Write one with /note <text>.");
  const lines = [...notes]
    .sort((left, right) => right.seq - left.seq)
    .map((note) => `${note.ts.slice(0, 10)} ${note.memberH === null ? "community" : deps.directory.label(note.memberH)}: ${note.text}`);
  return reply([`${notes.length} manager note(s), newest first:`, ...lines].join("\n"));
}
