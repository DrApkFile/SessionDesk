import { plainDay, plainStatus } from "./plainWords.js";
import type { ItemFacts } from "./state.js";
import { ITEM_SNIPPET_CHARS } from "./tuning.js";
import { collapseWhitespace } from "./text.js";
import { ITEM_STATUSES, type ItemStatus } from "./vocabulary.js";

export const OPEN_STATUSES: readonly ItemStatus[] = ["reported", "acknowledged"];
export const CLOSED_STATUSES: readonly ItemStatus[] = ITEM_STATUSES.filter((status) => !OPEN_STATUSES.includes(status));

export function isOpen(item: ItemFacts): boolean {
  return OPEN_STATUSES.includes(item.status);
}

export function snippetOf(text: string, limit: number = ITEM_SNIPPET_CHARS): string {
  const said = collapseWhitespace(text);
  return said.length <= limit ? said : `${said.slice(0, limit - 1).trimEnd()}…`;
}

export function itemLines(item: ItemFacts): readonly string[] {
  const affected = item.affected === 0 ? "" : `, ${item.affected} more affected`;
  return [`${snippetOf(item.text)} — ${plainStatus(item.status)}, ${plainDay(item.statusTs)}${affected}`, `     ${item.itemId}`];
}

export function openClosedCounts(items: readonly ItemFacts[]): { readonly open: number; readonly closed: number } {
  const open = items.filter((item) => isOpen(item)).length;
  return { open, closed: items.length - open };
}
