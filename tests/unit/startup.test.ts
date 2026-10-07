import { describe, expect, it } from "vitest";
import { CommunityChat, PRIVACY_FIX, requirePrivacyDisabled } from "../../src/bots/shared/startup.js";

const identity = { id: 777, username: "sdmemberbot", canReadAllGroupMessages: true };

describe("F17 the member bot refuses to start with privacy mode on", () => {
  it("starts when privacy mode is disabled", () => {
    expect(requirePrivacyDisabled(identity)).toEqual({ ok: true, value: identity });
  });

  it("refuses with the BotFather fix when it cannot read group messages", () => {
    const refused = requirePrivacyDisabled({ ...identity, canReadAllGroupMessages: false });
    expect(refused.ok).toBe(false);
    if (refused.ok) return;
    expect(refused.detail).toContain("privacy mode is on for @sdmemberbot");
    expect(refused.detail).toContain(PRIVACY_FIX);
  });
});

describe("the configured community chat", () => {
  it("accepts the configured group and nothing else", () => {
    const chat = new CommunityChat(-1001234567890);
    expect(chat.check(-1001234567890)).toEqual({ ok: true, value: -1001234567890 });
    const other = chat.check(-100999);
    expect(other.ok).toBe(false);
    if (!other.ok) expect(other.detail).toContain("not the configured community chat -1001234567890");
  });

  it("stops using the old id after a migration and names the new one", () => {
    const chat = new CommunityChat(-100111);
    chat.recordMigration(-1002222222);
    expect(chat.migratedTo()).toBe(-1002222222);
    const old = chat.check(-100111);
    expect(old.ok).toBe(false);
    const upgraded = chat.check(-1002222222);
    expect(upgraded.ok).toBe(false);
    if (!upgraded.ok) expect(upgraded.detail).toContain("Set COMMUNITY_CHAT_ID=-1002222222 and restart");
  });
});
