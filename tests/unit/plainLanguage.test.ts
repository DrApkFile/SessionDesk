import { describe, expect, it } from "vitest";
import { FACTS_HEADER } from "../../src/core/factsSheet.js";
import { readFeedback } from "../../src/core/feedbackWords.js";
import { internalLeakIn } from "../../src/core/replyGuard.js";
import { PLAIN_STATUS } from "../../src/core/plainWords.js";
import { ITEM_STATUSES } from "../../src/core/vocabulary.js";
import { clipForMember, describePlainly } from "../../src/bots/member/describe.js";
import { CONFLICTING_ANSWERS_REPLY } from "../../src/bots/member/reuse.js";
import { MYDATA_TEXT_CHARS } from "../../src/core/tuning.js";
import { GROUP_CHAT_ID, MANAGER_ID, harness, type Harness } from "../support/memberHarness.js";

const MEMBER = 42_000_001;
const HELPER = 42_000_002;
const ANSWERS_NAMESPACE = "sd-c1-answers";

const FORBIDDEN: ReadonlyArray<{ readonly label: string; readonly pattern: RegExp }> = [
  { label: "facts sheet header", pattern: new RegExp(FACTS_HEADER.slice(0, 12)) },
  { label: "an item or theme id", pattern: /\b[ipta]-[0-9a-f]{3,}\b/ },
  { label: "a tier label", pattern: /tier[:=]/i },
  { label: "a status code", pattern: /status=/ },
  { label: "a seq number", pattern: /\bseq=/ },
  { label: "a namespace", pattern: /sd-c1-/ },
  { label: "a wire line", pattern: /SD1\|/ },
];

function assertPlain(text: string): void {
  for (const rule of FORBIDDEN) {
    expect(text, `${rule.label} leaked into: ${text.slice(0, 120)}`).not.toMatch(rule.pattern);
  }
}

