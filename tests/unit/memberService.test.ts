import { describe, expect, it } from "vitest";
import { ERRORS } from "../../src/core/errors.js";
import { CONSENT_IN_GROUP, CONSENT_NOTICE, HELD_FOR_CLASSIFIER, SECRET_WARNING } from "../../src/bots/member/notices.js";
import { GROUP_CHAT_ID, SECRET_PHRASE, harness } from "../support/memberHarness.js";

const MEMBER = 42_000_001;
const HELPER = 42_000_002;

describe("F13 nothing is stored about a member who has not agreed", () => {
  it("stays silent in the group and stores nothing", async () => {
    const field = harness({ classification: '{"kind":"bug","themeLabel":"android login"}' });
    const action = await field.service.handle(field.message({ text: "android login fails" }));
    expect(action.kind).toBe("silent");
    expect(field.cache.size()).toBe(0);
    expect(field.memory.writeCalls).toHaveLength(0);
  });

  it("offers the consent notice when mentioned in the group, and still stores nothing", async () => {
    const field = harness({ classification: '{"kind":"bug"}' });
    const action = await field.service.handle(field.message({ text: "@sdmemberbot android login fails", mentionsBot: true }));
    expect(action).toEqual({ kind: "reply", text: CONSENT_IN_GROUP, offerConsent: false });
    expect(field.cache.size()).toBe(0);
  });

  it("shows the notice with the agree button in a direct message", async () => {
    const field = harness();
    const action = await field.service.handle(field.message({ chatId: MEMBER, chatType: "private", text: "hello" }));
    expect(action).toEqual({ kind: "reply", text: CONSENT_NOTICE, offerConsent: true });
    expect(CONSENT_NOTICE).toContain("cannot delete them");
    expect(field.cache.size()).toBe(0);
  });

  it("records consent with the scope the member chose", async () => {
    const field = harness();
    const action = field.service.recordConsent(MEMBER, MEMBER, 2, "storage_and_dm");
    expect(action.kind).toBe("reply");
    const memberH = field.service.memberHashOf(MEMBER);
    expect(field.cache.state().members.get(memberH)?.consented).toBe(true);
    expect(field.cache.state().members.get(memberH)?.dmConsent).toBe(true);
    expect(field.service.recordConsent(MEMBER, MEMBER, 3, "storage").kind).toBe("reply");
    expect(field.cache.memoriesOf(memberH)).toHaveLength(1);
  });
});

describe("F18 the bot does not fill the group", () => {
  it("stores a consented member's message but says nothing unless mentioned", async () => {
    const field = harness({ classification: '{"kind":"bug","themeLabel":"android login"}' });
    field.service.recordConsent(MEMBER, MEMBER, 1, "storage");
    const action = await field.service.handle(field.message({ text: "android login fails on 2.3" }));
    expect(action.kind).toBe("silent");
    expect([...field.cache.state().items.values()]).toHaveLength(1);
  });

  it("answers in the group when mentioned", async () => {
    const field = harness({ classification: '{"kind":"question","themeLabel":"android login"}', replyText: "I have nothing filed on that yet." });
    field.service.recordConsent(MEMBER, MEMBER, 1, "storage");
    const action = await field.service.handle(field.message({ text: "@sdmemberbot any news?", mentionsBot: true }));
    expect(action.kind).toBe("reply");
  });

  it("always answers a direct message", async () => {
    const field = harness({ classification: '{"kind":"chit_chat"}', replyText: "Hello." });
    field.service.recordConsent(MEMBER, MEMBER, 1, "storage");
    const action = await field.service.handle(field.message({ chatId: MEMBER, chatType: "private", text: "hi" }));
    expect(action.kind).toBe("reply");
  });

  it("ignores other bots, channel posts and chats that are not this community", async () => {
    const field = harness();
    expect((await field.service.handle(field.message({ isBot: true }))).kind).toBe("silent");
    expect((await field.service.handle(field.message({ chatType: "channel" }))).kind).toBe("silent");
    expect((await field.service.handle(field.message({ chatId: -100999, mentionsBot: true }))).kind).toBe("silent");
  });
});

