import { describe, expect, it } from "vitest";
import { helpedPairKey, mayCreditHelp, pointsFor } from "../../src/core/contributions.js";
import { POINTS_PER_CONTRIBUTION } from "../../src/core/tuning.js";

const HELPER = "a".repeat(24);
const THANKER = "b".repeat(24);
const DAY = "2026-10-07";

describe("contribution credit rules", () => {
  it("credits the member who was thanked", () => {
    expect(mayCreditHelp({ helperH: HELPER, thankerH: THANKER, day: DAY, helperPairDayCounts: new Map() })).toEqual({ credited: true });
  });

  it("never credits thanking yourself", () => {
    expect(mayCreditHelp({ helperH: HELPER, thankerH: HELPER, day: DAY, helperPairDayCounts: new Map() })).toEqual({ credited: false, reason: "self_thanks" });
  });

  it("credits one thanks per pair per day", () => {
    const counts = new Map([[helpedPairKey(THANKER, DAY), 1]]);
    expect(mayCreditHelp({ helperH: HELPER, thankerH: THANKER, day: DAY, helperPairDayCounts: counts })).toEqual({ credited: false, reason: "pair_limit_reached" });
    expect(mayCreditHelp({ helperH: HELPER, thankerH: THANKER, day: "2026-10-08", helperPairDayCounts: counts }).credited).toBe(true);
    expect(mayCreditHelp({ helperH: HELPER, thankerH: "c".repeat(24), day: DAY, helperPairDayCounts: counts }).credited).toBe(true);
  });

  it("scores each contribution kind from tuning", () => {
    expect(pointsFor("helped")).toBe(POINTS_PER_CONTRIBUTION.helped);
    expect(pointsFor("valid_report")).toBe(POINTS_PER_CONTRIBUTION.valid_report);
  });
});
