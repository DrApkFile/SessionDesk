import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { encode } from "../../src/core/codec.js";
import { countingIds } from "../../src/core/ports.js";
import { maskSecrets } from "../../src/core/redactor.js";
import { planWrites, type GateContext } from "../../src/core/writeGate.js";
import { glueArb, highSpecificitySecretArb, secretArb } from "../support/arbitraries.js";

const MEMBER = "a".repeat(24);

function context(): GateContext {
  return {
    memberH: MEMBER,
    consented: true,
    themes: [],
    replyToMemberH: null,
    helperPairDayCounts: new Map(),
    day: "2026-10-07",
    ids: countingIds(),
  };
}

describe("F10 secrets never reach a stored line", () => {
  it("plans no write at all for a message carrying a secret", () => {
    fc.assert(
      fc.property(secretArb, (secret) => {
        for (const kind of ["bug", "question", "feedback", "feature", "profile", "thanks"] as const) {
          const planned = planWrites({ kind, themeLabel: "keys" }, `my key is ${secret}`, context());
          expect(planned.ok).toBe(false);
          if (!planned.ok) expect(planned.code).toBe("SECRET_BLOCKED");
        }
      }),
      { numRuns: 150 },
    );
  });

  it("keeps the secret out of every encoded line even if a caller ignores the refusal", () => {
    fc.assert(
      fc.property(secretArb, (secret) => {
        const planned = planWrites({ kind: "bug" }, `my key is ${secret}`, context());
        const lines = planned.ok ? planned.value.map((write) => encode({ ...write.draft, seq: 1, ts: "2026-10-07T09:00:00.000Z" })) : [];
        for (const line of lines) expect(line).not.toContain(secret);
      }),
      { numRuns: 150 },
    );
  });

  it("plans no write when a high-specificity secret is glued into the sentence", () => {
    fc.assert(
      fc.property(glueArb, highSpecificitySecretArb, glueArb, (before, secret, after) => {
        const planned = planWrites({ kind: "bug", themeLabel: "keys" }, `${before}${secret}${after}`, context());
        expect(planned.ok).toBe(false);
        if (!planned.ok) expect(planned.code).toBe("SECRET_BLOCKED");
      }),
      { numRuns: 200 },
    );
  });

  it("masks a secret before it can reach a log line", () => {
    const line = `member 4242 said: my token is 1234567890:${"A".repeat(35)} and mail ada@example.com`;
    const masked = maskSecrets(line);
    expect(masked).toContain("[redacted:telegram_bot_token]");
    expect(masked).toContain("[redacted:email]");
    expect(masked).not.toContain("A".repeat(35));
  });
});
