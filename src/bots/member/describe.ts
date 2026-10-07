import type { LedgerEvent } from "../../core/events.js";
import { plainDay, plainKind, plainProfile, plainStatus } from "../../core/plainWords.js";
import type { StoredLine } from "../../memory/cache.js";
import { blobLink } from "./notices.js";

export function describeEvent(event: LedgerEvent): string {
  switch (event.type) {
    case "CONSENT_GIVEN":
      return event.scope === "storage_and_dm" ? "you said yes to being remembered, and to messages from me" : "you said yes to being remembered";
    case "PROFILE_FACT":
      return `you told me ${plainProfile(event.field)}: ${event.value}`;
    case "QUESTION_ASKED":
      return "you asked me a question";
    case "ITEM_OPENED":
      return `you raised ${plainKind(event.kind)}: ${event.text}`;
    case "ITEM_STATUS":
      return `something you raised is now ${plainStatus(event.status)}`;
    case "PROMISE_MADE":
      return `a manager promised you this by ${event.due}: ${event.text}`;
    case "PROMISE_FULFILLED":
      return "a manager marked that promise done";
    case "CONTRIBUTION":
      return event.kind === "helped" ? "someone thanked you for helping them" : "a problem you raised was accepted";
    case "CORRECTION":
      return `you corrected something you had told me: ${event.value}`;
    case "THEME_CREATED":
      return `a new topic was started: ${event.label}`;
    case "MANAGER_NOTE":
      return "a private manager note";
    case "TIER_SET":
      return "a manager made you a community ambassador";
    case "TIER_REVOKED":
      return "a manager removed your ambassador badge";
    case "ANSWER":
      return `an answer the community can reuse: ${event.answerText}`;
    case "ANSWER_RETIRED":
      return "an old answer was taken out of use";
    case "ANSWER_FEEDBACK":
      return event.helpful ? "you told me an earlier answer helped" : "you told me an earlier answer did not help";
    case "ITEM_AFFECTS":
      return "you told me something already raised affects you too";
    case "DM_ADDRESS":
      return "I saved your Telegram ID, encrypted, so I can message you about promises";
  }
}

export function describeStorage(line: StoredLine): string {
  if (line.state === "saved" && line.blobId !== null) return `saved ${blobLink(line.blobId)}`;
  if (line.state === "failed") return "this one did NOT save, so it is not kept";
  return "still saving";
}

export function describeLine(line: StoredLine, position: number): string {
  return `${position}. ${plainDay(line.event.ts)} - ${describeEvent(line.event)}\n   ${describeStorage(line)}`;
}
