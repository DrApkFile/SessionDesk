import { FACTS_HEADER, statusWordsIn } from "./factsSheet.js";
import { refuse, ok, type Result } from "./result.js";

export interface ReplyGround {
  readonly text: string;
}

export function reviewReply(reply: string, sheet: ReplyGround): Result<string> {
  const trimmed = reply.trim();
  if (trimmed.length === 0) return refuse("MODEL_OUTPUT_REFUSED", "empty reply");
  const sheetLower = sheet.text.toLowerCase();
  const claimed = statusWordsIn(trimmed).filter((status) => !sheetLower.includes(status));
  if (claimed.length > 0) return refuse("MODEL_OUTPUT_REFUSED", `reply claimed status not on record: ${claimed.join(",")}`);
  return ok(trimmed);
}

export const INTERNAL_MARKERS = [FACTS_HEADER, "status=", "tier:", "themeId", "memberH", "seq=", "namespace", "blob_id", "SD1|"] as const;

const ID_SHAPE = /\b[ipta]-[0-9a-f]{4,}\b/;

export function internalLeakIn(text: string): string | null {
  for (const marker of INTERNAL_MARKERS) {
    if (text.includes(marker)) return marker;
  }
  const id = ID_SHAPE.exec(text);
  return id === null ? null : id[0];
}
