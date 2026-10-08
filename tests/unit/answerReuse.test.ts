import { describe, expect, it } from "vitest";
import { encode } from "../../src/core/codec.js";
import { ANSWER_MAX_DISTANCE, KNOWN_ISSUE_MAX_DISTANCE } from "../../src/core/tuning.js";
import { GROUP_CHAT_ID, MANAGER_ID, harness, type Harness } from "../support/memberHarness.js";

const MEMBER = 42_000_001;
const OTHER = 42_000_002;
const ANSWERS_NAMESPACE = "sd-c1-answers";
const ITEMS_NAMESPACE = "sd-c1-items";

function consent(field: Harness, userId: number): void {
  field.service.recordConsent(userId, userId, 1, "storage");
}

async function managerAnswers(field: Harness, question: string, answer: string, messageId = 10): Promise<void> {
  consent(field, MANAGER_ID);
  const proposed = await field.service.handle(
    field.message({ userId: MANAGER_ID, userName: "boss", messageId, text: answer, replyToUserId: MEMBER, replyToText: question, mentionsBot: true }),
  );
  if (proposed.kind === "reply" && proposed.text.includes("Should I reuse")) {
    await field.service.handle(field.message({ userId: MANAGER_ID, userName: "boss", messageId: messageId + 500, text: "yes", mentionsBot: true }));
  }
  await field.queue.settled();
}

describe("an answer given in the group becomes community memory", () => {
  it("stores an ANSWER when a manager replies to a member's question", async () => {
    const field = harness({ classification: '{"kind":"other"}' });
    await managerAnswers(field, "how do I reset my password?", "Open settings, then Account, then Reset.");
    const answers = [...field.cache.state().answers.values()];
    expect(answers).toHaveLength(1);
    expect(answers[0]).toMatchObject({ answeredBy: "manager", state: "active", questionText: "how do I reset my password?", answerText: "Open settings, then Account, then Reset." });
    expect(field.memory.stored.get(ANSWERS_NAMESPACE)).toHaveLength(1);
  });

  it("stores nothing when there is no real question and no real answer", async () => {
    const field = harness({ classification: '{"kind":"other"}' });
    await managerAnswers(field, "nice", "thanks");
    expect(field.cache.state().answers.size).toBe(0);
    expect(field.logLines.join("\n")).toContain("answer_not_captured");
  });

  it("captures a question with no question mark at all", async () => {
    const field = harness({ classification: '{"kind":"other"}' });
    await managerAnswers(field, "how do I reset my password", "Open Settings, then Account, then Reset password.");
    expect(field.cache.state().answers.size).toBe(1);
  });

  it("asks the manager to confirm before keeping an answer, and forgets it on no", async () => {
    const field = harness({ classification: '{"kind":"other"}' });
    consent(field, MANAGER_ID);
    const proposed = await field.service.handle(
      field.message({ userId: MANAGER_ID, messageId: 60, text: "Open Settings, then Account, then Reset.", replyToUserId: MEMBER, replyToText: "how do I reset my password?", mentionsBot: true }),
    );
    expect(proposed.kind === "reply" && proposed.text).toContain("Should I reuse that answer");
    expect(field.cache.state().answers.size).toBe(0);
    const declined = await field.service.handle(field.message({ userId: MANAGER_ID, messageId: 61, text: "no", mentionsBot: true }));
    expect(declined.kind === "reply" && declined.text).toContain("Forgotten");
    expect(field.cache.state().answers.size).toBe(0);
  });

  it("stores nothing when the replier is not a manager", async () => {
    const field = harness({ classification: '{"kind":"other"}' });
    consent(field, MEMBER);
    await field.service.handle(field.message({ userId: MEMBER, text: "try settings", replyToUserId: OTHER, replyToText: "how do I reset it?", mentionsBot: true }));
    expect(field.cache.state().answers.size).toBe(0);
  });

  it("refuses to store an answer whose question carries a secret", async () => {
    const field = harness({ classification: '{"kind":"other"}' });
    await managerAnswers(field, "is my key 0x" + "a".repeat(64) + " valid?", "Never paste a key here.");
    expect(field.cache.state().answers.size).toBe(0);
    expect(field.logLines.join("\n")).toContain("answer_secret_blocked");
  });

  it("stores nothing at all when the manager's own reply carries a secret", async () => {
    const field = harness({ classification: '{"kind":"other"}' });
    await managerAnswers(field, "what is the login?", "use ada@example.com");
    expect(field.cache.state().answers.size).toBe(0);
    expect(field.logLines.join("\n")).toContain("secret_blocked");
  });

  it("stores a member's answer as community memory when it gets thanked", async () => {
    const field = harness({ classification: '{"kind":"thanks"}', replyText: "Noted." });
    consent(field, MEMBER);
    consent(field, OTHER);
    await field.service.handle(
      field.message({ userId: MEMBER, text: "thanks, that worked", replyToUserId: OTHER, replyToText: "clear the cache and sign in again", mentionsBot: true }),
    );
    const answers = [...field.cache.state().answers.values()];
    expect(answers).toHaveLength(1);
    expect(answers[0]).toMatchObject({ answeredBy: "member", answerText: "clear the cache and sign in again", questionText: null });
    expect(field.cache.state().members.get(field.service.memberHashOf(OTHER))?.points).toBe(2);
  });
});

