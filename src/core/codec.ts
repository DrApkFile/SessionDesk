import { EVENT_PAYLOADS, isEventType, payloadKeys, type LedgerEvent } from "./events.js";
import type { EventType } from "./vocabulary.js";

export const WIRE_VERSION = "SD1";

const RESERVED_KEYS = new Set(["seq", "t", "ts"]);
const TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/;
const WHOLE_NUMBER_PATTERN = /^(0|[1-9]\d{0,14})$/;

export function encode(event: LedgerEvent): string {
  const parts = [WIRE_VERSION, `seq=${event.seq}`, `t=${event.type}`];
  const payload = event as unknown as Record<string, unknown>;
  for (const key of payloadKeys(event.type)) {
    const value = payload[key];
    if (value === undefined) continue;
    parts.push(`${key}=${encodeURIComponent(String(value))}`);
  }
  parts.push(`ts=${event.ts}`);
  return parts.join("|");
}

export function decode(line: string): LedgerEvent | null {
  const tokens = line.split("|");
  if (tokens.length < 4 || tokens[0] !== WIRE_VERSION) return null;

  const fields = new Map<string, string>();
  for (const token of tokens.slice(1)) {
    const separator = token.indexOf("=");
    if (separator <= 0) return null;
    const key = token.slice(0, separator);
    if (fields.has(key)) return null;
    fields.set(key, token.slice(separator + 1));
  }

  const rawSeq = fields.get("seq");
  const rawType = fields.get("t");
  const ts = fields.get("ts");
  if (rawSeq === undefined || rawType === undefined || ts === undefined) return null;
  if (!WHOLE_NUMBER_PATTERN.test(rawSeq) || !TIMESTAMP_PATTERN.test(ts)) return null;
  if (!isEventType(rawType)) return null;

  const payload: Record<string, string> = {};
  for (const [key, value] of fields) {
    if (RESERVED_KEYS.has(key)) continue;
    const decoded = decodeValue(value);
    if (decoded === null) return null;
    payload[key] = decoded;
  }

  return build(rawType, payload, Number(rawSeq), ts);
}

function decodeValue(value: string): string | null {
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}

function build(type: EventType, payload: unknown, seq: number, ts: string): LedgerEvent | null {
  const parsed = EVENT_PAYLOADS[type].safeParse(payload);
  if (!parsed.success) return null;
  return { ...parsed.data, type, seq, ts } as LedgerEvent;
}
