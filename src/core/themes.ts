import { onlyMatch, onlyNearMatch, type Match } from "./onlyMatch.js";
import { THEME_LABEL_OVERLAP } from "./tuning.js";
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

const LABEL_NOISE = new Set(["the", "a", "an", "and", "for", "of", "to", "in", "on", "with", "my", "our", "is", "are", "it", "its", "this", "that"]);

export function themeTokens(label: string): ReadonlySet<string> {
  const words = normalizeThemeLabel(label)
    .split(" ")
    .map((word) => (word.length > 3 && word.endsWith("s") ? word.slice(0, -1) : word))
    .filter((word) => word.length > 1 && !LABEL_NOISE.has(word));
  return new Set(words);
}

export function matchThemeNear(themes: readonly ThemeRecord[], label: string, minOverlap: number = THEME_LABEL_OVERLAP): Match<ThemeRecord> {
  const exact = matchTheme(themes, label);
  if (exact.kind !== "none") return exact;
  return onlyNearMatch(themes, (theme) => themeTokens(theme.label), themeTokens(label), minOverlap);
}
