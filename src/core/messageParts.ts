import { TELEGRAM_MESSAGE_LIMIT } from "./tuning.js";

function hardSplit(line: string, limit: number): readonly string[] {
  const pieces: string[] = [];
  let rest = line;
  while (rest.length > limit) {
    const window = rest.slice(0, limit);
    const breakAt = window.lastIndexOf(" ");
    const cut = breakAt > limit / 2 ? breakAt : limit;
    pieces.push(rest.slice(0, cut).trimEnd());
    rest = rest.slice(cut).trimStart();
  }
  if (rest.length > 0) pieces.push(rest);
  return pieces;
}

export function messageParts(text: string, limit: number = TELEGRAM_MESSAGE_LIMIT): readonly string[] {
  if (text.length <= limit) return [text];
  const parts: string[] = [];
  let held = "";
  const add = (line: string): void => {
    const joined = held.length === 0 ? line : `${held}\n${line}`;
    if (joined.length <= limit) {
      held = joined;
      return;
    }
    if (held.length > 0) parts.push(held);
    held = line;
  };
  for (const line of text.split("\n")) {
    if (line.length <= limit) {
      add(line);
      continue;
    }
    for (const piece of hardSplit(line, limit)) add(piece);
  }
  if (held.length > 0) parts.push(held);
  return parts.length === 0 ? [text.slice(0, limit)] : parts;
}

export function sendFailedNotice(reason: string): string {
  return `That reply couldn't be sent: ${reason}`;
}
