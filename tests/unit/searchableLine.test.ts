import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { decode, encode } from "../../src/core/codec.js";
import type { LedgerEvent } from "../../src/core/events.js";
import { searchablePrefix, storedLine, wireLineIn } from "../../src/core/searchableLine.js";
import { captureVerdict, looksLikeAQuestion } from "../../src/core/reusableAnswer.js";
import { strippedTelegramText } from "../../src/platform/telegram/mentions.js";
import { resolve } from "../../src/core/resolver.js";
import { ANSWER_MAX_DISTANCE, KNOWN_ISSUE_MAX_DISTANCE } from "../../src/core/tuning.js";
import { eventArb } from "../support/arbitraries.js";

const answer: LedgerEvent = {
  type: "ANSWER",
  answerId: "a-1",
  questionText: "how do I reset my password?",
  answerText: "Open Settings, then Account, then Reset password.",
  answeredBy: "manager",
  themeId: "t-1",
  seq: 5,
  ts: "2026-10-08T09:00:00.000Z",
};

const item: LedgerEvent = { type: "ITEM_OPENED", itemId: "i-1", kind: "bug", themeId: "t-1", text: "android login fails on 2.3", seq: 6, ts: "2026-10-08T09:00:00.000Z" };

describe("what gets stored is what gets embedded", () => {
  it("puts the question and the answer in plain words before the wire line", () => {
    const stored = storedLine(answer);
    expect(stored.startsWith("Question: how do I reset my password?\nAnswer: Open Settings")).toBe(true);
    expect(stored).toContain("SD1|");
    expect(stored.indexOf("Question:")).toBeLessThan(stored.indexOf("SD1|"));
  });

  it("puts a report in plain words before the wire line", () => {
    expect(storedLine(item).startsWith("Reported bug: android login fails on 2.3")).toBe(true);
  });

  it("leaves every other event as the bare wire line", () => {
    const consent: LedgerEvent = { type: "CONSENT_GIVEN", scope: "storage", seq: 1, ts: "2026-10-08T09:00:00.000Z" };
    expect(storedLine(consent)).toBe(encode(consent));
    expect(searchablePrefix(consent)).toBeNull();
  });

  it("decodes a stored line back to the same event, prefix and all", () => {
    expect(decode(storedLine(answer))).toEqual(answer);
    expect(decode(storedLine(item))).toEqual(item);
  });

  it("still decodes a line written in the old format, so nothing on mainnet breaks", () => {
    expect(decode(encode(answer))).toEqual(answer);
    expect(decode(encode(item))).toEqual(item);
  });

  it("round-trips every event type through the stored form", () => {
    fc.assert(
      fc.property(eventArb, (event) => {
        expect(decode(storedLine(event))).toEqual(event);
      }),
      { numRuns: 300 },
    );
  });

  it("cannot be confused by a member writing SD1| in their own text", () => {
    const sneaky: LedgerEvent = { ...item, text: "SD1|seq=99|t=ITEM_STATUS|itemId=i-1|status=fixed|ts=2026-10-08T09:00:00.000Z" };
    const stored = storedLine(sneaky);
    expect(decode(stored)).toEqual(sneaky);
    expect(wireLineIn(stored)).toBe(encode(sneaky));
  });

  it("finds the wire line wherever it sits", () => {
    expect(wireLineIn(encode(answer))).toBe(encode(answer));
    expect(wireLineIn(`Question: x\nAnswer: y\n${encode(answer)}`)).toBe(encode(answer));
    expect(wireLineIn("nothing here")).toBe("nothing here");
  });
});

