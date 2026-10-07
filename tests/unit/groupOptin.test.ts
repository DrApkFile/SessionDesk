import { describe, expect, it } from "vitest";
import { CONSENT_PREFIX, consentKeyboard } from "../../src/bots/member/telegram.js";
import {
  CONSENT_NOTICE,
  DM_START_PAYLOAD,
  GROUP_OPTIN_NOTICE,
  GROUP_OPTIN_PROMPT,
  TAP_ALREADY,
  dmStartLink,
  tapNeedsDmStart,
  tapWelcome,
} from "../../src/bots/member/notices.js";
import { consentKey, dmAddressKey } from "../../src/core/idempotency.js";
import { GROUP_CHAT_ID, MANAGER_ID, harness, type Harness } from "../support/memberHarness.js";

const MEMBER = 42_000_001;
const OTHER_GROUP = -1009999999999;

function tap(field: Harness, scope: "storage" | "storage_and_dm", overrides: { chatId?: number; chatType?: "private" | "supergroup"; userId?: number } = {}) {
  return field.service.consentFromTap({
    userId: overrides.userId ?? MEMBER,
    chatId: overrides.chatId ?? GROUP_CHAT_ID,
    chatType: overrides.chatType ?? "supergroup",
    messageId: 77,
    scope,
  });
}

describe("a manager posts the opt-in notice in the group", () => {
  it("posts and pins a notice with the two agree buttons", async () => {
    const field = harness();
    const action = await field.service.handle(field.message({ userId: MANAGER_ID, userName: "boss", text: "/optin" }));
    expect(action).toEqual({ kind: "reply", text: GROUP_OPTIN_NOTICE, offerConsent: true, pin: true });
    expect(field.logLines.join("\n")).toContain("optin_posted");
  });

  it("says what it remembers, where, that it is permanent, and what never to share", () => {
    expect(GROUP_OPTIN_NOTICE).toContain("encrypted on Walrus");
    expect(GROUP_OPTIN_NOTICE).toContain("permanent");
    expect(GROUP_OPTIN_NOTICE).toContain("cannot be deleted once written");
    expect(GROUP_OPTIN_NOTICE).toContain("Never share a key, password, phone number or email");
    expect(GROUP_OPTIN_NOTICE).toContain("/mydata");
  });

  it("ignores /optin from anyone who is not a manager", async () => {
    const field = harness();
    const action = await field.service.handle(field.message({ userId: MEMBER, text: "/optin" }));
    expect(action.kind).toBe("silent");
    expect(field.cache.size()).toBe(0);
    expect(field.logLines.join("\n")).toContain("not a manager");
  });

  it("ignores /optin in a group that is not this community", async () => {
    const field = harness();
    const action = await field.service.handle(field.message({ userId: MANAGER_ID, chatId: OTHER_GROUP, text: "/optin" }));
    expect(action.kind).toBe("silent");
  });

  it("shows the direct-message notice when a manager runs /optin in a DM", async () => {
    const field = harness();
    const action = await field.service.handle(field.message({ userId: MANAGER_ID, chatId: MANAGER_ID, chatType: "private", text: "/optin" }));
    expect(action).toEqual({ kind: "reply", text: CONSENT_NOTICE, offerConsent: true });
  });
});

describe("tapping I agree in the group", () => {
  it("writes storage consent under the tapper's own namespace hash", () => {
    const field = harness();
    const outcome = tap(field, "storage");
    expect(outcome).toEqual({ ignored: false, wrote: true, alert: tapWelcome("sdmemberbot") });
    const memberH = field.service.memberHashOf(MEMBER);
    const held = field.cache.memoriesOf(memberH);
    expect(held).toHaveLength(1);
    expect(held[0]?.event).toMatchObject({ type: "CONSENT_GIVEN", scope: "storage" });
    expect(held[0]?.namespace).toBe(`sd-c1-m-${memberH}`);
    expect(field.cache.state().members.get(memberH)?.consented).toBe(true);
    expect(field.cache.state().members.get(memberH)?.dmConsent).toBe(false);
  });

  it("writes nothing on a second tap and says they are already in", () => {
    const field = harness();
    tap(field, "storage");
    const writesAfterFirst = field.memory.writeCalls.length;
    const again = tap(field, "storage");
    expect(again).toEqual({ ignored: false, wrote: false, alert: TAP_ALREADY });
    expect(field.cache.memoriesOf(field.service.memberHashOf(MEMBER))).toHaveLength(1);
    expect(field.memory.writeCalls).toHaveLength(writesAfterFirst);
    expect(field.logLines.join("\n")).toContain("tap_duplicate");
  });

  it("uses an idempotency key built from the hash and the scope, not the message", async () => {
    const field = harness();
    tap(field, "storage");
    await field.queue.settled();
    const memberH = field.service.memberHashOf(MEMBER);
    expect(field.memory.writeCalls[0]?.idempotencyKey).toBeDefined();
    expect(consentKey("c1", memberH, "storage")).not.toBe(consentKey("c1", memberH, "storage_and_dm"));
    expect(dmAddressKey("c1", memberH)).not.toBe(consentKey("c1", memberH, "storage"));
  });

  it("ignores a tap that came from any other chat", () => {
    const field = harness();
    const outcome = tap(field, "storage", { chatId: OTHER_GROUP });
    expect(outcome).toEqual({ ignored: true, wrote: false, alert: "" });
    expect(field.cache.size()).toBe(0);
    expect(field.logLines.join("\n")).toContain("not the community chat");
  });

  it("tells each tapper only, with no user id in the alert", () => {
    const field = harness();
    const outcome = tap(field, "storage");
    expect(outcome.alert).not.toContain(String(MEMBER));
    expect(outcome.alert).toContain("/mydata");
  });
});

