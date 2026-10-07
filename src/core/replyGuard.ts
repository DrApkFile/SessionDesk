import { statusWordsIn } from "./factsSheet.js";
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