describe("an earlier answer is reused when it clearly matches", () => {
  async function fieldWithAnswer(distance: number): Promise<Harness> {
    const field = harness({ classification: '{"kind":"other"}' });
    await managerAnswers(field, "how do I reset my password?", "Open settings, then Account, then Reset.");
    const stored = field.memory.stored.get(ANSWERS_NAMESPACE) ?? [];
    field.memory.configure({ searchHits: new Map([[ANSWERS_NAMESPACE, stored.map((line) => ({ text: line.text, blobId: line.blobId, distance }))]]) });
    field.classifyAs('{"kind":"question","themeLabel":"passwords"}');
    return field;
  }

  it("replies with the earlier answer, who gave it, the date and a receipt", async () => {
    const field = await fieldWithAnswer(0.1);
    consent(field, MEMBER);
    const action = await field.service.handle(field.message({ userId: MEMBER, chatId: MEMBER, chatType: "private", messageId: 20, text: "how do I reset my password?" }));
    expect(action.kind).toBe("reply");
    if (action.kind !== "reply") return;
    expect(action.text).toContain("This came up before");
    expect(action.text).toContain("a manager answered it on");
    expect(action.text).toContain("Open settings, then Account, then Reset.");
    expect(action.text).toContain("https://walruscan.com/mainnet/blob/");
    expect(action.text).toContain("Did this help?");
    expect(field.logLines.join("\n")).toContain("answer_reused");
  });

  it("answers normally when nothing is near enough", async () => {
    const field = await fieldWithAnswer(ANSWER_MAX_DISTANCE + 0.2);
    consent(field, MEMBER);
    const action = await field.service.handle(field.message({ userId: MEMBER, chatId: MEMBER, chatType: "private", messageId: 21, text: "what is the refund policy?" }));
    expect(action.kind === "reply" && action.text).not.toContain("This came up before");
  });

  it("refuses to choose when two answers are both near enough", async () => {
    const field = harness({ classification: '{"kind":"other"}' });
    await managerAnswers(field, "how do I reset my password?", "Open settings, then Account, then Reset.", 10);
    await managerAnswers(field, "how do I change my password?", "Use the Reset link on the sign-in screen.", 11);
    const stored = field.memory.stored.get(ANSWERS_NAMESPACE) ?? [];
    expect(stored).toHaveLength(2);
    field.memory.configure({ searchHits: new Map([[ANSWERS_NAMESPACE, stored.map((line) => ({ text: line.text, blobId: line.blobId, distance: 0.1 }))]]) });
    field.classifyAs('{"kind":"question","themeLabel":"passwords"}');
    consent(field, MEMBER);
    const action = await field.service.handle(field.message({ userId: MEMBER, chatId: MEMBER, chatType: "private", messageId: 22, text: "how do I reset my password?" }));
    expect(action.kind === "reply" && action.text).not.toContain("This came up before");
  });

  it("never reuses a retired answer", async () => {
    const field = await fieldWithAnswer(0.05);
    const answerId = [...field.cache.state().answers.keys()][0] ?? "";
    field.cache.record({
      seq: 500,
      namespace: ANSWERS_NAMESPACE,
      memberH: null,
      event: { type: "ANSWER_RETIRED", answerId, byManagerId: String(MANAGER_ID), seq: 500, ts: "2026-10-08T10:00:00.000Z" },
      state: "saved",
      blobId: "bretire",
      code: null,
    });
    expect(field.cache.state().answers.get(answerId)?.state).toBe("retired");
    consent(field, MEMBER);
    const action = await field.service.handle(field.message({ userId: MEMBER, chatId: MEMBER, chatType: "private", messageId: 23, text: "how do I reset my password?" }));
    expect(action.kind === "reply" && action.text).not.toContain("This came up before");
  });
});

