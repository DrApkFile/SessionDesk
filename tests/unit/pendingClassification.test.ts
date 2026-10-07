import { describe, expect, it } from "vitest";
import { PENDING_MAX_ATTEMPTS, PENDING_RETRY_BACKOFF_MS, GEMINI_RETRY_WINDOW_MINUTES } from "../../src/core/tuning.js";
import { pendingBackoff } from "../../src/bots/shared/pending.js";
import { harness } from "../support/memberHarness.js";

const MEMBER = 42_000_001;

describe("F08 a message is held, not dropped, while every model is down", () => {
  it("holds the message after consent and the redactor have passed, and stores nothing yet", async () => {
    const field = harness({ modelStatus: 503 });
    field.service.recordConsent(MEMBER, MEMBER, 1, "storage");
    await field.queue.settled();
    const writesAfterConsent = field.memory.writeCalls.length;
    await field.service.handle(field.message({ chatId: MEMBER, chatType: "private", messageId: 2, text: "android login fails on 2.3" }));
    expect(field.pending.waiting()).toBe(1);
    expect(field.memory.writeCalls).toHaveLength(writesAfterConsent);
    expect([...field.cache.state().items.values()]).toHaveLength(0);
  });

  it("never holds a message that failed the redactor or the consent guard", async () => {
    const field = harness({ modelStatus: 503 });
    await field.service.handle(field.message({ chatId: MEMBER, chatType: "private", messageId: 2, text: "hello" }));
    expect(field.pending.waiting()).toBe(0);
    field.service.recordConsent(MEMBER, MEMBER, 3, "storage");
    await field.service.handle(field.message({ chatId: MEMBER, chatType: "private", messageId: 4, text: "my key is ada@example.com" }));
    expect(field.pending.waiting()).toBe(0);
  });

  it("files the held message once gemini answers again, keeping the time the member sent it", async () => {
    const field = harness({ modelStatus: 503, classification: '{"kind":"bug","themeLabel":"android login"}' });
    field.service.recordConsent(MEMBER, MEMBER, 1, "storage");
    await field.service.handle(field.message({ chatId: MEMBER, chatType: "private", messageId: 2, text: "android login fails" }));
    const sentAt = field.clock.now().toISOString();
    field.advanceMinutes(1);
    field.mendModel();
    await field.pending.settled();
    expect(field.pending.waiting()).toBe(0);
    const item = [...field.cache.state().items.values()][0];
    expect(item?.text).toBe("android login fails");
    expect(item?.openedTs).toBe(sentAt);
    expect(field.logLines.join("\n")).toContain("classifier=gemini");
    expect(field.logLines.join("\n")).toContain("pending_classified");
  });

  it("backs off between attempts instead of hammering the model", async () => {
    const field = harness({ modelStatus: 503, groqStatus: 503 });
    field.service.recordConsent(MEMBER, MEMBER, 1, "storage");
    await field.service.handle(field.message({ chatId: MEMBER, chatType: "private", messageId: 2, text: "android login fails" }));
    await field.pending.settled();
    expect(field.waits.slice(0, 3)).toEqual([PENDING_RETRY_BACKOFF_MS[0], PENDING_RETRY_BACKOFF_MS[1], PENDING_RETRY_BACKOFF_MS[2]]);
    expect(pendingBackoff(99)).toBe(PENDING_RETRY_BACKOFF_MS[PENDING_RETRY_BACKOFF_MS.length - 1]);
  });

  it("switches to qwen on groq once gemini has been down past the window, and says so in the log", async () => {
    const field = harness({ modelStatus: 503, groqClassification: '{"kind":"bug","themeLabel":"android login"}' });
    field.service.recordConsent(MEMBER, MEMBER, 1, "storage");
    await field.service.handle(field.message({ chatId: MEMBER, chatType: "private", messageId: 2, text: "android login fails" }));
    expect(field.classifier.pastWindow()).toBe(false);
    field.advanceMinutes(GEMINI_RETRY_WINDOW_MINUTES + 1);
    expect(field.classifier.pastWindow()).toBe(true);
    await field.pending.settled();
    expect(field.pending.waiting()).toBe(0);
    expect([...field.cache.state().items.values()]).toHaveLength(1);
    expect(field.logLines.join("\n")).toContain("classifier=groq_fallback");
  });

  it("gives up after a bounded number of attempts and never claims the message was saved", async () => {
    const field = harness({ modelStatus: 503, groqStatus: 503 });
    field.service.recordConsent(MEMBER, MEMBER, 1, "storage");
    await field.service.handle(field.message({ chatId: MEMBER, chatType: "private", messageId: 2, text: "android login fails" }));
    await field.pending.settled();
    expect(field.pending.waiting()).toBe(0);
    expect(field.pending.dropped()).toBe(1);
    expect([...field.cache.state().items.values()]).toHaveLength(0);
    const log = field.logLines.join("\n");
    expect(log).toContain("pending_dropped_unclassified");
    expect(log).toContain("stored=false");
    expect(log).not.toContain("pending_classified");
    expect(field.waits).toHaveLength(PENDING_MAX_ATTEMPTS);
  });

  it("reports what it still holds so shutdown can say it honestly", async () => {
    const field = harness({ modelStatus: 503 });
    field.service.recordConsent(MEMBER, MEMBER, 1, "storage");
    await field.service.handle(field.message({ chatId: MEMBER, chatType: "private", messageId: 2, text: "one" }));
    expect(field.pending.describe()).toBe("waiting=1 dropped=0");
  });
});

describe("the classifier's view of the outage", () => {
  it("clears the outage as soon as gemini answers", async () => {
    const field = harness({ modelStatus: 503 });
    await field.classifier.classify("hello");
    expect(field.classifier.primaryDownSince()).not.toBeNull();
    field.mendModel();
    await field.classifier.classify("hello");
    expect(field.classifier.primaryDownSince()).toBeNull();
    expect(field.classifier.pastWindow()).toBe(false);
  });

  it("keeps using groq until the next probe is due, then returns to gemini once it answers", async () => {
    const field = harness({ modelStatus: 503, classification: '{"kind":"question"}', groqClassification: '{"kind":"feedback"}' });
    await field.classifier.classify("hello");
    field.advanceMinutes(GEMINI_RETRY_WINDOW_MINUTES + 1);
    const viaGroq = await field.classifier.classify("hello");
    expect(viaGroq.ok && viaGroq.value.classifier).toBe("groq_fallback");
    expect(field.classifier.probeDueAt()).not.toBeNull();

    field.mendModel();
    const stillGroq = await field.classifier.classify("hello");
    expect(stillGroq.ok && stillGroq.value.classifier).toBe("groq_fallback");

    field.advanceMinutes(GEMINI_RETRY_WINDOW_MINUTES + 1);
    const viaGemini = await field.classifier.classify("hello");
    expect(viaGemini.ok && viaGemini.value.classifier).toBe("gemini");
    expect(field.classifier.primaryDownSince()).toBeNull();
    expect(field.classifier.probeDueAt()).toBeNull();
  });

  it("refuses when both models are down so the caller can hold the message", async () => {
    const field = harness({ modelStatus: 503, groqStatus: 503 });
    field.advanceMinutes(GEMINI_RETRY_WINDOW_MINUTES + 1);
    const refused = await field.classifier.classify("hello");
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.code).toBe("MODEL_UNAVAILABLE");
  });
});
