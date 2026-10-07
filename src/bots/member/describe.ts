import type { LedgerEvent } from "../../core/events.js";
import type { StoredLine } from "../../memory/cache.js";
import { blobLink } from "./notices.js";

export function describeEvent(event: LedgerEvent): string {
  switch (event.type) {
    case "CONSENT_GIVEN":
      return event.scope === "storage_and_dm" ? "you agreed to storage and direct messages" : "you agreed to storage";
    case "PROFILE_FACT":
      return `about you: ${event.field} = ${event.value}`;
    case "QUESTION_ASKED":
      return `you asked a question (theme ${event.themeId})`;
    case "ITEM_OPENED":
      return `you filed ${event.itemId} (${event.kind}): ${event.text}`;
    case "ITEM_STATUS":
      return `${event.itemId} became ${event.status}`;
    case "PROMISE_MADE":
      return `a manager promised you by ${event.due}: ${event.text}`;
    case "PROMISE_FULFILLED":
      return `promise ${event.promiseId} was marked done`;
    case "CONTRIBUTION":
      return event.kind === "helped" ? "you were thanked for helping someone" : "you filed a report that was accepted";
    case "CORRECTION":
      return `you corrected line ${event.targetSeq}: ${event.field} = ${event.value}`;
    case "THEME_CREATED":
      return `a new theme was opened: ${event.label}`;
    case "MANAGER_NOTE":
      return "a manager note";
    case "TIER_SET":
      return "a manager made you an ambassador";
    case "TIER_REVOKED":
      return "a manager removed your ambassador tier";
    case "ANSWER":
      return `an answer was recorded for the community: ${event.answerText}`;
    case "ANSWER_RETIRED":
      return `answer ${event.answerId} was retired and is no longer reused`;
    case "ITEM_AFFECTS":
      return `you reported that ${event.itemId} affects you too`;
    case "DM_ADDRESS":
      return "your Telegram ID, stored encrypted so I can message you about promises";
  }
}

export function describeStorage(line: StoredLine): string {
  if (line.state === "saved" && line.blobId !== null) return `saved ${blobLink(line.blobId)}`;
  if (line.state === "failed") return `FAILED to save (${line.code ?? "unknown"}), so this is not on Walrus`;
  return "saving to Walrus now";
}

export function describeLine(line: StoredLine): string {
  return `${line.event.seq}. ${describeEvent(line.event)}\n   ${describeStorage(line)}`;
}
