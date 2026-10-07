import { describe, expect, it } from "vitest";
import { NO_CONSENT, mayDirectMessage, requireConsent, requireManager } from "../../src/core/consent.js";

describe("F13 consent guard", () => {
  it("refuses storage for a member who has not agreed", () => {
    const guarded = requireConsent(NO_CONSENT);
    expect(guarded.ok).toBe(false);
    if (!guarded.ok) expect(guarded.code).toBe("NOT_CONSENTED");
  });

  it("allows storage once the member has agreed", () => {
    expect(requireConsent({ consented: true, dmConsent: false }).ok).toBe(true);
  });

  it("keeps direct messages behind a separate yes", () => {
    expect(mayDirectMessage({ consented: true, dmConsent: false })).toBe(false);
    expect(mayDirectMessage({ consented: true, dmConsent: true })).toBe(true);
    expect(mayDirectMessage({ consented: false, dmConsent: true })).toBe(false);
  });
});

describe("F14 manager allowlist", () => {
  it("accepts only an allowlisted telegram id", () => {
    expect(requireManager([111, 222], 222)).toEqual({ ok: true, value: 222 });
  });

  it("refuses everyone else with NOT_MANAGER and changes nothing", () => {
    const refused = requireManager([111, 222], 333);
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.code).toBe("NOT_MANAGER");
    expect(requireManager([], 111).ok).toBe(false);
  });
});
