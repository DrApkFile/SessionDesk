import { describe, expect, it } from "vitest";
import { FACTS_HEADER, NOTHING_RECORDED, buildFactsSheet, templateReply } from "../../src/core/factsSheet.js";
import { reviewReply } from "../../src/core/replyGuard.js";
import { resolve } from "../../src/core/resolver.js";
import { MEMBER_A, MEMBER_B, sampleLedger } from "../support/ledger.js";

const now = new Date("2026-10-08T09:00:00.000Z");
const sheet = buildFactsSheet(resolve(sampleLedger), MEMBER_A, now, 7);

describe("the code-built facts sheet", () => {
  it("says it is data, not instructions", () => {
    expect(sheet.text.startsWith(FACTS_HEADER)).toBe(true);
  });

  it("carries the current status of each item the member filed, not the first one", () => {
    expect(sheet.text).toContain("status=fixed");
    expect(sheet.text).not.toContain("status=reported");
    expect(sheet.statuses).toEqual(["fixed"]);
  });

  it("carries the tier, profile, points and saved count", () => {
    expect(sheet.text).toContain("tier: regular");
    expect(sheet.text).toContain("role=developer");
    expect(sheet.text).toContain("contribution points: 2");
    expect(sheet.text).toContain("memories saved for this member: 7");
  });

  it("shows a dash where nothing is recorded instead of inventing something", () => {
    const empty = buildFactsSheet(resolve(sampleLedger), MEMBER_B, now, 0);
    expect(empty.text).toContain(`profile: ${NOTHING_RECORDED}`);
    expect(empty.itemCount).toBe(0);
    expect(empty.statuses).toEqual([]);
    expect(templateReply(empty)).toContain("nothing filed for you yet");
  });

  it("never uses a status word in its own headings, so the guard cannot be fooled by the layout", () => {
    const empty = buildFactsSheet(resolve([]), MEMBER_A, now, 0);
    expect(empty.text.toLowerCase()).not.toContain("reported");
    expect(empty.text.toLowerCase()).not.toContain("fixed");
  });
});

describe("the reply guard", () => {
  it("passes a reply that stays inside the facts", () => {
    expect(reviewReply("Your login bug is fixed.", sheet)).toEqual({ ok: true, value: "Your login bug is fixed." });
  });

  it("refuses a reply claiming a status that is not on record", () => {
    for (const claim of ["That bug is verified now.", "It is still reported, sorry.", "We acknowledged it yesterday.", "That was a duplicate."]) {
      const reviewed = reviewReply(claim, sheet);
      expect(reviewed.ok).toBe(false);
      if (!reviewed.ok) expect(reviewed.code).toBe("MODEL_OUTPUT_REFUSED");
    }
  });

  it("refuses an empty reply rather than sending nothing", () => {
    const reviewed = reviewReply("   ", sheet);
    expect(reviewed.ok).toBe(false);
    if (!reviewed.ok) expect(reviewed.code).toBe("MODEL_OUTPUT_REFUSED");
  });

  it("refuses any status claim at all when the member has nothing on record", () => {
    const empty = buildFactsSheet(resolve([]), MEMBER_A, now, 0);
    expect(reviewReply("Your bug is fixed.", empty).ok).toBe(false);
    expect(reviewReply("I have nothing on record for you.", empty).ok).toBe(true);
  });
});