describe("F01 the member is answered before walrus has the write", () => {
  it("replies while the line is still saving", async () => {
    const field = harness({ classification: '{"kind":"bug","themeLabel":"login"}', replyText: "Filed.", memory: { writeDelayMs: 40 } });
    field.service.recordConsent(MEMBER, MEMBER, 1, "storage");
    const memberH = field.service.memberHashOf(MEMBER);
    const started = Date.now();
    const action = await field.service.handle(field.message({ chatId: MEMBER, chatType: "private", text: "android login fails" }));
    expect(action.kind).toBe("reply");
    expect(Date.now() - started).toBeLessThan(40);
    expect(field.cache.memoriesOf(memberH).some((line) => line.state === "saving")).toBe(true);
    await field.queue.settled();
    expect(field.cache.memoriesOf(memberH).every((line) => line.state === "saved")).toBe(true);
  });
});

describe("F03 memory unavailable is said out loud", () => {
  it("never answers as if the member were new", async () => {
    const field = harness({ classification: '{"kind":"question"}' });
    field.service.recordConsent(MEMBER, MEMBER, 1, "storage");
    field.health.markUnavailable(field.namespaceOfMember(MEMBER));
    const writesBefore = field.memory.writeCalls.length;
    const action = await field.service.handle(field.message({ chatId: MEMBER, chatType: "private", text: "what do you know about me?" }));
    expect(action).toEqual({ kind: "reply", text: ERRORS.MEMORY_UNAVAILABLE.message, offerConsent: false });
    expect(action.kind === "reply" && action.text).not.toContain("agree");
    expect(field.memory.writeCalls).toHaveLength(writesBefore);
  });

  it("says nothing in the group unless it was addressed", async () => {
    const field = harness();
    field.health.markUnavailable(field.namespaceOfMember(MEMBER));
    expect((await field.service.handle(field.message({ text: "hello" }))).kind).toBe("silent");
    expect((await field.service.handle(field.message({ text: "@sdmemberbot hello", mentionsBot: true }))).kind).toBe("reply");
  });
});

describe("F08 and F09 a model that is down or wrong changes nothing", () => {
  it("holds the message, says it is not stored yet, and still answers from the ledger", async () => {
    const field = harness({ modelStatus: 503 });
    field.service.recordConsent(MEMBER, MEMBER, 1, "storage");
    const action = await field.service.handle(field.message({ chatId: MEMBER, chatType: "private", text: "any news on my bug?" }));
    expect(action.kind === "reply" && action.text).toContain(HELD_FOR_CLASSIFIER);
    expect(action.kind === "reply" && action.text).toContain("nothing filed for you yet");
    expect(field.pending.waiting()).toBe(1);
    expect(field.logLines.join("\n")).toContain("classify_deferred");
  });

  it("hands over the whole facts sheet while the message waits for a classifier", async () => {
    const field = harness({ classification: '{"kind":"bug","themeLabel":"login"}', replyText: "Filed." });
    field.service.recordConsent(MEMBER, MEMBER, 1, "storage");
    await field.service.handle(field.message({ chatId: MEMBER, chatType: "private", messageId: 2, text: "android login fails" }));
    field.breakModel();
    const action = await field.service.handle(field.message({ chatId: MEMBER, chatType: "private", messageId: 3, text: "news?" }));
    expect(action.kind === "reply" && action.text).toContain("status=reported");
    expect(action.kind === "reply" && action.text).toContain(HELD_FOR_CLASSIFIER);
  });

  it("stores nothing it could not classify rather than inventing a kind", async () => {
    const field = harness({ classification: '{"kind":"not-a-kind"}' });
    field.service.recordConsent(MEMBER, MEMBER, 1, "storage");
    await field.service.handle(field.message({ chatId: MEMBER, chatType: "private", text: "android login fails" }));
    expect([...field.cache.state().items.values()]).toHaveLength(0);
    expect(field.logLines.join("\n")).toContain("classify_refused");
  });

  it("drops a reply that claims a status it has no record of", async () => {
    const field = harness({ classification: '{"kind":"question","themeLabel":"login"}', replyText: "Good news, that bug is verified and closed." });
    field.service.recordConsent(MEMBER, MEMBER, 1, "storage");
    const action = await field.service.handle(field.message({ chatId: MEMBER, chatType: "private", text: "is my bug done?" }));
    expect(action.kind === "reply" && action.text).toContain(ERRORS.MODEL_OUTPUT_REFUSED.message);
    expect(action.kind === "reply" && action.text).not.toContain("verified and closed");
    expect(field.logLines.join("\n")).toContain("reply_refused");
  });
});