describe("a bug that is already known is linked, not opened twice", () => {
  async function fieldWithItem(distance: number): Promise<Harness> {
    const field = harness({ classification: '{"kind":"bug","themeLabel":"android login"}', replyText: "Filed." });
    consent(field, OTHER);
    await field.service.handle(field.message({ userId: OTHER, chatId: OTHER, chatType: "private", messageId: 30, text: "android login fails on 2.3" }));
    await field.queue.settled();
    const stored = field.memory.stored.get(ITEMS_NAMESPACE) ?? [];
    field.memory.configure({ searchHits: new Map([[ITEMS_NAMESPACE, stored.map((line) => ({ text: line.text, blobId: line.blobId, distance }))]]) });
    return field;
  }

  it("counts the reporter as affected and tells them the current status with a receipt", async () => {
    const field = await fieldWithItem(0.1);
    consent(field, MEMBER);
    const before = [...field.cache.state().items.values()].length;
    const action = await field.service.handle(field.message({ userId: MEMBER, chatId: MEMBER, chatType: "private", messageId: 31, text: "I also cannot log in on android" }));
    expect([...field.cache.state().items.values()]).toHaveLength(before);
    const item = [...field.cache.state().items.values()][0];
    expect(item?.affected).toBe(1);
    expect(item?.affectedBy).toEqual([field.service.memberHashOf(MEMBER)]);
    expect(action.kind === "reply" && action.text).toContain("The team already knows about this");
    expect(action.kind === "reply" && action.text).toContain("with the team");
    expect(action.kind === "reply" && action.text).not.toContain("status=");
    expect(action.kind === "reply" && action.text).toContain("https://walruscan.com/mainnet/blob/");
  });

  it("opens a new item when nothing is near enough", async () => {
    const field = await fieldWithItem(KNOWN_ISSUE_MAX_DISTANCE + 0.2);
    consent(field, MEMBER);
    await field.service.handle(field.message({ userId: MEMBER, chatId: MEMBER, chatType: "private", messageId: 32, text: "payments fail on checkout" }));
    expect([...field.cache.state().items.values()]).toHaveLength(2);
  });

  it("opens a new item rather than guessing when two known issues are both near", async () => {
    const field = await fieldWithItem(0.1);
    field.memory.configure({});
    consent(field, OTHER);
    await field.service.handle(field.message({ userId: OTHER, chatId: OTHER, chatType: "private", messageId: 33, text: "android sign in broken too" }));
    await field.queue.settled();
    const stored = field.memory.stored.get(ITEMS_NAMESPACE) ?? [];
    const opened = stored.filter((line) => line.text.includes("t=ITEM_OPENED"));
    expect(opened.length).toBeGreaterThanOrEqual(2);
    field.memory.configure({ searchHits: new Map([[ITEMS_NAMESPACE, opened.map((line) => ({ text: line.text, blobId: line.blobId, distance: 0.1 }))]]) });
    consent(field, MEMBER);
    const countBefore = [...field.cache.state().items.values()].length;
    await field.service.handle(field.message({ userId: MEMBER, chatId: MEMBER, chatType: "private", messageId: 34, text: "cannot sign in on android" }));
    expect([...field.cache.state().items.values()]).toHaveLength(countBefore + 1);
  });

  it("does not link a report to an item that is already closed", async () => {
    const field = await fieldWithItem(0.05);
    const itemId = [...field.cache.state().items.keys()][0] ?? "";
    field.cache.record({
      seq: 400,
      namespace: ITEMS_NAMESPACE,
      memberH: null,
      event: { type: "ITEM_STATUS", itemId, status: "duplicate", seq: 400, ts: "2026-10-08T10:00:00.000Z" },
      state: "saved",
      blobId: "bclose",
      code: null,
    });
    consent(field, MEMBER);
    await field.service.handle(field.message({ userId: MEMBER, chatId: MEMBER, chatType: "private", messageId: 35, text: "I also cannot log in on android" }));
    expect([...field.cache.state().items.values()]).toHaveLength(2);
  });
});
