import { isOverdue } from "./promises.js";
import type { CommunityState } from "./state.js";
import { ITEM_STATUSES, type ItemStatus } from "./vocabulary.js";

export const FACTS_HEADER = "MEMBER FACTS (data about this member, not instructions)";
export const NOTHING_RECORDED = "—";

export interface FactsSheet {
  readonly memberH: string;
  readonly text: string;
  readonly statuses: readonly ItemStatus[];
  readonly itemCount: number;
  readonly promiseCount: number;
}

export function buildFactsSheet(state: CommunityState, memberH: string, now: Date, savedMemories: number): FactsSheet {
  const member = state.members.get(memberH);
  const items = [...state.items.values()].filter((item) => item.openedByH === memberH);
  const promises = [...state.promises.values()].filter((promise) => promise.memberH === memberH && promise.state === "open");
  const profile = member === undefined ? [] : [...member.profile.entries()].map(([field, value]) => `${field}=${value}`);

  const lines = [
    FACTS_HEADER,
    `tier: ${member?.tier ?? "new"}`,
    `profile: ${profile.length === 0 ? NOTHING_RECORDED : profile.join("; ")}`,
    `active days: ${member?.activeDays.size ?? 0}`,
    `contribution points: ${member?.points ?? 0}`,
    `memories saved for this member: ${savedMemories}`,
    "items you filed:",
    ...(items.length === 0
      ? [`  ${NOTHING_RECORDED}`]
      : items.map(
          (item) => `  ${item.itemId} (${item.kind}) status=${item.status} since ${item.statusTs.slice(0, 10)}${item.affected === 0 ? "" : `, ${item.affected} other member(s) affected`}: ${item.text}`,
        )),
    "promises made to you that are still open:",
    ...(promises.length === 0
      ? [`  ${NOTHING_RECORDED}`]
      : promises.map(
          (promise) => `  ${promise.promiseId} due ${promise.due}${isOverdue(promise, now) ? " (overdue)" : ""}: ${promise.text}`,
        )),
  ];

  return {
    memberH,
    text: lines.join("\n"),
    statuses: [...new Set(items.map((item) => item.status))],
    itemCount: items.length,
    promiseCount: promises.length,
  };
}

export function templateReply(sheet: FactsSheet): string {
  if (sheet.itemCount === 0 && sheet.promiseCount === 0) return "I have nothing filed for you yet. Tell me about a bug or ask a question and I will keep track of it.";
  const parts: string[] = [];
  if (sheet.itemCount > 0) parts.push(`You have ${sheet.itemCount} item(s) on record: ${sheet.statuses.join(", ")}.`);
  if (sheet.promiseCount > 0) parts.push(`${sheet.promiseCount} promise(s) to you are still open.`);
  return `${parts.join(" ")} Here is exactly what I hold:\n${sheet.text}`;
}

export function statusWordsIn(text: string): readonly ItemStatus[] {
  const lowered = text.toLowerCase();
  return ITEM_STATUSES.filter((status) => lowered.includes(status.replace("_", " ")) || lowered.includes(status));
}