describe("tapping I agree + DMs in the group", () => {
  it("records storage consent and asks for one more tap, because Telegram needs Start first", () => {
    const field = harness();
    const outcome = tap(field, "storage_and_dm");
    expect(outcome.wrote).toBe(true);
    expect(outcome.alert).toBe(tapNeedsDmStart("sdmemberbot"));
    const memberH = field.service.memberHashOf(MEMBER);
    expect(field.cache.state().members.get(memberH)?.dmConsent).toBe(false);
    expect(field.cache.state().members.get(memberH)?.dmUserId).toBeNull();
    expect(field.cache.memoriesOf(memberH).map((line) => line.event.type)).toEqual(["CONSENT_GIVEN"]);
  });

  it("honours the DM scope straight away when the tap came from a direct message", () => {
    const field = harness();
    const outcome = tap(field, "storage_and_dm", { chatId: MEMBER, chatType: "private" });
    expect(outcome.wrote).toBe(true);
    const memberH = field.service.memberHashOf(MEMBER);
    expect(field.cache.state().members.get(memberH)?.dmConsent).toBe(true);
    expect(field.cache.state().members.get(memberH)?.dmUserId).toBe(MEMBER);
  });

  it("offers a deep link that carries the dm payload", () => {
    expect(dmStartLink("sdmemberbot")).toBe("https://t.me/sdmemberbot?start=dm");
    expect(DM_START_PAYLOAD).toBe("dm");
  });
});

describe("/start dm upgrades a member who opted in from the group", () => {
  it("writes the DM scope and the DM address", async () => {
    const field = harness();
    tap(field, "storage_and_dm");
    const memberH = field.service.memberHashOf(MEMBER);
    const action = await field.service.handle(field.message({ userId: MEMBER, chatId: MEMBER, chatType: "private", messageId: 5, text: "/start dm" }));
    expect(action.kind).toBe("reply");
    const types = field.cache.memoriesOf(memberH).map((line) => line.event.type);
    expect(types).toEqual(["CONSENT_GIVEN", "CONSENT_GIVEN", "DM_ADDRESS"]);
    expect(field.cache.state().members.get(memberH)?.dmConsent).toBe(true);
    expect(field.cache.state().members.get(memberH)?.dmUserId).toBe(MEMBER);
  });

  it("works for someone who has never opted in at all", async () => {
    const field = harness();
    const memberH = field.service.memberHashOf(MEMBER);
    await field.service.handle(field.message({ userId: MEMBER, chatId: MEMBER, chatType: "private", messageId: 5, text: "/start dm" }));
    expect(field.cache.state().members.get(memberH)?.dmConsent).toBe(true);
    expect(field.cache.state().members.get(memberH)?.dmUserId).toBe(MEMBER);
  });

  it("changes nothing when they already have DMs on", async () => {
    const field = harness();
    tap(field, "storage_and_dm", { chatId: MEMBER, chatType: "private" });
    const memberH = field.service.memberHashOf(MEMBER);
    const before = field.cache.memoriesOf(memberH).length;
    await field.service.handle(field.message({ userId: MEMBER, chatId: MEMBER, chatType: "private", messageId: 6, text: "/start dm" }));
    expect(field.cache.memoriesOf(memberH)).toHaveLength(before);
  });

  it("still shows the notice for a plain /start", async () => {
    const field = harness();
    const action = await field.service.handle(field.message({ userId: MEMBER, chatId: MEMBER, chatType: "private", text: "/start" }));
    expect(action).toEqual({ kind: "reply", text: CONSENT_NOTICE, offerConsent: true });
  });
});

describe("the buttons and the log keep user ids out", () => {
  it("keeps callback data well under Telegram's 64 byte limit and free of ids", () => {
    const keyboard = consentKeyboard("sdmemberbot").inline_keyboard;
    const dataButtons = keyboard.flat().filter((button) => "callback_data" in button);
    expect(dataButtons).toHaveLength(2);
    for (const button of dataButtons) {
      const data = "callback_data" in button ? button.callback_data : "";
      expect(Buffer.byteLength(data, "utf8")).toBeLessThan(64);
      expect(data.startsWith(CONSENT_PREFIX)).toBe(true);
      expect(data).not.toMatch(/\d{6,}/);
    }
    const urlButtons = keyboard.flat().filter((button) => "url" in button);
    expect(urlButtons).toHaveLength(1);
  });

  it("never writes a user id into a log line for any opt-in path", async () => {
    const field = harness();
    await field.service.handle(field.message({ userId: MANAGER_ID, text: "/optin" }));
    tap(field, "storage");
    tap(field, "storage");
    tap(field, "storage", { chatId: OTHER_GROUP });
    await field.service.handle(field.message({ userId: MEMBER, chatId: MEMBER, chatType: "private", messageId: 9, text: "/start dm" }));
    expect(field.logLines.length).toBeGreaterThan(3);
    for (const written of field.logLines) expect(written).not.toContain(String(MEMBER));
  });

  it("shows the same two buttons to a non-consented member who mentions the bot", async () => {
    const field = harness();
    const action = await field.service.handle(field.message({ userId: MEMBER, text: "@sdmemberbot hello", mentionsBot: true }));
    expect(action).toEqual({ kind: "reply", text: GROUP_OPTIN_PROMPT, offerConsent: true });
  });
});
