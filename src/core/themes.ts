import { onlyMatch, type Match } from "./onlyMatch.js";
import { clipThemeLabel, collapseWhitespace } from "./text.js";

export const UNLABELLED_THEME = "general";

export interface ThemeRecord {
  readonly themeId: string;
  readonly label: string;
}

export function normalizeThemeLabel(label: string): string {
  return collapseWhitespace(label).toLowerCase().replace(/[^a-z0-9 ]/g, "");
}

export function themeLabelFor(rawLabel: string | undefined): string {
  const clipped = clipThemeLabel(rawLabel ?? "");
  return normalizeThemeLabel(clipped).length === 0 ? UNLABELLED_THEME : clipped;
}

export function matchTheme(themes: readonly ThemeRecord[], label: string): Match<ThemeRecord> {
  const wanted = normalizeThemeLabel(label);
  return onlyMatch(themes, (theme) => normalizeThemeLabel(theme.label) === wanted);
}
