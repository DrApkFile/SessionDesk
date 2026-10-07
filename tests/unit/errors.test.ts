import { describe, expect, it } from "vitest";
import { ERROR_CODES, ERRORS, describe as describeCode } from "../../src/core/errors.js";

describe("error code set", () => {
  it("is closed and fully covered", () => {
    expect(Object.keys(ERRORS).sort()).toEqual([...ERROR_CODES].sort());
  });

  it.each(ERROR_CODES)("gives %s a message, a retryable flag and a next action", (code) => {
    const info = describeCode(code);
    expect(info.message.length).toBeGreaterThan(10);
    expect(typeof info.retryable).toBe("boolean");
    expect(info.nextAction.length).toBeGreaterThan(5);
  });

  it("says whether anything changed for every refusal a user can trigger", () => {
    for (const code of ["NOT_CONSENTED", "NOT_MANAGER", "SECRET_BLOCKED", "INVALID_TRANSITION", "UNKNOWN_ITEM", "AMBIGUOUS_TARGET", "INVALID_DATE", "BUDGET_EXHAUSTED", "WRITE_FAILED"] as const) {
      expect(ERRORS[code].message.toLowerCase()).toMatch(/nothing (was stored|changed)|not stored|not saved/);
    }
  });
});
