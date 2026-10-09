import { describe, expect, it } from "vitest";
import { encode } from "../../src/core/codec.js";
import { ANSWER_MAX_DISTANCE, KNOWN_ISSUE_MAX_DISTANCE, MIN_REUSE_CONTENT_WORDS } from "../../src/core/tuning.js";
import { CONFLICTING_ANSWERS_REPLY } from "../../src/bots/member/reuse.js";
import { GROUP_CHAT_ID, MANAGER_ID, harness, type Harness } from "../support/memberHarness.js";
import type { MemberAction } from "../../src/bots/shared/incoming.js";
import { reuseQueryOf } from "../../src/core/reuseQuery.js";
import { storedLine } from "../../src/core/searchableLine.js";
import type { LedgerEvent } from "../../src/core/events.js";

const MEMBER = 42_000_001;
const OTHER = 42_000_002;
const ANSWERS_NAMESPACE = "sd-c1-answers";
const ITEMS_NAMESPACE = "sd-c1-items";

function consent(field: Harness, userId: number): void {
  field.service.recordConsent(userId, userId, 1, "storage");
}

async function managerAnswers(field: Harness, question: string, answer: string, messageId = 10): Promise<MemberAction> {
  consent(field, MANAGER_ID);
  const action = await field.service.handle(
    field.message({ userId: MANAGER_ID, userName: "boss", messageId, text: answer, replyToUserId: MEMBER, replyToText: question }),
  );
  await field.queue.settled();
  return action;
}

function managersKeep(field: Harness): readonly string[] {
  const pending = [...field.cache.state().answers.values()].filter((answer) => answer.state === "pending");
  let seq = 900;
  for (const answer of pending) {
    seq += 1;
    field.cache.record({
      seq,
      namespace: ANSWERS_NAMESPACE,
      memberH: null,
      event: { type: "ANSWER_CONFIRMED", answerId: answer.answerId, byManagerId: String(MANAGER_ID), seq, ts: "2026-10-09T11:00:00.000Z" },
      state: "saved",
      blobId: `bkeep${seq}`,
      code: null,
    });
  }
  return pending.map((answer) => answer.answerId);
}

