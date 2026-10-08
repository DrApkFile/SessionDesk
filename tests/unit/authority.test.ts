import { describe, expect, it } from "vitest";
import { EVENT_AUTHORITY, authorityOf, eventTypesFrom } from "../../src/core/authority.js";
import { EVENT_TYPES } from "../../src/core/vocabulary.js";

describe("F11 who may create which event", () => {
  it("assigns exactly one authority to every event type", () => {
    expect(Object.keys(EVENT_AUTHORITY).sort()).toEqual([...EVENT_TYPES].sort());
  });

  it("keeps every status-changing event out of the write gate", () => {
    for (const type of ["ITEM_STATUS", "PROMISE_MADE", "PROMISE_FULFILLED", "MANAGER_NOTE", "TIER_SET", "TIER_REVOKED", "ANSWER_RETIRED"] as const) {
      expect(authorityOf(type)).toBe("manager_command");
    }
    expect(eventTypesFrom("write_gate")).toEqual(["PROFILE_FACT", "QUESTION_ASKED", "ITEM_OPENED", "CONTRIBUTION", "THEME_CREATED", "ANSWER", "ITEM_AFFECTS", "ANSWER_FEEDBACK"]);
  });

  it("leaves consent and corrections to the member's own commands", () => {
    expect(eventTypesFrom("member_command")).toEqual(["CONSENT_GIVEN", "CORRECTION", "DM_ADDRESS", "DM_HANDLE"]);
  });
});
