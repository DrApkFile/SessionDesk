import { MAX_STORED_TEXT_CHARS, MAX_THEME_LABEL_CHARS } from "./tuning.js";

export function collapseWhitespace(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

export function clipStoredText(text: string): string {
  return collapseWhitespace(text).slice(0, MAX_STORED_TEXT_CHARS);
}

export function clipThemeLabel(label: string): string {
  return collapseWhitespace(label).slice(0, MAX_THEME_LABEL_CHARS);
}
