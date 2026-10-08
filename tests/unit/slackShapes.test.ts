import { describe, expect, it } from "vitest";
import { SLACK_REQUIRED_SCOPES, chatKindOfSlack, mentionsSlackBot, missingScopes, scopeFix, strippedSlackText } from "../../src/platform/slack/shapes.js";
import { consentBlocks, isThreadReply, scopeOfAction, toSlackIncoming } from "../../src/platform/slack/start.js";

const BOT = "U0BOT0001";
const COMMUNITY = "C024BE91L";

describe("reading a Slack message into the neutral shape", () => {
  it("calls an im direct, the configured channel community, and anything else other", () => {
    expect(chatKindOfSlack({ channelType: "im", channelId: "D123", communityChannelId: COMMUNITY })).toBe("direct");
    expect(chatKindOfSlack({ channelType: "mpim", channelId: "G123", communityChannelId: COMMUNITY })).toBe("direct");
    expect(chatKindOfSlack({ channelType: "channel", channelId: COMMUNITY, communityChannelId: COMMUNITY })).toBe("community");
    expect(chatKindOfSlack({ channelType: "channel", channelId: "C999", communityChannelId: COMMUNITY })).toBe("other");
  });

  it("treats a DM as addressed to the bot, and a channel only when mentioned", () => {
    expect(mentionsSlackBot("hello", BOT, true)).toBe(true);
    expect(mentionsSlackBot(`hey <@${BOT}> help`, BOT, false)).toBe(true);
    expect(mentionsSlackBot("talking to someone else", BOT, false)).toBe(false);
  });

  it("strips the mention before the classifier sees it", () => {
    expect(strippedSlackText(`<@${BOT}> login is broken`, BOT)).toBe("login is broken");
  });

  it("builds a neutral message with string ids and the slack timestamp as the message id", () => {
    const incoming = toSlackIncoming({ channel: COMMUNITY, channel_type: "channel", ts: "1760000000.000100", user: "U024BE7LH", text: `<@${BOT}> login is broken` }, BOT, COMMUNITY);
    expect(incoming).toEqual({
      platform: "slack",
      chatId: COMMUNITY,
      chatKind: "community",
      messageId: "1760000000.000100",
      userId: "U024BE7LH",
      isBot: false,
      userName: null,
      text: "login is broken",
      mentionsBot: true,
      replyToUserId: null,
      replyToIsBot: false,
      replyToText: null,
    });
  });

  it("ignores a message with no text or no user, and marks a bot post as a bot", () => {
    expect(toSlackIncoming({ channel: COMMUNITY, ts: "1", user: "U1", text: "" }, BOT, COMMUNITY)).toBeNull();
    expect(toSlackIncoming({ channel: COMMUNITY, ts: "1", text: "hello" }, BOT, COMMUNITY)).toBeNull();
    expect(toSlackIncoming({ channel: COMMUNITY, ts: "1", user: "U1", text: "hi", bot_id: "B1" }, BOT, COMMUNITY)?.isBot).toBe(true);
  });
});

describe("Slack scopes are checked, not assumed", () => {
  it("names every scope the adapter needs", () => {
    expect([...SLACK_REQUIRED_SCOPES]).toEqual(["app_mentions:read", "channels:history", "chat:write", "im:history", "im:write", "pins:write", "users:read"]);
  });

  it("reports exactly what is missing and where to add it", () => {
    expect(missingScopes([...SLACK_REQUIRED_SCOPES])).toEqual([]);
    const missing = missingScopes(["chat:write"]);
    expect(missing).toContain("im:write");
    expect(scopeFix(missing)).toContain("OAuth & Permissions");
    expect(scopeFix(missing)).toContain("reinstall");
  });
});

describe("Slack buttons carry the same callbacks as every other platform", () => {
  it("offers both consent buttons and a link, with callbacks under Slack's limits", () => {
    const blocks = consentBlocks("Tap below", "sessiondesk");
    expect(blocks).toHaveLength(2);
    const actions = blocks[1] as { elements: Array<{ action_id: string; url?: string }> };
    expect(actions.elements.map((element) => element.action_id)).toEqual(["consent:storage", "consent:storage_and_dm", "open_dms"]);
    for (const element of actions.elements) expect(Buffer.byteLength(element.action_id, "utf8")).toBeLessThan(256);
    expect(actions.elements[2]?.url).toBe("https://t.me/sessiondesk?start=dm");
  });

  it("reads the scope back out of an action id and refuses anything else", () => {
    expect(scopeOfAction("consent:storage")).toBe("storage");
    expect(scopeOfAction("consent:storage_and_dm")).toBe("storage_and_dm");
    expect(scopeOfAction("consent:nonsense")).toBeNull();
    expect(scopeOfAction("open_dms")).toBeNull();
  });
});

describe("a Slack thread reply carries the message it answers", () => {
  it("knows a thread reply from a top-level message", () => {
    expect(isThreadReply({ channel: COMMUNITY, ts: "2.0", thread_ts: "1.0" })).toBe(true);
    expect(isThreadReply({ channel: COMMUNITY, ts: "1.0", thread_ts: "1.0" })).toBe(false);
    expect(isThreadReply({ channel: COMMUNITY, ts: "1.0" })).toBe(false);
  });

  it("fills replyToUserId and replyToText from the parent, so a manager answer can be captured", () => {
    const incoming = toSlackIncoming(
      { channel: COMMUNITY, channel_type: "channel", ts: "2.0", thread_ts: "1.0", user: "U0MANAGER", text: "Open settings, then Reset." },
      BOT,
      COMMUNITY,
      { user: "U024BE7LH", text: "how do I reset my password?" },
    );
    expect(incoming?.replyToUserId).toBe("U024BE7LH");
    expect(incoming?.replyToText).toBe("how do I reset my password?");
    expect(incoming?.replyToIsBot).toBe(false);
  });

  it("strips a mention out of the parent text too", () => {
    const incoming = toSlackIncoming(
      { channel: COMMUNITY, ts: "2.0", thread_ts: "1.0", user: "U1", text: "yes" },
      BOT,
      COMMUNITY,
      { user: "U2", text: `<@${BOT}> is the login fixed?` },
    );
    expect(incoming?.replyToText).toBe("is the login fixed?");
  });

  it("counts a reply to the bot as addressing the bot, and marks it as a bot", () => {
    const incoming = toSlackIncoming({ channel: COMMUNITY, ts: "2.0", thread_ts: "1.0", user: "U1", text: "no" }, BOT, COMMUNITY, { user: BOT, text: "This came up before." });
    expect(incoming?.mentionsBot).toBe(true);
    expect(incoming?.replyToIsBot).toBe(true);
  });

  it("leaves reply fields empty for a top-level message", () => {
    const incoming = toSlackIncoming({ channel: COMMUNITY, ts: "1.0", user: "U1", text: "hello" }, BOT, COMMUNITY);
    expect(incoming?.replyToUserId).toBeNull();
    expect(incoming?.replyToText).toBeNull();
  });
});
