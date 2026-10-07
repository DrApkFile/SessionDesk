import { describe, expect, it } from "vitest";
import { earnedTier, grantTier, highestTier, revokeTier, tierAfter } from "../../src/core/tier.js";
import { CONTRIBUTOR_MIN_POINTS, REGULAR_MIN_ACTIVE_DAYS } from "../../src/core/tuning.js";

describe("member tier ladder", () => {
  it("starts everyone at new", () => {
    expect(earnedTier({ activeDays: REGULAR_MIN_ACTIVE_DAYS - 1, points: 0 })).toBe("new");
  });

  it("promotes to regular on enough distinct active days", () => {
    expect(earnedTier({ activeDays: REGULAR_MIN_ACTIVE_DAYS, points: 0 })).toBe("regular");
  });

  it("promotes to contributor only after regular and enough points", () => {
    expect(earnedTier({ activeDays: REGULAR_MIN_ACTIVE_DAYS, points: CONTRIBUTOR_MIN_POINTS })).toBe("contributor");
    expect(earnedTier({ activeDays: REGULAR_MIN_ACTIVE_DAYS - 1, points: CONTRIBUTOR_MIN_POINTS })).toBe("new");
    expect(earnedTier({ activeDays: REGULAR_MIN_ACTIVE_DAYS, points: CONTRIBUTOR_MIN_POINTS - 1 })).toBe("regular");
  });

  it("never moves a member backwards on earned tiers", () => {
    expect(highestTier("contributor", "new")).toBe("contributor");
    expect(highestTier("new", "regular")).toBe("regular");
    expect(highestTier("ambassador", "contributor")).toBe("ambassador");
  });
});

describe("manager-granted ambassador tier", () => {
  it("grants ambassador to a member who holds no grant", () => {
    expect(grantTier(null, "ambassador")).toEqual({ ok: true, value: "ambassador" });
  });

  it("refuses to grant ambassador twice and changes nothing", () => {
    const again = grantTier("ambassador", "ambassador");
    expect(again.ok).toBe(false);
    if (!again.ok) expect(again.code).toBe("INVALID_TRANSITION");
  });

  it("lets a grant outrank the earned tier", () => {
    expect(tierAfter("ambassador", "new")).toBe("ambassador");
    expect(tierAfter("ambassador", "contributor")).toBe("ambassador");
  });

  it("returns the member to their earned tier when the grant is revoked", () => {
    expect(revokeTier("ambassador")).toEqual({ ok: true, value: null });
    expect(tierAfter(null, "regular")).toBe("regular");
    expect(tierAfter(null, "new")).toBe("new");
  });

  it("refuses to revoke a grant the member never had", () => {
    const refused = revokeTier(null);
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.code).toBe("INVALID_TRANSITION");
  });
});
