import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { decode, encode } from "../../src/core/codec.js";
import type { LedgerEvent } from "../../src/core/events.js";
import { eventArb } from "../support/arbitraries.js";

const anItem: LedgerEvent = { type: "ITEM_OPENED", seq: 7, ts: "2026-10-07T10:00:00.000Z", itemId: "i1", kind: "bug", themeId: "t1", text: "login fails" };

describe("event codec", () => {
  it("round-trips every event type through the wire format", () => {
    fc.assert(
      fc.property(eventArb, (event) => {
        expect(decode(encode(event))).toEqual(event);
      }),
      { numRuns: 500 },
    );
  });

  it("keeps separators and newlines inside text out of the field grammar", () => {
    const tricky: LedgerEvent = { ...anItem, text: "SD1|seq=9|t=ITEM_STATUS|status=fixed\nand=more" };
    const line = encode(tricky);
    expect(line.split("|")).toHaveLength(8);
    expect(decode(line)).toEqual(tricky);
  });

  it("refuses an unknown wire version", () => {
    expect(decode(encode(anItem).replace("SD1", "SD2"))).toBeNull();
  });

  it("refuses an unknown event type", () => {
    expect(decode("SD1|seq=1|t=ITEM_DELETED|itemId=i1|ts=2026-10-07T10:00:00.000Z")).toBeNull();
  });

  it("refuses an unknown field rather than ignoring it", () => {
    expect(decode(`${encode(anItem)}|severity=high`)).toBeNull();
  });

  it("refuses a missing required field", () => {
    expect(decode("SD1|seq=1|t=ITEM_OPENED|itemId=i1|kind=bug|ts=2026-10-07T10:00:00.000Z")).toBeNull();
  });

  it("refuses a value outside the enum", () => {
    expect(decode("SD1|seq=1|t=ITEM_STATUS|itemId=i1|status=totally_fixed|ts=2026-10-07T10:00:00.000Z")).toBeNull();
  });

  it("refuses a non-numeric seq and a malformed timestamp", () => {
    expect(decode("SD1|seq=one|t=PROMISE_FULFILLED|promiseId=p1|ts=2026-10-07T10:00:00.000Z")).toBeNull();
    expect(decode("SD1|seq=1|t=PROMISE_FULFILLED|promiseId=p1|ts=yesterday")).toBeNull();
  });

  it("refuses a repeated field", () => {
    expect(decode("SD1|seq=1|t=QUESTION_ASKED|themeId=t1|themeId=t2|ts=2026-10-07T10:00:00.000Z")).toBeNull();
  });

  it("refuses malformed percent-encoding instead of repairing it", () => {
    expect(decode("SD1|seq=1|t=THEME_CREATED|themeId=t1|label=%E0%A4%A|ts=2026-10-07T10:00:00.000Z")).toBeNull();
  });

  it("omits absent optional fields from the line", () => {
    const promise: LedgerEvent = { type: "PROMISE_MADE", seq: 3, ts: "2026-10-07T10:00:00.000Z", promiseId: "p1", memberH: "a".repeat(24), due: "2026-10-09", text: "we will check", byManagerId: 42 };
    expect(encode(promise)).not.toContain("itemId=");
    expect(decode(encode(promise))).toEqual(promise);
  });
});
