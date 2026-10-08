import { describe, expect, it } from "vitest";
import { requireManager } from "../../src/core/consent.js";
import { memberHash, resolveNamespace } from "../../src/core/namespace.js";
import { PLATFORMS, userKey } from "../../src/platform/platform.js";

const SECRET = "f".repeat(64);
const TELEGRAM_ID = 42_000_001;

describe("a Telegram member's namespace never moves", () => {
  it("pins the hash of a known Telegram id to the value already written on mainnet", () => {
    expect(memberHash(SECRET, { platform: "telegram", id: String(TELEGRAM_ID) })).toBe("0d4ff88c00b393eb79c4c0b1");
    expect(memberHash(SECRET, { platform: "telegram", id: "1" })).toBe("cdafb75235013bb08b430263");
    expect(memberHash(SECRET, { platform: "telegram", id: "4242" })).toBe("dd2e2f00dbd243ec310ff583");
  });

  it("hashes a Telegram id exactly as the numeric form always did", () => {
    for (const id of [1, 42, 42_000_001, 9_999_999_999]) {
      expect(memberHash(SECRET, { platform: "telegram", id: String(id) })).toBe(memberHash(SECRET, id));
    }
  });

  it("keeps the namespace name the same shape", () => {
    const hash = memberHash(SECRET, { platform: "telegram", id: String(TELEGRAM_ID) });
    expect(resolveNamespace("c1", { kind: "member", memberH: hash })).toBe(`sd-c1-m-${hash}`);
    expect(hash).toMatch(/^[0-9a-f]{24}$/);
  });
});

describe("ids can never collide across platforms", () => {
  it("prefixes every platform except telegram, which stays bare for compatibility", () => {
    expect(userKey("telegram", "42000001")).toBe("42000001");
    expect(userKey("discord", "42000001")).toBe("discord:42000001");
    expect(userKey("slack", "42000001")).toBe("slack:42000001");
  });

  it("gives the same raw id a different hash on every platform", () => {
    const hashes = PLATFORMS.map((platform) => memberHash(SECRET, { platform, id: "42000001" }));
    expect(new Set(hashes).size).toBe(PLATFORMS.length);
  });

  it("cannot be tricked by an id that already looks prefixed", () => {
    expect(memberHash(SECRET, { platform: "telegram", id: "discord:7" })).not.toBe(memberHash(SECRET, { platform: "discord", id: "7" }));
    expect(userKey("telegram", "discord:7")).toBe("telegram:discord:7");
    expect(userKey("discord", "7")).toBe("discord:7");
  });

  it("leaves a real numeric telegram id bare, and only a malformed one gets prefixed", () => {
    expect(userKey("telegram", "42000001")).toBe("42000001");
    expect(userKey("telegram", "-1001234567890")).toBe("-1001234567890");
    expect(userKey("telegram", "not-an-id")).toBe("telegram:not-an-id");
  });

  it("keeps a slack id and a discord id apart even when they read alike", () => {
    expect(memberHash(SECRET, { platform: "slack", id: "U024BE7LH" })).not.toBe(memberHash(SECRET, { platform: "discord", id: "U024BE7LH" }));
  });
});

describe("a manager on one platform is not a manager on another", () => {
  it("qualifies every manager key by platform", () => {
    const keys = [userKey("telegram", "4242"), userKey("discord", "4242"), userKey("slack", "4242")];
    expect(keys).toEqual(["4242", "discord:4242", "slack:4242"]);
    expect(new Set(keys).size).toBe(3);
  });

  it("refuses a discord user whose id matches a telegram manager id", () => {
    const telegramManagers = [userKey("telegram", "4242")];
    expect(requireManager(telegramManagers, userKey("telegram", "4242")).ok).toBe(true);
    expect(requireManager(telegramManagers, userKey("discord", "4242")).ok).toBe(false);
    expect(requireManager(telegramManagers, userKey("slack", "4242")).ok).toBe(false);
  });

  it("accepts a manager only on the platform they were listed for", () => {
    const mixed = [userKey("telegram", "4242"), userKey("discord", "987654321098765432")];
    expect(requireManager(mixed, userKey("discord", "987654321098765432")).ok).toBe(true);
    expect(requireManager(mixed, userKey("telegram", "987654321098765432")).ok).toBe(false);
  });
});
