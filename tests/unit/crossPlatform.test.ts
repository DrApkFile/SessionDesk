import { describe, expect, it } from "vitest";
import { memberHash } from "../../src/core/namespace.js";
import { PLATFORMS, userKey, type Platform } from "../../src/platform/platform.js";
import { harness, type Harness } from "../support/memberHarness.js";

const SECRET = "f".repeat(64);

interface PlatformFixture {
  readonly platform: Platform;
  readonly community: string;
  readonly member: string;
  readonly helper: string;
  readonly manager: string;
}

const FIXTURES: readonly PlatformFixture[] = [
  { platform: "telegram", community: "-1004421971121", member: "42000001", helper: "42000002", manager: "4242" },
  { platform: "discord", community: "222222222222222222", member: "333333333333333333", helper: "444444444444444444", manager: "555555555555555555" },
  { platform: "slack", community: "C024BE91L", member: "U024BE7LH", helper: "U024BE7LJ", manager: "U024BE7LK" },
];

function field(fixture: PlatformFixture, options: Parameters<typeof harness>[0] = {}): Harness {
  return harness({
    platform: fixture.platform,
    communityChatId: fixture.community,
    managerKeys: [userKey(fixture.platform, fixture.manager)],
    ...options,
  });
}

describe.each(FIXTURES)("the same behaviour on $platform", (fixture) => {
  it("stores consent under a hash derived from this platform's id", () => {
    const run = field(fixture);
    const outcome = run.service.consentFromTap({
      platform: fixture.platform,
      userId: fixture.member,
      chatId: fixture.community,
      chatKind: "community",
      messageId: "1",
      scope: "storage",
    });
    expect(outcome.wrote).toBe(true);
    const expected = memberHash(SECRET, { platform: fixture.platform, id: fixture.member });
    expect(run.cache.state().members.get(expected)?.consented).toBe(true);
    expect(run.cache.memoriesOf(expected)).toHaveLength(1);
  });

  it("stores nothing for a member who has not agreed, and says nothing unless addressed", async () => {
    const run = field(fixture, { classification: '{"kind":"bug","themeLabel":"login"}' });
    const quiet = await run.service.handle(run.message({ userId: fixture.member, text: "login is broken" }));
    expect(quiet.kind).toBe("silent");
    expect(run.cache.size()).toBe(0);
    const asked = await run.service.handle(run.message({ userId: fixture.member, text: "login is broken", mentionsBot: true }));
    expect(asked.kind).toBe("reply");
    expect(run.cache.size()).toBe(0);
  });

  it("opens an item once the member has agreed", async () => {
    const run = field(fixture, { classification: '{"kind":"bug","themeLabel":"login"}', replyText: "Filed." });
    run.service.recordConsent(fixture.member, fixture.member, "1", "storage", fixture.platform);
    await run.service.handle(run.message({ userId: fixture.member, text: "login is broken", mentionsBot: true }));
    const items = [...run.cache.state().items.values()];
    expect(items).toHaveLength(1);
    expect(items[0]?.openedByH).toBe(memberHash(SECRET, { platform: fixture.platform, id: fixture.member }));
  });

  it("credits a thanks to the member who was replied to", async () => {
    const run = field(fixture, { classification: '{"kind":"thanks"}', replyText: "Noted." });
    run.service.recordConsent(fixture.member, fixture.member, "1", "storage", fixture.platform);
    run.service.recordConsent(fixture.helper, fixture.helper, "2", "storage", fixture.platform);
    await run.service.handle(run.message({ userId: fixture.member, text: "thanks, that worked", replyToUserId: fixture.helper, mentionsBot: true }));
    const helperH = memberHash(SECRET, { platform: fixture.platform, id: fixture.helper });
    expect(run.cache.state().members.get(helperH)?.points).toBe(2);
  });

  it("answers /mydata in plain language with no ids", async () => {
    const run = field(fixture, { classification: '{"kind":"bug","themeLabel":"login"}', replyText: "Filed." });
    run.service.recordConsent(fixture.member, fixture.member, "1", "storage", fixture.platform);
    await run.service.handle(run.message({ userId: fixture.member, chatKind: "direct", chatId: fixture.member, messageId: "2", text: "login is broken" }));
    await run.queue.settled();
    const action = await run.service.handle(run.message({ userId: fixture.member, chatKind: "direct", chatId: fixture.member, messageId: "3", text: "/mydata" }));
    expect(action.kind === "reply" && action.text).toContain("Here is everything I remember about you");
    expect(action.kind === "reply" && action.text).toContain('You reported: "login is broken"');
    expect(action.kind === "reply" && action.text).not.toMatch(/status=|tier:|\b[ipta]-[0-9a-f]{3,}\b/);
  });

  it("lets this platform's manager run /optin and nobody else", async () => {
    const run = field(fixture);
    const byManager = await run.service.handle(run.message({ userId: fixture.manager, text: "/optin" }));
    expect(byManager.kind === "reply" && byManager.pin).toBe(true);
    const byMember = await run.service.handle(run.message({ userId: fixture.member, text: "/optin" }));
    expect(byMember.kind).toBe("silent");
  });

  it("ignores a tap that came from another chat on this platform", () => {
    const run = field(fixture);
    const outcome = run.service.consentFromTap({
      platform: fixture.platform,
      userId: fixture.member,
      chatId: "somewhere-else",
      chatKind: "community",
      messageId: "1",
      scope: "storage",
    });
    expect(outcome).toEqual({ ignored: true, wrote: false, alert: "" });
    expect(run.cache.size()).toBe(0);
  });
});

describe("two platforms never share a member", () => {
  it("gives the same raw id a different namespace on each platform", () => {
    const hashes = PLATFORMS.map((platform) => memberHash(SECRET, { platform, id: "42000001" }));
    expect(new Set(hashes).size).toBe(PLATFORMS.length);
  });

  it("keeps consent on one platform from counting on another", () => {
    const telegram = FIXTURES[0];
    const discord = FIXTURES[1];
    expect(telegram).toBeDefined();
    expect(discord).toBeDefined();
    if (telegram === undefined || discord === undefined) return;
    const run = field(telegram);
    run.service.consentFromTap({ platform: "telegram", userId: "42000001", chatId: telegram.community, chatKind: "community", messageId: "1", scope: "storage" });
    const telegramH = memberHash(SECRET, { platform: "telegram", id: "42000001" });
    const discordH = memberHash(SECRET, { platform: "discord", id: "42000001" });
    expect(run.cache.state().members.get(telegramH)?.consented).toBe(true);
    expect(run.cache.state().members.get(discordH)).toBeUndefined();
  });

  it("covers every platform the code knows about", () => {
    expect(FIXTURES.map((fixture) => fixture.platform).sort()).toEqual([...PLATFORMS].sort());
  });
});