async function everyMemberFacingReply(): Promise<readonly string[]> {
  const said: string[] = [];
  const keep = (text: string | false): void => {
    if (typeof text === "string" && text.length > 0) said.push(text);
  };

  const field: Harness = harness({ classification: '{"kind":"bug","themeLabel":"android login"}', replyText: "Filed, thanks." });
  keep((await field.service.handle(field.message({ userId: MANAGER_ID, text: "/optin" }))).kind === "reply" ? "optin" : "");
  const optin = await field.service.handle(field.message({ userId: MANAGER_ID, text: "/optin" }));
  keep(optin.kind === "reply" && optin.text);
  const prompt = await field.service.handle(field.message({ userId: MEMBER, text: "@sdmemberbot hello", mentionsBot: true }));
  keep(prompt.kind === "reply" && prompt.text);
  keep(field.service.consentFromTap({ userId: MEMBER, chatId: GROUP_CHAT_ID, chatKind: "community", messageId: 2, scope: "storage" }).alert);
  keep(field.service.consentFromTap({ userId: MEMBER, chatId: GROUP_CHAT_ID, chatKind: "community", messageId: 3, scope: "storage" }).alert);
  keep(field.service.consentFromTap({ userId: HELPER, chatId: GROUP_CHAT_ID, chatKind: "community", messageId: 4, scope: "storage_and_dm" }).alert);

  for (const text of ["/help", "/mydata", "android login fails on 2.3", "i am a designer", "my key is ada@example.com", "/correct 99 nope", "/correct 1 nope", "/correct"]) {
    const action = await field.service.handle(field.message({ userId: MEMBER, chatId: MEMBER, chatType: "private", messageId: 10 + text.length, text }));
    keep(action.kind === "reply" && action.text);
  }
  await field.queue.settled();
  const afterSave = await field.service.handle(field.message({ userId: MEMBER, chatId: MEMBER, chatType: "private", messageId: 60, text: "/mydata" }));
  keep(afterSave.kind === "reply" && afterSave.text);

  field.classifyAs('{"kind":"profile","profile":{"field":"role","value":"designer"}}');
  await field.service.handle(field.message({ userId: MEMBER, chatId: MEMBER, chatType: "private", messageId: 61, text: "i am a designer" }));
  const corrected = await field.service.handle(field.message({ userId: MEMBER, chatId: MEMBER, chatType: "private", messageId: 62, text: "/correct 3 developer" }));
  keep(corrected.kind === "reply" && corrected.text);

  field.breakModel();
  field.breakGroq();
  field.classifyAs('{"kind":"question","themeLabel":"android login"}');
  const held = await field.service.handle(field.message({ userId: MEMBER, chatId: MEMBER, chatType: "private", messageId: 70, text: "any news?" }));
  keep(held.kind === "reply" && held.text);

  const unavailable = harness({ classification: '{"kind":"question"}' });
  unavailable.service.recordConsent(MEMBER, MEMBER, 1, "storage");
  unavailable.health.markUnavailable(unavailable.namespaceOfMember(MEMBER));
  const down = await unavailable.service.handle(unavailable.message({ userId: MEMBER, chatId: MEMBER, chatType: "private", messageId: 80, text: "what do you know?" }));
  keep(down.kind === "reply" && down.text);

  const known = harness({ classification: '{"kind":"bug","themeLabel":"android login"}', replyText: "Filed." });
  known.service.recordConsent(HELPER, HELPER, 1, "storage");
  await known.service.handle(known.message({ userId: HELPER, chatId: HELPER, chatType: "private", messageId: 90, text: "android login fails on 2.3" }));
  await known.queue.settled();
  const items = known.memory.stored.get("sd-c1-items") ?? [];
  known.memory.configure({ searchHits: new Map([["sd-c1-items", items.map((line) => ({ text: line.text, blobId: line.blobId, distance: 0.1 }))]]) });
  known.service.recordConsent(MEMBER, MEMBER, 2, "storage");
  const duplicate = await known.service.handle(known.message({ userId: MEMBER, chatId: MEMBER, chatType: "private", messageId: 91, text: "i cannot log in on android either" }));
  keep(duplicate.kind === "reply" && duplicate.text);

  const reuse = harness({ classification: '{"kind":"other"}' });
  reuse.service.recordConsent(MANAGER_ID, MANAGER_ID, 1, "storage");
  await reuse.service.handle(
    reuse.message({ userId: MANAGER_ID, messageId: 95, text: "Open settings, then Account, then Reset.", replyToUserId: MEMBER, replyToText: "how do I reset my password?", mentionsBot: true }),
  );
  await reuse.service.handle(reuse.message({ userId: MANAGER_ID, messageId: 595, text: "yes", mentionsBot: true }));
  await reuse.queue.settled();
  const answers = reuse.memory.stored.get(ANSWERS_NAMESPACE) ?? [];
  reuse.memory.configure({ searchHits: new Map([[ANSWERS_NAMESPACE, answers.map((line) => ({ text: line.text, blobId: line.blobId, distance: 0.05 }))]]) });
  reuse.classifyAs('{"kind":"question","themeLabel":"passwords"}');
  reuse.service.recordConsent(MEMBER, MEMBER, 2, "storage");
  const reused = await reuse.service.handle(reuse.message({ userId: MEMBER, chatId: MEMBER, chatType: "private", messageId: 96, text: "how do I reset my password?" }));
  keep(reused.kind === "reply" && reused.text);
  const saidNo = await reuse.service.handle(reuse.message({ userId: MEMBER, chatId: MEMBER, chatType: "private", messageId: 97, text: "no" }));
  keep(saidNo.kind === "reply" && saidNo.text);

  const clash = harness({ classification: '{"kind":"other"}' });
  clash.service.recordConsent(MANAGER_ID, MANAGER_ID, 1, "storage");
  for (const [messageId, question, answer] of [
    [100, "how do I reset my password?", "Open settings, then Account, then Reset."],
    [101, "how do I change my password?", "Use the Reset link on the sign-in screen."],
  ] as const) {
    await clash.service.handle(clash.message({ userId: MANAGER_ID, messageId, text: answer, replyToUserId: MEMBER, replyToText: question, mentionsBot: true }));
    await clash.service.handle(clash.message({ userId: MANAGER_ID, messageId: messageId + 500, text: "yes", mentionsBot: true }));
  }
  await clash.queue.settled();
  const both = clash.memory.stored.get(ANSWERS_NAMESPACE) ?? [];
  clash.memory.configure({ searchHits: new Map([[ANSWERS_NAMESPACE, both.map((line) => ({ text: line.text, blobId: line.blobId, distance: 0.05 }))]]) });
  clash.classifyAs('{"kind":"question","themeLabel":"passwords"}');
  clash.service.recordConsent(MEMBER, MEMBER, 2, "storage");
  const conflicting = await clash.service.handle(clash.message({ userId: MEMBER, chatId: MEMBER, chatType: "private", messageId: 110, text: "how do I reset my password?" }));
  keep(conflicting.kind === "reply" && conflicting.text);
  expect(conflicting.kind === "reply" && conflicting.text).toBe(CONFLICTING_ANSWERS_REPLY);

  return said;
}

