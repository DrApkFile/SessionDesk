import { collapseWhitespace } from "./text.js";
import { MIN_REUSE_CONTENT_WORDS } from "./tuning.js";

const STOP_WORDS = new Set([
  "a","an","and","any","are","as","at","be","been","but","by","can","could","did","do","does","for","from","got","had","has","have","how","i","if","in","is","it","its","me","my","no","not","of","on","or","our","out","so","that","the","their","them","then","there","this","to","up","us","was","we","what","when","where","which","who","why","will","with","would","you","your","yet","get","im","ive","dont","u","pls","please","hey","hi","hello","ok","okay","thanks","thx",
]);

function escapedForRegExp(literal: string): string {
  return literal.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function strippedOfNames(text: string, handles: readonly string[], displayNames: readonly string[]): string {
  const lowerHandles = handles.map((handle) => handle.toLowerCase().replace(/^@/, ""));
  const lowerNames = displayNames.filter((name) => name.length >= 3).map((name) => name.toLowerCase());
  let cleaned = text.replace(/@[A-Za-z0-9_]{2,32}/g, " ");
  for (const name of [...lowerHandles, ...lowerNames]) {
    cleaned = cleaned.replace(new RegExp(`\\b${escapedForRegExp(name)}\\b`, "gi"), " ");
  }
  return collapseWhitespace(cleaned);
}

export function expandedContractions(text: string): string {
  return text
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/n't\b/gi, " not")
    .replace(/'(s|re|ve|ll|d|m)\b/gi, "");
}

export function contentWords(text: string): readonly string[] {
  return collapseWhitespace(expandedContractions(text))
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, " ")
    .split(" ")
    .map((word) => word.trim())
    .filter((word) => word.length > 1 && !STOP_WORDS.has(word));
}

export interface ReuseQuery {
  readonly text: string;
  readonly contentWords: readonly string[];
  readonly worthMatching: boolean;
}

export function reuseQueryOf(text: string, handles: readonly string[], displayNames: readonly string[]): ReuseQuery {
  const stripped = strippedOfNames(text, handles, displayNames);
  const words = contentWords(stripped);
  return { text: stripped, contentWords: words, worthMatching: words.length >= MIN_REUSE_CONTENT_WORDS };
}
