import type { LedgerEvent } from "../../core/events.js";
import { plainDay, plainProfile, plainStatus } from "../../core/plainWords.js";
import { MYDATA_TEXT_CHARS } from "../../core/tuning.js";
import type { StoredLine } from "../../memory/cache.js";
import { blobLink } from "./notices.js";

export interface PlainLine {
  readonly lead: string;
  readonly content: string | null;
}

export function clipForMember(text: string): string {
  return text.length <= MYDATA_TEXT_CHARS ? text : `${text.slice(0, MYDATA_TEXT_CHARS - 1).trimEnd()}…`;
}

export function describePlainly(event: LedgerEvent): PlainLine {
  switch (event.type) {
    case "CONSENT_GIVEN":
      return { lead: "You agreed to", content: event.scope === "storage_and_dm" ? "being remembered, and to messages from me" : "being remembered" };
    case "PROFILE_FACT":
      return { lead: `You told me ${plainProfile(event.field)}`, content: event.value };
    case "QUESTION_ASKED":
      return { lead: "You asked", content: "me a question" };
    case "ITEM_OPENED":
      return { lead: "You reported", content: event.text };
    case "ITEM_STATUS":
      return { lead: "Something you reported is now", content: plainStatus(event.status) };
    case "PROMISE_MADE":
      return { lead: `A manager promised you, by ${event.due}`, content: event.text };
    case "PROMISE_FULFILLED":
      return { lead: "A manager marked that promise", content: "done" };
    case "CONTRIBUTION":
      return event.kind === "helped"
        ? { lead: "You were thanked", content: "for helping someone here" }
        : { lead: "You reported something", content: "the team accepted" };
    case "CORRECTION":
      return { lead: "You corrected this to", content: event.value };
    case "THEME_CREATED":
      return { lead: "A new topic was started", content: event.label };
    case "MANAGER_NOTE":
      return { lead: "A private manager note", content: null };
    case "TIER_SET":
      return { lead: "A manager made you", content: "a community ambassador" };
    case "TIER_REVOKED":
      return { lead: "A manager removed", content: "your ambassador badge" };
    case "ANSWER":
      return { lead: "An answer the community can reuse", content: event.answerText };
    case "ANSWER_RETIRED":
      return { lead: "An old answer was", content: "taken out of use" };
    case "ANSWER_CONFIRMED":
      return { lead: "A manager confirmed an answer", content: "can be reused" };
    case "ANSWER_FEEDBACK":
      return { lead: "You told me an earlier answer", content: event.helpful ? "helped" : "did not help" };
    case "ITEM_AFFECTS":
      return { lead: "You said something already reported", content: "affects you too" };
    case "DM_ADDRESS":
    case "DM_HANDLE":
      return { lead: "I saved the address I message you on", content: "encrypted, so I can tell you about promises" };
    case "OWNER_SET":
      return { lead: "Someone claimed this assistant", content: "as its owner" };
    case "MANAGER_ADDED":
      return { lead: "The owner gave someone", content: "manager rights" };
    case "MANAGER_REMOVED":
      return { lead: "The owner took away someone's", content: "manager rights" };
    case "COMMUNITY_SET":
      return { lead: "A manager set which group", content: "this assistant serves" };
  }
}

export function describeEvent(event: LedgerEvent): string {
  const plain = describePlainly(event);
  return plain.content === null ? plain.lead : `${plain.lead}: ${clipForMember(plain.content)}`;
}

export function describeStorage(line: StoredLine): string {
  if (line.state === "saved" && line.blobId !== null) return `saved ${blobLink(line.blobId)}`;
  if (line.state === "failed") return "this one did NOT save, so it is not kept";
  return "still saving";
}

export function describeLine(line: StoredLine, position: number): string {
  const plain = describePlainly(line.event);
  const body = plain.content === null ? plain.lead : `${plain.lead}: "${clipForMember(plain.content)}"`;
  return `${position}. ${plainDay(line.event.ts)} — ${body}\n   ${describeStorage(line)}`;
}