describe("a member never sees an internal format", () => {
  it("keeps every reply the member bot can send free of ids, labels and status codes", async () => {
    const said = await everyMemberFacingReply();
    expect(said.length).toBeGreaterThan(15);
    for (const text of said) assertPlain(text);
  });

  it("names a status in words a person uses", () => {
    expect(PLAIN_STATUS.reported).toBe("with the team");
    expect(PLAIN_STATUS.acknowledged).toBe("the team is on it");
    expect(PLAIN_STATUS.fixed).toBe("fixed");
    expect(PLAIN_STATUS.verified).toBe("fixed and confirmed");
    expect(PLAIN_STATUS.duplicate).toBe("already known");
    expect(PLAIN_STATUS.wont_fix).toBe("won't be changed");
    expect(Object.keys(PLAIN_STATUS).sort()).toEqual([...ITEM_STATUSES].sort());
  });

  it("spots an internal format in model output", () => {
    expect(internalLeakIn("Your item i-ab12cd is fixed")).toBe("i-ab12cd");
    expect(internalLeakIn("status=fixed")).toBe("status=");
    expect(internalLeakIn("tier: regular")).toBe("tier:");
    expect(internalLeakIn("Your report is fixed.")).toBeNull();
  });

  it("still tells the member when something is not saved", async () => {
    const field = harness({ classification: '{"kind":"chit_chat"}', memory: { failWritesBefore: 99 } });
    field.service.recordConsent(MEMBER, MEMBER, 1, "storage");
    await field.queue.settled();
    const action = await field.service.handle(field.message({ userId: MEMBER, chatId: MEMBER, chatType: "private", messageId: 5, text: "/mydata" }));
    expect(action.kind === "reply" && action.text).toContain("did NOT save");
    assertPlain(action.kind === "reply" ? action.text : "");
  });
});

describe("the reply fallback chain", () => {
  it("answers from the primary model when it works", async () => {
    const field = harness({ classification: '{"kind":"question","themeLabel":"login"}', replyText: "All good." });
    field.service.recordConsent(MEMBER, MEMBER, 1, "storage");
    const action = await field.service.handle(field.message({ userId: MEMBER, chatId: MEMBER, chatType: "private", messageId: 2, text: "hello?" }));
    expect(action.kind === "reply" && action.text).toBe("All good.");
    expect(field.logLines.join("\n")).toContain("answeredBy=gemini-3.8-flash");
  });

  it("falls through to qwen on groq when both gemini models are down, and says who answered", async () => {
    const field = harness({ classification: '{"kind":"question","themeLabel":"login"}', groqReplyText: "Nothing on record yet." });
    field.service.recordConsent(MEMBER, MEMBER, 1, "storage");
    field.breakReplyModels();
    const action = await field.service.handle(field.message({ userId: MEMBER, chatId: MEMBER, chatType: "private", messageId: 3, text: "hello?" }));
    expect(action.kind === "reply" && action.text).toBe("Nothing on record yet.");
    const log = field.logLines.join("\n");
    expect(log).toContain("answeredBy=qwen/qwen3.8-27b");
    expect(log).toContain("gemini-3.8-flash:refused");
    expect(log).toContain("gemini-3.5-flash:refused");
  });

  it("falls back to the plain template only when every model is gone", async () => {
    const field = harness({ classification: '{"kind":"question","themeLabel":"login"}' });
    field.service.recordConsent(MEMBER, MEMBER, 1, "storage");
    field.breakReplyModels();
    field.breakGroqReplies();
    const action = await field.service.handle(field.message({ userId: MEMBER, chatId: MEMBER, chatType: "private", messageId: 4, text: "hello?" }));
    expect(action.kind === "reply" && action.text).toContain("my AI is overloaded");
    expect(field.logLines.join("\n")).toContain("reply_fell_back_to_template");
  });

  it("keeps the order gemini, gemini fallback, groq", () => {
    expect(harness().replies.names()).toEqual(["gemini-3.8-flash", "gemini-3.5-flash", "qwen/qwen3.8-27b"]);
  });
});

