import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { SECRET_PATTERNS, findSecrets, guardStoredText, kindsBySpecificity, maskSecrets } from "../../src/core/redactor.js";
import { fillerArb, glueArb, highSpecificitySecretArb, lowSpecificitySecretArb, secretArb } from "../support/arbitraries.js";

describe("F10 redactor", () => {
  it("finds a secret wherever it sits in a message, separated by spaces", () => {
    fc.assert(
      fc.property(fillerArb, secretArb, fillerArb, (before, secret, after) => {
        const text = `${before} ${secret} ${after}`;
        expect(findSecrets(text).length).toBeGreaterThan(0);
      }),
      { numRuns: 300 },
    );
  });

  it("never leaves the secret in the masked text used for logs", () => {
    fc.assert(
      fc.property(fillerArb, secretArb, fillerArb, (before, secret, after) => {
        expect(maskSecrets(`${before} ${secret} ${after}`)).not.toContain(secret);
      }),
      { numRuns: 300 },
    );
  });

  it("blocks storing a message that carries a secret", () => {
    fc.assert(
      fc.property(secretArb, (secret) => {
        const guarded = guardStoredText(`here you go ${secret} thanks`);
        expect(guarded.ok).toBe(false);
        if (!guarded.ok) expect(guarded.code).toBe("SECRET_BLOCKED");
      }),
      { numRuns: 200 },
    );
  });

  it("leaves ordinary community talk alone", () => {
    fc.assert(
      fc.property(fillerArb, (text) => {
        expect(findSecrets(text)).toEqual([]);
        expect(maskSecrets(text)).toBe(text);
      }),
    );
    for (const text of ["android login fails on version 2.3", "the bug i reported in june", "meeting at 10:30 on 2026-10-09"]) {
      expect(findSecrets(text)).toEqual([]);
    }
  });

  it("matches a high-specificity secret glued to surrounding words, with no separator", () => {
    fc.assert(
      fc.property(glueArb, highSpecificitySecretArb, glueArb, (before, secret, after) => {
        const glued = `${before}${secret}${after}`;
        expect(findSecrets(glued).length).toBeGreaterThan(0);
        expect(maskSecrets(glued)).not.toContain(secret);
        expect(guardStoredText(glued).ok).toBe(false);
      }),
      { numRuns: 300 },
    );
  });

  it("carries no word boundary in any high-specificity pattern", () => {
    for (const kind of kindsBySpecificity("high")) expect(SECRET_PATTERNS[kind].source).not.toContain("\\b");
    expect(kindsBySpecificity("high")).toEqual(["hex_secret", "sui_private_key", "google_api_key", "groq_api_key", "openai_api_key", "telegram_bot_token", "jwt"]);
    expect(kindsBySpecificity("low")).toEqual(["email", "phone_international", "phone_local"]);
  });

  it("blocks a bare 64-hex key pasted inside a sentence with no spaces", () => {
    const key = "9f".repeat(32);
    expect(findSecrets(`mykeyis${key}pleasehelp`)).toEqual(["hex_secret"]);
    expect(findSecrets(`mykeyis0x${key}pleasehelp`)).toEqual(["hex_secret"]);
  });

  it("finds a low-specificity secret when it stands apart in the message", () => {
    fc.assert(
      fc.property(fillerArb, lowSpecificitySecretArb, fillerArb, (before, secret, after) => {
        expect(findSecrets(`${before} ${secret} ${after}`).length).toBeGreaterThan(0);
      }),
      { numRuns: 200 },
    );
  });

  it("does not catch a local phone number glued inside a word, which is the accepted cost of keeping word boundaries there", () => {
    expect(findSecrets("call08012345678now")).toEqual([]);
    expect(findSecrets("call 08012345678 now")).toEqual(["phone_local"]);
  });

  it("names what it found so the member can rotate the right thing", () => {
    expect(findSecrets("mail me at ada@example.com")).toEqual(["email"]);
    expect(findSecrets(`key 0x${"a".repeat(64)}`)).toEqual(["hex_secret"]);
    expect(guardStoredText("ada@example.com")).toEqual({ ok: false, code: "SECRET_BLOCKED", detail: "email" });
  });
});