describe("F10 a pasted secret is blocked and the member is warned", () => {
  it("warns and stores nothing, in a direct message and in the group", async () => {
    const field = harness({ classification: '{"kind":"bug"}' });
    field.service.recordConsent(MEMBER, MEMBER, 1, "storage");
    const direct = await field.service.handle(field.message({ chatId: MEMBER, chatType: "private", text: `my login is ${SECRET_PHRASE}` }));
    expect(direct).toEqual({ kind: "reply", text: SECRET_WARNING, offerConsent: false });
    const group = await field.service.handle(field.message({ text: `here it is ${SECRET_PHRASE}` }));
    expect(group).toEqual({ kind: "reply", text: SECRET_WARNING, offerConsent: false });
    expect(field.memory.writeCalls).toHaveLength(1);
    expect(field.memory.writeCalls[0]?.text).toContain("CONSENT_GIVEN");
  });
});

describe("thanks credit the member who helped", () => {
  it("stores a contribution in the helper's namespace, once per pair per day", async () => {
    const field = harness({ classification: '{"kind":"thanks"}', replyText: "Noted." });
    field.service.recordConsent(MEMBER, MEMBER, 1, "storage");
    field.service.recordConsent(HELPER, HELPER, 2, "storage");
    const helperH = field.service.memberHashOf(HELPER);
    await field.service.handle(field.message({ text: "thanks, that fixed it", replyToUserId: HELPER, mentionsBot: true }));
    expect(field.cache.state().members.get(helperH)?.points).toBe(2);
    await field.service.handle(field.message({ messageId: 9, text: "thanks again", replyToUserId: HELPER, mentionsBot: true }));
    expect(field.cache.state().members.get(helperH)?.points).toBe(2);
  });

  it("credits nobody when the thanks replies to a member who never agreed", async () => {
    const field = harness({ classification: '{"kind":"thanks"}', replyText: "Noted." });
    field.service.recordConsent(MEMBER, MEMBER, 1, "storage");
    await field.service.handle(field.message({ text: "thanks", replyToUserId: HELPER, mentionsBot: true }));
    expect(field.cache.state().members.get(field.service.memberHashOf(HELPER))).toBeUndefined();
  });

  it("credits nobody for thanking the bot or yourself", async () => {
    const field = harness({ classification: '{"kind":"thanks"}', replyText: "Noted." });
    field.service.recordConsent(MEMBER, MEMBER, 1, "storage");
    await field.service.handle(field.message({ text: "thanks bot", replyToUserId: 999, replyToIsBot: true, mentionsBot: true }));
    await field.service.handle(field.message({ messageId: 8, text: "thanks me", replyToUserId: MEMBER, mentionsBot: true }));
    expect(field.cache.state().members.get(field.service.memberHashOf(MEMBER))?.points).toBe(0);
  });
});

