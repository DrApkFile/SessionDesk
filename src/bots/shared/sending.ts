import { messageParts, sendFailedNotice } from "../../core/messageParts.js";
import type { Log } from "./log.js";

export interface SendAttempt {
  readonly parts: number;
  readonly sent: number;
  readonly failed: boolean;
}

export function reasonOf(error: unknown): string {
  const said = error instanceof Error ? error.message : String(error);
  const trimmed = said.replace(/^Call to '\w+' failed!\s*/, "").slice(0, 120);
  return trimmed.length === 0 ? "the chat app refused it" : trimmed;
}

export async function sendInParts(
  text: string,
  sendOne: (part: string, index: number, total: number) => Promise<void>,
  log: Log,
  label: string,
  limit?: number,
): Promise<SendAttempt> {
  const parts = messageParts(text, limit);
  let sent = 0;
  for (const [index, part] of parts.entries()) {
    try {
      await sendOne(part, index, parts.length);
      sent += 1;
    } catch (error) {
      const reason = reasonOf(error);
      log.say("reply_send_failed", { bot: label, part: index + 1, parts: parts.length, chars: part.length, detail: reason });
      try {
        await sendOne(sendFailedNotice(reason), index, parts.length);
      } catch (fallbackError) {
        log.say("reply_fallback_failed", { bot: label, detail: reasonOf(fallbackError) });
      }
      return { parts: parts.length, sent, failed: true };
    }
  }
  if (parts.length > 1) log.say("reply_split", { bot: label, parts: parts.length, chars: text.length });
  return { parts: parts.length, sent, failed: false };
}
