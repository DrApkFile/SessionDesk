import type { ButtonChoice } from "../../platform/platform.js";
import { isStatusCommand, type StatusCommand } from "./statusCommands.js";
import { ITEM_TRANSITIONS } from "../../core/items.js";
import type { ItemStatus } from "../../core/vocabulary.js";

export const THEMES_PAGE_PREFIX = "themes:";
export const ITEM_ACTION_PREFIX = "item:";
export const THEME_VIEWS = ["open", "all"] as const;
export type ThemeView = (typeof THEME_VIEWS)[number];

export interface PageTap {
  readonly view: ThemeView;
  readonly page: number;
}

export function pageCallback(view: ThemeView, page: number): string {
  return `${THEMES_PAGE_PREFIX}${view}:${page}`;
}

export function pageTapIn(callback: string): PageTap | null {
  if (!callback.startsWith(THEMES_PAGE_PREFIX)) return null;
  const [view, rawPage, ...rest] = callback.slice(THEMES_PAGE_PREFIX.length).split(":");
  if (rest.length > 0 || view === undefined || rawPage === undefined) return null;
  if (!(THEME_VIEWS as readonly string[]).includes(view)) return null;
  if (!/^[1-9][0-9]{0,3}$/.test(rawPage)) return null;
  return { view: view as ThemeView, page: Number(rawPage) };
}

export const ITEM_ACTIONS = ["ack", "fixed", "wontfix"] as const;
export type ItemAction = (typeof ITEM_ACTIONS)[number];

export const ITEM_ACTION_LABELS: Record<ItemAction, string> = { ack: "On it", fixed: "Fixed", wontfix: "Won't fix" };
export const ITEM_ACTION_COMMANDS = { ack: "/ack", fixed: "/fixed", wontfix: "/wontfix" } as const satisfies Record<ItemAction, StatusCommand>;

export interface ItemTap {
  readonly action: ItemAction;
  readonly itemId: string;
}

export function itemCallback(action: ItemAction, itemId: string): string {
  return `${ITEM_ACTION_PREFIX}${action}:${itemId}`;
}

export function itemTapIn(callback: string): ItemTap | null {
  if (!callback.startsWith(ITEM_ACTION_PREFIX)) return null;
  const parts = callback.slice(ITEM_ACTION_PREFIX.length).split(":");
  const action = parts[0];
  const itemId = parts.slice(1).join(":");
  if (action === undefined || itemId.length === 0) return null;
  if (!(ITEM_ACTIONS as readonly string[]).includes(action)) return null;
  if (!isStatusCommand(ITEM_ACTION_COMMANDS[action as ItemAction])) return null;
  return { action: action as ItemAction, itemId };
}

export const ITEM_ACTION_STATUSES = { ack: "acknowledged", fixed: "fixed", wontfix: "wont_fix" } as const satisfies Record<ItemAction, ItemStatus>;

export function itemChoices(itemId: string, from: ItemStatus): readonly ButtonChoice[] {
  const allowed: readonly ItemStatus[] = ITEM_TRANSITIONS[from];
  return ITEM_ACTIONS.filter((action) => allowed.includes(ITEM_ACTION_STATUSES[action])).map((action) => ({
    label: `${ITEM_ACTION_LABELS[action]} ${itemId.replace(/^i-/, "")}`,
    callback: itemCallback(action, itemId),
  }));
}

export function pageChoices(view: ThemeView, page: number, pages: number): readonly ButtonChoice[] {
  const choices: ButtonChoice[] = [];
  if (page > 1) choices.push({ label: "Back", callback: pageCallback(view, page - 1) });
  if (page < pages) choices.push({ label: "Show more", callback: pageCallback(view, page + 1) });
  return choices;
}
