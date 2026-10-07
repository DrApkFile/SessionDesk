import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { memberHash, memberHashFromNamespace, resolveNamespace } from "../../src/core/namespace.js";

const SECRET = "7f3c0b2a9d1e4f6a8c5b3d7e9f1a2b4c6d8e0f2a4b6c8d0e2f4a6b8c0d2e4f60";

describe("namespaces", () => {
  it("derives the member hash from the secret, never from the telegram id", () => {
    fc.assert(
      fc.property(fc.integer({ min: 10_000_000, max: 9_999_999_999 }), (telegramUserId) => {
        const hash = memberHash(SECRET, telegramUserId);
        expect(hash).toMatch(/^[0-9a-f]{24}$/);
        expect(hash).not.toContain(String(telegramUserId));
      }),
    );
  });

  it("gives the same hash for the same id and a different one for a different id", () => {
    expect(memberHash(SECRET, 12345)).toBe(memberHash(SECRET, 12345));
    expect(memberHash(SECRET, 12345)).not.toBe(memberHash(SECRET, 12346));
    expect(memberHash(`${SECRET}00`, 12345)).not.toBe(memberHash(SECRET, 12345));
  });

  it("prefixes every namespace with the community key", () => {
    const hash = memberHash(SECRET, 999);
    expect(resolveNamespace("c1", { kind: "member", memberH: hash })).toBe(`sd-c1-m-${hash}`);
    expect(resolveNamespace("c1", { kind: "items" })).toBe("sd-c1-items");
    expect(resolveNamespace("c1", { kind: "themes" })).toBe("sd-c1-themes");
    expect(resolveNamespace("c1", { kind: "notes" })).toBe("sd-c1-notes");
  });

  it("reads the member hash back out of a member namespace only", () => {
    const hash = memberHash(SECRET, 777);
    expect(memberHashFromNamespace("c1", `sd-c1-m-${hash}`)).toBe(hash);
    expect(memberHashFromNamespace("c1", "sd-c1-items")).toBeNull();
    expect(memberHashFromNamespace("c2", `sd-c1-m-${hash}`)).toBeNull();
  });
});