describe("an answer given in the group becomes community memory", () => {
  it("stores an ANSWER when a manager replies to a member's question", async () => {
    const field = harness({ classification: '{"kind":"other"}' });
    const action = await managerAnswers(field, "how do I reset my password?", "Open settings, then Account, then Reset.");
    const answers = [...field.cache.state().answers.values()];
    expect(answers).toHaveLength(1);
    expect(answers[0]).toMatchObject({ answeredBy: "manager", state: "pending", questionText: "how do I reset my password?", answerText: "Open settings, then Account, then Reset." });
    expect(field.memory.stored.get(ANSWERS_NAMESPACE)).toHaveLength(1);
    expect(action.kind).toBe("silent");
    expect(field.managerNotices).toHaveLength(1);
    expect(field.managerNotices[0]?.text).toContain("Should I reuse that answer");
    expect(field.managerNotices[0]?.choices.map((choice) => choice.label)).toEqual(["Keep", "Discard"]);
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

  it("posts nothing in the community chat, whether or not the manager mentioned the bot", async () => {
    for (const mentionsBot of [false, true]) {
      const field = harness({ classification: '{"kind":"other"}' });
      consent(field, MANAGER_ID);
      const action = await field.service.handle(
        field.message({
          userId: MANAGER_ID,
          chatId: GROUP_CHAT_ID,
          chatType: "supergroup",
          messageId: 60,
          text: "Open Settings, then Account, then Reset.",
          replyToUserId: MEMBER,
          replyToText: "how do I reset my password?",
          mentionsBot,
        }),
      );
      const said = action.kind === "reply" ? action.text : "";
      expect(said).not.toContain("Should I reuse");
      expect(said).not.toContain("Reply yes");
      expect(field.managerNotices).toHaveLength(1);
      expect(field.cache.state().answers.get([...field.cache.state().answers.keys()][0] ?? "")?.state).toBe("pending");
    }
  });

  it("leaves the answer unconfirmed and says nothing in the group when no manager can be reached", async () => {
    const field = harness({ classification: '{"kind":"other"}', managersReachable: false });
    const action = await managerAnswers(field, "how do I reset my password?", "Open settings, then Account, then Reset.");
    expect(action.kind).toBe("silent");
    expect([...field.cache.state().answers.values()][0]?.state).toBe("pending");
    expect(field.logLines.join("\n")).toContain("could not reach any manager");
    expect(field.logLines.join("\n")).toContain("managersReached=0");
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
    managersKeep(field);
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

  it("refuses to choose when two answers are both near enough, says so without quoting either, and asks the managers", async () => {
    const field = harness({ classification: '{"kind":"other"}' });
    await managerAnswers(field, "how do I reset my password?", "Open settings, then Account, then Reset.", 10);
    await managerAnswers(field, "how do I change my password?", "Use the Reset link on the sign-in screen.", 11);
    managersKeep(field);
    const stored = field.memory.stored.get(ANSWERS_NAMESPACE) ?? [];
    expect(stored).toHaveLength(2);
    field.memory.configure({ searchHits: new Map([[ANSWERS_NAMESPACE, stored.map((line) => ({ text: line.text, blobId: line.blobId, distance: 0.1 }))]]) });
    field.classifyAs('{"kind":"question","themeLabel":"passwords"}');
    consent(field, MEMBER);
    const action = await field.service.handle(field.message({ userId: MEMBER, chatId: MEMBER, chatType: "private", messageId: 22, text: "how do I reset my password?" }));
    expect(action.kind === "reply" && action.text).not.toContain("This came up before");
    expect(action.kind === "reply" && action.text).toBe(CONFLICTING_ANSWERS_REPLY);
    expect(action.kind === "reply" && action.text).not.toContain("Open settings");
    expect(action.kind === "reply" && action.text).not.toContain("Use the Reset link");
    const conflict = field.managerNotices.at(-1);
    expect(conflict?.text).toContain("Open settings");
    expect(conflict?.text).toContain("Use the Reset link");
    expect(conflict?.answerIds).toHaveLength(2);
    expect(conflict?.choices.map((choice) => choice.label)).toEqual(["Keep 1", "Retire 1", "Keep 2", "Retire 2"]);
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

describe("an answer is reused only when a manager has confirmed it", () => {
  async function fieldWithStoredAnswer(options: { readonly confirmed: boolean; readonly distance: number }): Promise<Harness> {
    const field = harness({ classification: '{"kind":"other"}' });
    const event = {
      type: "ANSWER",
      answerId: "a-stored",
      questionText: "how do I reset my password",
      answerText: "Open settings, then Account, then Reset.",
      answeredBy: "manager",
      themeId: "t-pw",
      seq: 300,
      ts: "2026-10-07T09:00:00.000Z",
      ...(options.confirmed ? { confirmed: true } : {}),
    } as const satisfies LedgerEvent;
    field.cache.record({ seq: 300, namespace: ANSWERS_NAMESPACE, memberH: null, event, state: "saved", blobId: "bstored", code: null });
    field.memory.configure({
      searchHits: new Map([[ANSWERS_NAMESPACE, [{ text: storedLine(event), blobId: "bstored", distance: options.distance }]]]),
    });
    field.classifyAs('{"kind":"question","themeLabel":"passwords"}');
    consent(field, MEMBER);
    return field;
  }

  it("reuses a confirmed answer", async () => {
    const field = await fieldWithStoredAnswer({ confirmed: true, distance: 0.1 });
    const action = await field.service.handle(field.message({ userId: MEMBER, chatId: MEMBER, chatType: "private", messageId: 70, text: "how do I reset my password?" }));
    expect(action.kind === "reply" && action.text).toContain("This came up before");
  });

  it("never reuses an answer written before the confirm flow existed, however close the match", async () => {
    const field = await fieldWithStoredAnswer({ confirmed: false, distance: 0.01 });
    expect(field.cache.state().answers.get("a-stored")?.state).toBe("pending");
    const action = await field.service.handle(field.message({ userId: MEMBER, chatId: MEMBER, chatType: "private", messageId: 71, text: "how do I reset my password?" }));
    expect(action.kind === "reply" && action.text).not.toContain("This came up before");
    expect(action.kind === "reply" && action.text).not.toBe(CONFLICTING_ANSWERS_REPLY);
  });

  it("reuses that same answer once a manager confirms it", async () => {
    const field = await fieldWithStoredAnswer({ confirmed: false, distance: 0.01 });
    field.cache.record({
      seq: 600,
      namespace: ANSWERS_NAMESPACE,
      memberH: null,
      event: { type: "ANSWER_CONFIRMED", answerId: "a-stored", byManagerId: String(MANAGER_ID), seq: 600, ts: "2026-10-09T10:00:00.000Z" },
      state: "saved",
      blobId: "bconfirm",
      code: null,
    });
    expect(field.cache.state().answers.get("a-stored")?.state).toBe("active");
    const action = await field.service.handle(field.message({ userId: MEMBER, chatId: MEMBER, chatType: "private", messageId: 72, text: "how do I reset my password?" }));
    expect(action.kind === "reply" && action.text).toContain("This came up before");
  });
});

describe("a question too short or too vague to match is never matched", () => {
  async function fieldWithConfirmedAnswers(distance: number): Promise<Harness> {
    const field = harness({ classification: '{"kind":"other"}' });
    await managerAnswers(field, "what did we fix in the android build?", "We fixed the login crash on 2.3.", 10);
    await managerAnswers(field, "what did we ship last week?", "The new checkout screen.", 11);
    managersKeep(field);
    const stored = field.memory.stored.get(ANSWERS_NAMESPACE) ?? [];
    field.memory.configure({ searchHits: new Map([[ANSWERS_NAMESPACE, stored.map((line) => ({ text: line.text, blobId: line.blobId, distance }))]]) });
    field.classifyAs('{"kind":"question","themeLabel":"releases"}');
    consent(field, MEMBER);
    return field;
  }

  it("does not look for an earlier answer when the question is only a mention and a name", async () => {
    const field = await fieldWithConfirmedAnswers(0.01);
    field.directory.remember({ platform: "telegram", userId: String(OTHER), memberH: field.service.memberHashOf(OTHER), userName: "kenne" }, field.clock.now());
    const action = await field.service.handle(
      field.message({ userId: MEMBER, chatId: GROUP_CHAT_ID, chatType: "supergroup", messageId: 80, text: "@sdmemberbot what's Kenne fixed?", mentionsBot: true }),
    );
    expect(action.kind === "reply" && action.text).not.toContain("This came up before");
    expect(action.kind === "reply" && action.text).not.toBe(CONFLICTING_ANSWERS_REPLY);
    expect(field.logLines.join("\n")).toContain("reuse_skipped");
    expect(field.logLines.join("\n")).not.toContain("reuse_attempt");
  });

  it("still looks when the question carries real words of its own", async () => {
    const field = await fieldWithConfirmedAnswers(0.01);
    const action = await field.service.handle(
      field.message({ userId: MEMBER, chatId: MEMBER, chatType: "private", messageId: 81, text: "what did we fix in the android build?" }),
    );
    expect(field.logLines.join("\n")).toContain("reuse_attempt");
    expect(action.kind).toBe("reply");
  });

  it("counts content words after the names are stripped, never before", () => {
    const query = reuseQueryOf("@sdmemberbot what's Kenne fixed?", ["sdmemberbot"], ["Kenne"]);
    expect(query.contentWords).toEqual(["fixed"]);
    expect(query.contentWords.length).toBeLessThan(MIN_REUSE_CONTENT_WORDS);
    expect(query.worthMatching).toBe(false);
  });
});

describe("a question that differs by one key term is asked about, not answered from the wrong record", () => {
  async function fieldWithAnswerAbout(question: string, answer: string, distance = 0.2): Promise<Harness> {
    const field = harness({ classification: '{"kind":"other"}' });
    const event = {
      type: "ANSWER",
      answerId: "a-faucet",
      questionText: question,
      answerText: answer,
      answeredBy: "manager",
      themeId: "t-faucet",
      seq: 310,
      ts: "2026-10-07T09:00:00.000Z",
      confirmed: true,
    } as const satisfies LedgerEvent;
    field.cache.record({ seq: 310, namespace: ANSWERS_NAMESPACE, memberH: null, event, state: "saved", blobId: "bfaucet", code: null });
    field.memory.configure({ searchHits: new Map([[ANSWERS_NAMESPACE, [{ text: storedLine(event), blobId: "bfaucet", distance }]]]) });
    field.classifyAs('{"kind":"question","themeLabel":"faucet"}');
    consent(field, MEMBER);
    return field;
  }

  const SUI_QUESTION = "how do I get testnet SUI?";
  const SUI_ANSWER = "Open the faucet page, paste your wallet and wait a minute.";

  async function ask(field: Harness, text: string, messageId: number): Promise<string> {
    const action = await field.service.handle(field.message({ userId: MEMBER, chatId: MEMBER, chatType: "private", messageId, text }));
    return action.kind === "reply" ? action.text : "";
  }

  it("asks which one the member means, naming both terms, and shows neither answer", async () => {
    const field = await fieldWithAnswerAbout(SUI_QUESTION, SUI_ANSWER);
    const said = await ask(field, "how do I get testnet SOL?", 120);
    expect(said).toContain("I have an answer about SUI");
    expect(said).toContain("are you asking about SOL");
    expect(said).not.toContain("faucet page");
    expect(field.logLines.join("\n")).toContain("reuse_clarification_asked");
    expect(field.logLines.join("\n")).toContain("decision=unclear");
  });

  it("reuses the answer when the member says yes", async () => {
    const field = await fieldWithAnswerAbout(SUI_QUESTION, SUI_ANSWER);
    await ask(field, "how do I get testnet SOL?", 121);
    const said = await ask(field, "yes", 122);
    expect(said).toContain("This came up before");
    expect(said).toContain("Open the faucet page");
    expect(said).toContain("https://walruscan.com/mainnet/blob/");
  });

  it("answers the member's own question when they say no, and never shows the stored answer", async () => {
    const field = await fieldWithAnswerAbout(SUI_QUESTION, SUI_ANSWER);
    await ask(field, "how do I get testnet SOL?", 123);
    const said = await ask(field, "no", 124);
    expect(said).not.toContain("This came up before");
    expect(said).not.toContain("faucet page");
    expect(field.logLines.join("\n")).toContain("reuse_declined");
  });

  it("reuses it without asking when the question names the same terms in another order", async () => {
    const field = await fieldWithAnswerAbout(SUI_QUESTION, SUI_ANSWER);
    const said = await ask(field, "where do I get SUI on testnet", 125);
    expect(said).toContain("This came up before");
    expect(said).toContain("Open the faucet page");
    expect(field.logLines.join("\n")).not.toContain("reuse_clarification_asked");
  });

  it("records the terms it compared in the log, with no user id", async () => {
    const field = await fieldWithAnswerAbout(SUI_QUESTION, SUI_ANSWER);
    await ask(field, "how do I get testnet SOL?", 126);
    const attempt = field.logLines.find((line) => line.includes("reuse_attempt")) ?? "";
    expect(attempt).toContain("askedTerms=");
    expect(attempt).toContain("termsOnlyInQuestion=sol");
    expect(attempt).toContain("termsOnlyInAnswer=sui");
    expect(attempt).not.toContain(String(MEMBER));
  });
});

describe("a bug report is merged into a known issue only when it names the same things", () => {
  async function fieldWithAndroidItem(distance: number): Promise<Harness> {
    const field = harness({ classification: '{"kind":"bug","themeLabel":"android login"}', replyText: "Filed." });
    consent(field, OTHER);
    await field.service.handle(field.message({ userId: OTHER, chatId: OTHER, chatType: "private", messageId: 130, text: "android login fails on 2.3" }));
    await field.queue.settled();
    const stored = field.memory.stored.get(ITEMS_NAMESPACE) ?? [];
    field.memory.configure({ searchHits: new Map([[ITEMS_NAMESPACE, stored.map((line) => ({ text: line.text, blobId: line.blobId, distance }))]]) });
    consent(field, MEMBER);
    return field;
  }

  it("opens its own item for an ios report rather than merging it into the android one", async () => {
    const field = await fieldWithAndroidItem(0.1);
    const before = [...field.cache.state().items.values()].length;
    const action = await field.service.handle(field.message({ userId: MEMBER, chatId: MEMBER, chatType: "private", messageId: 131, text: "ios login fails" }));
    expect([...field.cache.state().items.values()]).toHaveLength(before + 1);
    expect(action.kind === "reply" && action.text).not.toContain("The team already knows about this");
    expect(field.logLines.join("\n")).toContain("decision=terms_differ");
    expect(field.logLines.join("\n")).toContain("termsOnlyInReport=ios");
  });

  it("still merges a report that names nothing the item does not", async () => {
    const field = await fieldWithAndroidItem(0.1);
    const before = [...field.cache.state().items.values()].length;
    const action = await field.service.handle(field.message({ userId: MEMBER, chatId: MEMBER, chatType: "private", messageId: 132, text: "I also cannot log in on android" }));
    expect([...field.cache.state().items.values()]).toHaveLength(before);
    expect(action.kind === "reply" && action.text).toContain("The team already knows about this");
  });
});