describe("did this help", () => {
  async function offered(): Promise<Harness> {
    const field = harness({ classification: '{"kind":"other"}' });
    field.service.recordConsent(MANAGER_ID, MANAGER_ID, 1, "storage");
    await field.service.handle(
      field.message({ userId: MANAGER_ID, messageId: 10, text: "Open settings, then Account, then Reset.", replyToUserId: MEMBER, replyToText: "how do I reset my password?", mentionsBot: true }),
    );
    await field.service.handle(field.message({ userId: MANAGER_ID, messageId: 510, text: "yes", mentionsBot: true }));
    await field.queue.settled();
    const answers = field.memory.stored.get(ANSWERS_NAMESPACE) ?? [];
    field.memory.configure({ searchHits: new Map([[ANSWERS_NAMESPACE, answers.map((line) => ({ text: line.text, blobId: line.blobId, distance: 0.05 }))]]) });
    field.classifyAs('{"kind":"question","themeLabel":"passwords"}');
    field.service.recordConsent(MEMBER, MEMBER, 2, "storage");
    await field.service.handle(field.message({ userId: MEMBER, chatId: MEMBER, chatType: "private", messageId: 11, text: "how do I reset my password?" }));
    return field;
  }

  it("records that it did not help, opens no item, and passes it to the team", async () => {
    const field = await offered();
    const itemsBefore = [...field.cache.state().items.values()].length;
    const action = await field.service.handle(field.message({ userId: MEMBER, chatId: MEMBER, chatType: "private", messageId: 12, text: "no, still stuck" }));
    expect(action.kind === "reply" && action.text).toBe("Thanks, I've passed your question to the team.");
    expect([...field.cache.state().items.values()]).toHaveLength(itemsBefore);
    const answer = [...field.cache.state().answers.values()][0];
    expect(answer?.unhelpful).toBe(1);
    expect(answer?.helpful).toBe(0);
    expect(field.logLines.join("\n")).toContain("storedItem=false");
  });

  it("records that it helped", async () => {
    const field = await offered();
    const action = await field.service.handle(field.message({ userId: MEMBER, chatId: MEMBER, chatType: "private", messageId: 13, text: "yes that worked" }));
    expect(action.kind === "reply" && action.text).toContain("thanks for telling me");
    expect([...field.cache.state().answers.values()][0]?.helpful).toBe(1);
  });

  it("counts one vote per offer, so a second no changes nothing", async () => {
    const field = await offered();
    await field.service.handle(field.message({ userId: MEMBER, chatId: MEMBER, chatType: "private", messageId: 14, text: "no" }));
    await field.service.handle(field.message({ userId: MEMBER, chatId: MEMBER, chatType: "private", messageId: 15, text: "no" }));
    expect([...field.cache.state().answers.values()][0]?.unhelpful).toBe(1);
  });

  it("treats anything that is not a clear yes or no as an ordinary message", async () => {
    const field = await offered();
    field.classifyAs('{"kind":"bug","themeLabel":"passwords"}');
    const action = await field.service.handle(
      field.message({ userId: MEMBER, chatId: MEMBER, chatType: "private", messageId: 16, text: "the reset link sends me to a blank page every time I try it on android" }),
    );
    expect(action.kind).toBe("reply");
    expect([...field.cache.state().answers.values()][0]?.unhelpful).toBe(0);
    expect([...field.cache.state().items.values()].length).toBeGreaterThan(0);
  });

  it("reads yes and no the way people write them", () => {
    for (const yes of ["yes", "Yes!", "yep", "that worked", "thanks", "perfect"]) expect(readFeedback(yes)).toBe("helpful");
    for (const no of ["no", "Nope.", "nah", "did not help", "still broken", "not really"]) expect(readFeedback(no)).toBe("unhelpful");
    expect(readFeedback("that did not answer my question")).toBe("unhelpful");
    expect(readFeedback("thats not what i asked")).toBe("unhelpful");
    for (const unclear of ["", "the reset page is blank on android and I have tried twice today", "yes and no"]) expect(readFeedback(unclear)).toBe("unclear");
  });
});