describe("member commands", () => {
  it("/mydata shows every line with saving, then the walrus receipt", async () => {
    const field = harness({ classification: '{"kind":"bug","themeLabel":"login"}', replyText: "Filed.", memory: { writeDelayMs: 20 } });
    field.service.recordConsent(MEMBER, MEMBER, 1, "storage");
    await field.service.handle(field.message({ chatId: MEMBER, chatType: "private", messageId: 2, text: "android login fails" }));
    const saving = await field.service.handle(field.message({ chatId: MEMBER, chatType: "private", messageId: 3, text: "/mydata" }));
    expect(saving.kind === "reply" && saving.text).toContain("saving to Walrus now");
    await field.queue.settled();
    const saved = await field.service.handle(field.message({ chatId: MEMBER, chatType: "private", messageId: 4, text: "/mydata" }));
    expect(saved.kind === "reply" && saved.text).toContain("https://walruscan.com/mainnet/blob/");
    expect(saved.kind === "reply" && saved.text).toContain("you filed");
    expect(saved.kind === "reply" && saved.text).toContain("cannot be deleted");
  });

  it("/mydata shows a failed write as failed", async () => {
    const field = harness({ classification: '{"kind":"chit_chat"}', memory: { failWritesBefore: 99 } });
    field.service.recordConsent(MEMBER, MEMBER, 1, "storage");
    await field.queue.settled();
    const action = await field.service.handle(field.message({ chatId: MEMBER, chatType: "private", messageId: 3, text: "/mydata" }));
    expect(action.kind === "reply" && action.text).toContain("FAILED to save");
    expect(action.kind === "reply" && action.text).not.toContain("saved https");
  });

  it("/mydata says plainly when it holds nothing", async () => {
    const field = harness();
    const action = await field.service.handle(field.message({ chatId: MEMBER, chatType: "private", text: "/mydata" }));
    expect(action.kind === "reply" && action.text).toContain("nothing about you yet");
  });

  it("/correct records a correction for a line the member owns", async () => {
    const field = harness({ classification: '{"kind":"profile","profile":{"field":"role","value":"designer"}}', replyText: "Noted." });
    field.service.recordConsent(MEMBER, MEMBER, 1, "storage");
    const memberH = field.service.memberHashOf(MEMBER);
    await field.service.handle(field.message({ chatId: MEMBER, chatType: "private", messageId: 2, text: "i am a designer" }));
    expect(field.cache.state().members.get(memberH)?.profile.get("role")).toBe("designer");
    const corrected = await field.service.handle(field.message({ chatId: MEMBER, chatType: "private", messageId: 3, text: "/correct 2 developer" }));
    expect(corrected.kind === "reply" && corrected.text).toContain("role = developer");
    expect(field.cache.state().members.get(memberH)?.profile.get("role")).toBe("developer");
  });

  it("/correct changes nothing for a line that is not theirs or not correctable", async () => {
    const field = harness({ classification: '{"kind":"chit_chat"}' });
    field.service.recordConsent(MEMBER, MEMBER, 1, "storage");
    const unknown = await field.service.handle(field.message({ chatId: MEMBER, chatType: "private", messageId: 2, text: "/correct 99 whatever" }));
    expect(unknown.kind === "reply" && unknown.text).toContain("no line 99 for you");
    const notCorrectable = await field.service.handle(field.message({ chatId: MEMBER, chatType: "private", messageId: 3, text: "/correct 1 whatever" }));
    expect(notCorrectable.kind === "reply" && notCorrectable.text).toContain("not one you can correct");
    const usage = await field.service.handle(field.message({ chatId: MEMBER, chatType: "private", messageId: 4, text: "/correct" }));
    expect(usage.kind === "reply" && usage.text).toContain("Use /correct");
  });

  it("/correct refuses a value that carries a secret", async () => {
    const field = harness({ classification: '{"kind":"profile","profile":{"field":"role","value":"designer"}}' });
    field.service.recordConsent(MEMBER, MEMBER, 1, "storage");
    await field.service.handle(field.message({ chatId: MEMBER, chatType: "private", messageId: 2, text: "i am a designer" }));
    const action = await field.service.handle(field.message({ chatId: MEMBER, chatType: "private", messageId: 3, text: `/correct 2 ${SECRET_PHRASE}` }));
    expect(action).toEqual({ kind: "reply", text: SECRET_WARNING, offerConsent: false });
  });

  it("/help works anywhere and /start in the group points to the direct message", async () => {
    const field = harness();
    const help = await field.service.handle(field.message({ text: "/help" }));
    expect(help.kind === "reply" && help.text).toContain("/mydata");
    const start = await field.service.handle(field.message({ text: "/start" }));
    expect(start.kind === "reply" && start.text).toBe(CONSENT_IN_GROUP);
  });
});