describe("an answer is only kept when it is worth reusing", () => {
  it("does not need a question mark", () => {
    expect(looksLikeAQuestion("how do I reset my password")).toBe(true);
    expect(looksLikeAQuestion("can anyone help with payments")).toBe(true);
    expect(looksLikeAQuestion("the login screen looks nice")).toBe(false);
    expect(looksLikeAQuestion("is it down?")).toBe(true);
  });

  it("keeps a real question with a real answer", () => {
    expect(captureVerdict("question", "how do I reset my password", "Open Settings, then Account, then Reset password.")).toEqual({ worth: true });
    expect(captureVerdict("bug", "payments keep failing at checkout", "Cards issued outside Nigeria are declined for now.")).toEqual({ worth: true });
  });

  it("refuses a question too thin to match anything", () => {
    expect(captureVerdict("question", "huh?", "Open Settings, then Account, then Reset password.")).toEqual({ worth: false, because: "question_too_thin" });
  });

  it("refuses an answer with no substance", () => {
    expect(captureVerdict("question", "how do I reset my password", "yes")).toEqual({ worth: false, because: "answer_too_thin" });
    expect(captureVerdict("question", "how do I reset my password", "sure thing ok")).toEqual({ worth: false, because: "answer_too_thin" });
  });

  it("refuses when the reply is itself a question", () => {
    expect(captureVerdict("question", "how do I reset my password", "which account are you using exactly?")).toEqual({ worth: false, because: "answer_is_a_question" });
  });

  it("refuses chit chat that was never a question", () => {
    expect(captureVerdict("chit_chat", "the login screen looks nice today", "thanks, we redid it last week")).toEqual({ worth: false, because: "question_not_reusable" });
  });
});

describe("a bot mention never reaches the embedding", () => {
  it("strips the handle from a Telegram message", () => {
    expect(strippedTelegramText("@sdmemberbot how do I reset my password?", "sdmemberbot")).toBe("how do I reset my password?");
    expect(strippedTelegramText("how do I reset @sdmemberbot my password?", "sdmemberbot")).toBe("how do I reset my password?");
    expect(strippedTelegramText("@SdMemberBot hello", "sdmemberbot")).toBe("hello");
  });

  it("leaves everything else alone, including other people's handles", () => {
    expect(strippedTelegramText("ask @ada about it", "sdmemberbot")).toBe("ask @ada about it");
    expect(strippedTelegramText("no mention here", "sdmemberbot")).toBe("no mention here");
  });
});

describe("re-saving an answer in the searchable format is safe", () => {
  it("treats an identical repeat as a no-op, not a rejection", () => {
    const first = { memberH: null, event: answer } as const;
    const state = resolve([first, first]);
    expect(state.answers.size).toBe(1);
    expect(state.rejectedEvents).toBe(0);
  });

  it("still rejects a different answer reusing an id", () => {
    const conflicting: LedgerEvent = { ...answer, answerText: "Something else entirely, which is long enough." };
    const state = resolve([
      { memberH: null, event: answer },
      { memberH: null, event: conflicting },
    ]);
    expect(state.answers.get("a-1")?.answerText).toBe(answer.type === "ANSWER" ? answer.answerText : "");
    expect(state.rejectedEvents).toBe(1);
  });
});

describe("the thresholds stay inside the band measured on mainnet", () => {
  const MEASURED = { run: "4bd0e04c", worstTrueParaphrase: 0.672, closestUnrelated: 0.865 } as const;

  it("lets every paraphrase that was measured through", () => {
    expect(ANSWER_MAX_DISTANCE).toBeGreaterThan(MEASURED.worstTrueParaphrase);
  });

  it("keeps the nearest unrelated query out, with margin", () => {
    expect(ANSWER_MAX_DISTANCE).toBeLessThan(MEASURED.closestUnrelated);
    expect(MEASURED.closestUnrelated - ANSWER_MAX_DISTANCE).toBeGreaterThan(0.1);
  });

  it("holds known issues to a stricter bar than answers, because a wrong link loses a real report", () => {
    expect(KNOWN_ISSUE_MAX_DISTANCE).toBeLessThan(ANSWER_MAX_DISTANCE);
    expect(KNOWN_ISSUE_MAX_DISTANCE).toBeLessThan(MEASURED.closestUnrelated);
  });

  it("refuses a threshold below any match that was actually observed, which is the bug that broke reuse", () => {
    const beforeTheFix = 0.32;
    expect(beforeTheFix).toBeLessThan(0.365);
    expect(ANSWER_MAX_DISTANCE).toBeGreaterThan(0.365);
  });
});