describe("/mydata shows what was actually stored", () => {
  async function held(): Promise<Harness> {
    const field = harness({ classification: '{"kind":"bug","themeLabel":"android login"}', replyText: "Filed." });
    field.service.recordConsent(MEMBER, MEMBER, 1, "storage_and_dm");
    await field.service.handle(field.message({ userId: MEMBER, chatKind: "direct", chatId: MEMBER, messageId: 2, text: "android login fails on 2.3" }));
    field.classifyAs('{"kind":"profile","profile":{"field":"role","value":"designer"}}');
    await field.service.handle(field.message({ userId: MEMBER, chatKind: "direct", chatId: MEMBER, messageId: 3, text: "i am a designer" }));
    await field.queue.settled();
    return field;
  }

  it("names the date, what kind of thing it was in plain words, and the text as saved", async () => {
    const field = await held();
    const action = await field.service.handle(field.message({ userId: MEMBER, chatKind: "direct", chatId: MEMBER, messageId: 9, text: "/mydata" }));
    expect(action.kind).toBe("reply");
    if (action.kind !== "reply") return;
    expect(action.text).toContain("You agreed to");
    expect(action.text).toContain('You reported: "android login fails on 2.3"');
    expect(action.text).toContain('You told me what you do: "designer"');
    expect(action.text).toContain("2026-10-08");
    expect(action.text).toContain("https://walruscan.com/mainnet/blob/");
    assertPlain(action.text);
  });

  it("numbers the lines so /correct can name one, without showing a sequence number", async () => {
    const field = await held();
    const action = await field.service.handle(field.message({ userId: MEMBER, chatKind: "direct", chatId: MEMBER, messageId: 10, text: "/mydata" }));
    if (action.kind !== "reply") return;
    expect(action.text).toMatch(/^1\. /m);
    expect(action.text).toMatch(/^2\. /m);
    expect(action.text).not.toMatch(/\bseq\b/);
  });

  it("clips a very long report rather than dumping it", () => {
    const long = "x".repeat(400);
    expect(clipForMember(long)).toHaveLength(MYDATA_TEXT_CHARS);
    expect(clipForMember(long).endsWith("…")).toBe(true);
    expect(clipForMember("short enough")).toBe("short enough");
  });

  it("says plainly which lines did not save", async () => {
    const field = harness({ classification: '{"kind":"chit_chat"}', memory: { failWritesBefore: 99 } });
    field.service.recordConsent(MEMBER, MEMBER, 1, "storage");
    await field.queue.settled();
    const action = await field.service.handle(field.message({ userId: MEMBER, chatKind: "direct", chatId: MEMBER, messageId: 11, text: "/mydata" }));
    if (action.kind !== "reply") return;
    expect(action.text).toContain("You agreed to");
    expect(action.text).toContain("did NOT save");
    assertPlain(action.text);
  });

  it("describes every event type without leaking a format", () => {
    const samples: Parameters<typeof describePlainly>[0][] = [
      { type: "CONSENT_GIVEN", scope: "storage", seq: 1, ts: "2026-10-08T09:00:00.000Z" },
      { type: "ITEM_OPENED", itemId: "i-1", kind: "bug", themeId: "t-1", text: "login fails", seq: 2, ts: "2026-10-08T09:00:00.000Z" },
      { type: "ITEM_STATUS", itemId: "i-1", status: "fixed", seq: 3, ts: "2026-10-08T09:00:00.000Z" },
      { type: "PROMISE_MADE", promiseId: "p-1", memberH: "a".repeat(24), due: "2026-10-09", text: "we will look", byManagerId: "4242", seq: 4, ts: "2026-10-08T09:00:00.000Z" },
      { type: "CONTRIBUTION", kind: "helped", seq: 5, ts: "2026-10-08T09:00:00.000Z" },
      { type: "OWNER_SET", ownerH: "b".repeat(24), seq: 6, ts: "2026-10-08T09:00:00.000Z" },
      { type: "DM_ADDRESS", telegramUserId: 42_000_001, seq: 7, ts: "2026-10-08T09:00:00.000Z" },
    ];
    for (const event of samples) {
      const plain = describePlainly(event);
      expect(plain.lead.length).toBeGreaterThan(4);
      assertPlain(`${plain.lead}: ${plain.content ?? ""}`);
    }
  });
});
