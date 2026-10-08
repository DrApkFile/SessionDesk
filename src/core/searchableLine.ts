import { encode } from "./codec.js";
import type { LedgerEvent } from "./events.js";
import { WIRE_VERSION } from "./codec.js";

export const WIRE_MARKER = `${WIRE_VERSION}|`;

export function searchablePrefix(event: LedgerEvent): string | null {
  if (event.type === "ANSWER") {
    const question = event.questionText ?? "(not recorded)";
    return [`Question: ${question}`, `Answer: ${event.answerText}`].join("\n");
  }
  if (event.type === "ITEM_OPENED") {
    return [`Reported ${event.kind}: ${event.text}`].join("\n");
  }
  return null;
}

export function safeForPrefix(text: string): string {
  return text.replaceAll(WIRE_MARKER, `${WIRE_VERSION} `);
}

export function storedLine(event: LedgerEvent): string {
  const prefix = searchablePrefix(event);
  const wire = encode(event);
  return prefix === null ? wire : `${safeForPrefix(prefix)}\n${wire}`;
}

export function wireLineIn(stored: string): string {
  const lines = stored.split("\n");
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index];
    if (line !== undefined && line.startsWith(WIRE_MARKER)) return line;
  }
  return stored;
}
