import { isOpen, itemLines, openClosedCounts } from "../../core/itemLine.js";
import type { CommunityState, ItemFacts, ThemeFacts } from "../../core/state.js";
import { ITEM_BUTTONS_SHOWN, THEMES_SHOWN, THEME_WINDOW_DAYS } from "../../core/tuning.js";
import type { ButtonChoice } from "../../platform/platform.js";
import type { Topic } from "../../core/themeGrouping.js";
import { itemChoices, pageChoices, type ThemeView } from "./themeTaps.js";

export interface ThemePage {
  readonly themes: readonly ThemeFacts[];
  readonly page: number;
  readonly pages: number;
  readonly items: readonly ItemFacts[];
}

export function itemsOfTheme(state: CommunityState, theme: ThemeFacts, view: ThemeView): readonly ItemFacts[] {
  const held = theme.itemIds.map((itemId) => state.items.get(itemId)).filter((item): item is ItemFacts => item !== undefined);
  return view === "all" ? held : held.filter((item) => isOpen(item));
}

export function pageOf(state: CommunityState, themes: readonly ThemeFacts[], view: ThemeView, wanted: number): ThemePage {
  const withItems = themes.filter((theme) => itemsOfTheme(state, theme, view).length > 0 || view === "all");
  const pages = Math.max(1, Math.ceil(withItems.length / THEMES_SHOWN));
  const page = Math.min(Math.max(1, wanted), pages);
  const shown = withItems.slice((page - 1) * THEMES_SHOWN, page * THEMES_SHOWN);
  return { themes: shown, page, pages, items: shown.flatMap((theme) => itemsOfTheme(state, theme, view)) };
}

export function headerFor(state: CommunityState, view: ThemeView, themeCount: number): string {
  const counts = openClosedCounts([...state.items.values()]);
  const scope = view === "all" ? "Showing everything." : "Showing open items only; /themes all shows the closed ones too.";
  return `Themes in the last ${THEME_WINDOW_DAYS} days, busiest first: ${counts.open} open, ${counts.closed} closed, across ${themeCount} theme(s). ${scope}`;
}

function themeBlock(theme: ThemeFacts, items: readonly ItemFacts[], indent: string): readonly string[] {
  const questions = theme.questionCount === 0 ? "" : `, ${theme.questionCount} question(s)`;
  const head = `${indent}${theme.label}: ${items.length} item(s)${questions}`;
  return [head, ...items.flatMap((item) => itemLines(item).map((line) => `${indent}  ${line}`))];
}

export function flatBody(state: CommunityState, page: ThemePage, view: ThemeView): readonly string[] {
  return page.themes.flatMap((theme) => themeBlock(theme, itemsOfTheme(state, theme, view), ""));
}

export function groupedBody(state: CommunityState, page: ThemePage, view: ThemeView, topics: readonly Topic[]): readonly string[] {
  const byLabel = new Map(page.themes.map((theme) => [theme.label.toLowerCase(), theme]));
  return topics.flatMap((topic) => {
    const themes = topic.themes.map((grouped) => byLabel.get(grouped.label.toLowerCase())).filter((theme): theme is ThemeFacts => theme !== undefined);
    return themes.length === 0 ? [] : [topic.title, ...themes.flatMap((theme) => themeBlock(theme, itemsOfTheme(state, theme, view), "  "))];
  });
}

export function choicesFor(page: ThemePage, view: ThemeView): readonly ButtonChoice[] {
  const actionable = page.items.filter((item) => isOpen(item)).slice(0, ITEM_BUTTONS_SHOWN);
  return [...actionable.flatMap((item) => itemChoices(item.itemId, item.status)), ...pageChoices(view, page.page, page.pages)];
}

export function buttonNote(page: ThemePage): readonly string[] {
  const actionable = page.items.filter((item) => isOpen(item)).length;
  if (actionable === 0) return [];
  const covered = Math.min(actionable, ITEM_BUTTONS_SHOWN);
  const which = actionable <= ITEM_BUTTONS_SHOWN ? "each item above" : `the first ${covered} items above`;
  return [`Buttons below act on ${which}. For any other item use /ack, /fixed or /wontfix with the id.`];
}

export function pageFooter(page: ThemePage): readonly string[] {
  return page.pages <= 1 ? [] : [`Page ${page.page} of ${page.pages}`];
}

export function tooFarNotice(pages: number): string {
  return `There are only ${pages} page(s).`;
}
