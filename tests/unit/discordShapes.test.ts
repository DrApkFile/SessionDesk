import { describe, expect, it } from "vitest";
import {
  DISCORD_MESSAGE_CONTENT_INTENT,
  MESSAGE_CONTENT_FIX,
  chatKindOfDiscord,
  hasMessageContentIntent,
  mentionsDiscordBot,
  strippedDiscordText,
} from "../../src/platform/discord/shapes.js";

const BOT = "111111111111111111";
const COMMUNITY = "222222222222222222";

describe("reading a Discord message into the neutral shape", () => {
  it("calls a DM direct, the configured channel community, and anything else other", () => {
    expect(chatKindOfDiscord({ isDirect: true, channelId: "999", communityChannelId: COMMUNITY })).toBe("direct");
    expect(chatKindOfDiscord({ isDirect: false, channelId: COMMUNITY, communityChannelId: COMMUNITY })).toBe("community");
    expect(chatKindOfDiscord({ isDirect: false, channelId: "333333333333333333", communityChannelId: COMMUNITY })).toBe("other");
  });

  it("spots a mention by id, by raw text, and by a reply to the bot", () => {
    expect(mentionsDiscordBot("hello", BOT, [BOT], false)).toBe(true);
    expect(mentionsDiscordBot(`hi <@${BOT}> there`, BOT, [], false)).toBe(true);
    expect(mentionsDiscordBot(`hi <@!${BOT}>`, BOT, [], false)).toBe(true);
    expect(mentionsDiscordBot("no mention", BOT, [], true)).toBe(true);
    expect(mentionsDiscordBot("no mention", BOT, ["444444444444444444"], false)).toBe(false);
  });

  it("strips the mention so the classifier sees what the member actually said", () => {
    expect(strippedDiscordText(`<@${BOT}> android login fails`, BOT)).toBe("android login fails");
    expect(strippedDiscordText(`android <@!${BOT}> login fails`, BOT)).toBe("android login fails");
    expect(strippedDiscordText("nothing to strip", BOT)).toBe("nothing to strip");
  });
});

describe("the Message Content intent is checked, not assumed", () => {
  it("matches the bit discord.js exposes", () => {
    expect(DISCORD_MESSAGE_CONTENT_INTENT).toBe(32_768);
  });

  it("knows when the intent is missing", () => {
    expect(hasMessageContentIntent(DISCORD_MESSAGE_CONTENT_INTENT)).toBe(true);
    expect(hasMessageContentIntent(DISCORD_MESSAGE_CONTENT_INTENT | 1)).toBe(true);
    expect(hasMessageContentIntent(1)).toBe(false);
    expect(hasMessageContentIntent(0)).toBe(false);
  });

  it("says exactly where to turn it on", () => {
    expect(MESSAGE_CONTENT_FIX).toContain("Message Content Intent");
    expect(MESSAGE_CONTENT_FIX).toContain("Privileged Gateway Intents");
  });
});
