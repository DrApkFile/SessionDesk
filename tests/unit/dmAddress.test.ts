import { describe, expect, it } from "vitest";
import { FollowUpScheduler } from "../../src/bots/shared/followUpScheduler.js";
import { MemberDirectory } from "../../src/bots/shared/directory.js";
import { Log } from "../../src/bots/shared/log.js";
import { encode } from "../../src/core/codec.js";
import { memberHash } from "../../src/core/namespace.js";
import { resolve } from "../../src/core/resolver.js";
import type { LedgerEntry } from "../../src/core/state.js";
import { aggregateNamespace, publicEvidence } from "../../src/evidence/aggregate.js";
import { LedgerCache } from "../../src/memory/cache.js";
import { harness } from "../support/memberHarness.js";

const SECRET = "f".repeat(64);
const MEMBER = 42_000_001;
const MANAGER_ID = 4242;
const MEMBER_H = memberHash(SECRET, MEMBER);
const NAMESPACE = `sd-c1-m-${MEMBER_H}`;

function afterRestart(scope: "storage" | "storage_and_dm", withAddress: boolean): LedgerCache {
  const entries: LedgerEntry[] = [
    { memberH: MEMBER_H, event: { type: "CONSENT_GIVEN", scope, seq: 1, ts: "2026-10-06T09:00:00.000Z" } },
    { memberH: MEMBER_H, event: { type: "PROMISE_MADE", promiseId: "p-1", memberH: MEMBER_H, due: "2026-10-08", text: "we will check the login bug", byManagerId: String(MANAGER_ID), seq: 3, ts: "2026-10-06T10:00:00.000Z" } },
  ];
  if (withAddress) entries.splice(1, 0, { memberH: MEMBER_H, event: { type: "DM_ADDRESS", telegramUserId: MEMBER, seq: 2, ts: "2026-10-06T09:00:01.000Z" } });
  const cache = new LedgerCache();
  cache.replaceAll(entries.map((entry) => ({ seq: entry.event.seq, namespace: NAMESPACE, memberH: entry.memberH, event: entry.event, state: "saved" as const, blobId: `b${entry.event.seq}`, code: null })));
  return cache;
}

function schedulerOver(cache: LedgerCache, knowsSinceBoot: boolean) {
  const memberMessages: Array<{ chatId: string; text: string }> = [];
  const logLines: string[] = [];
  const directory = new MemberDirectory();
  if (knowsSinceBoot) directory.remember({ platform: "telegram", userId: String(MEMBER), memberH: MEMBER_H, userName: "ada" }, new Date("2026-10-08T09:00:00.000Z"));
  const scheduler = new FollowUpScheduler({
    cache,
    directory,
    managerIds: [String(MANAGER_ID)],
    clock: { now: () => new Date("2026-10-08T09:00:00.000Z") },
    log: new Log("followups", (line) => logLines.push(line)),
    toManager: async () => {},
    toMember: async (chatId, text) => {
      memberMessages.push({ chatId, text });
    },
  });
  return { scheduler, memberMessages, logLines };
}

describe("a DM address survives a restart", () => {
  it("DMs a due promise to a member the bot has not seen since booting", async () => {
    const run = schedulerOver(afterRestart("storage_and_dm", true), false);
    await run.scheduler.tick();
    expect(run.memberMessages).toHaveLength(1);
    expect(run.memberMessages[0]?.chatId).toBe(String(MEMBER));
    expect(run.memberMessages[0]?.text).toContain("still open");
  });

  it("cannot DM when no address was ever stored and nobody has spoken since boot", async () => {
    const run = schedulerOver(afterRestart("storage_and_dm", false), false);
    await run.scheduler.tick();
    expect(run.memberMessages).toEqual([]);
    expect(run.logLines.join("\n")).toContain("no dm address on record and not seen since boot");
  });

  it("stops using a stored address once the member drops back to storage only", async () => {
    const cache = afterRestart("storage_and_dm", true);
    cache.record({
      seq: 9,
      namespace: NAMESPACE,
      memberH: MEMBER_H,
      event: { type: "CONSENT_GIVEN", scope: "storage", seq: 9, ts: "2026-10-07T09:00:00.000Z" },
      state: "saved",
      blobId: "b9",
      code: null,
    });
    expect(cache.state().members.get(MEMBER_H)?.dmConsent).toBe(false);
    expect(cache.state().members.get(MEMBER_H)?.dmUserId).toBe(MEMBER);
    const run = schedulerOver(cache, false);
    await run.scheduler.tick();
    expect(run.memberMessages).toEqual([]);
    expect(run.logLines.join("\n")).toContain("no dm consent on record");
  });

  it("restores the address through the codec, not just in memory", () => {
    const encoded = encode({ type: "DM_ADDRESS", telegramUserId: MEMBER, seq: 2, ts: "2026-10-06T09:00:01.000Z" });
    const rebuilt = resolve([
      { memberH: MEMBER_H, event: { type: "CONSENT_GIVEN", scope: "storage_and_dm", seq: 1, ts: "2026-10-06T09:00:00.000Z" } },
      { memberH: MEMBER_H, event: { type: "DM_ADDRESS", telegramUserId: MEMBER, seq: 2, ts: "2026-10-06T09:00:01.000Z" } },
    ]);
    expect(encoded).toContain(`telegramUserId=${MEMBER}`);
    expect(rebuilt.members.get(MEMBER_H)?.dmUserId).toBe(MEMBER);
  });
});

describe("the telegram id stays out of everything a human reads", () => {
  it("never appears in a namespace name", () => {
    expect(NAMESPACE).not.toContain(String(MEMBER));
  });

  it("never appears in the member bot's log lines", async () => {
    const field = harness({ classification: '{"kind":"question","themeLabel":"login"}', replyText: "Noted." });
    field.service.recordConsent(MEMBER, MEMBER, 1, "storage_and_dm");
    await field.service.handle(field.message({ userId: MEMBER, chatId: MEMBER, chatType: "private", messageId: 2, text: "any news?" }));
    await field.service.handle(field.message({ userId: MEMBER, text: "hello group" }));
    expect(field.logLines.length).toBeGreaterThan(0);
    for (const written of field.logLines) expect(written).not.toContain(String(MEMBER));
    expect(field.logLines.join("\n")).toContain("chat=dm");
  });

  it("never appears in the evidence output, though the event is counted", () => {
    const found = aggregateNamespace("c1", NAMESPACE, [
      { text: encode({ type: "DM_ADDRESS", telegramUserId: MEMBER, seq: 2, ts: "2026-10-06T09:00:01.000Z" }), blobId: "b2", createdAt: null, distance: null },
    ]);
    const published = JSON.stringify(publicEvidence(found));
    expect(found.eventTypes).toEqual({ DM_ADDRESS: 1 });
    expect(published).toContain("DM_ADDRESS");
    expect(published).not.toContain(String(MEMBER));
  });

  it("tells the member in /mydata that the stored line stays on Walrus after they turn DMs off", async () => {
    const field = harness({ classification: '{"kind":"chit_chat"}' });
    field.service.recordConsent(MEMBER, MEMBER, 1, "storage_and_dm");
    const memberH = field.service.memberHashOf(MEMBER);
    field.cache.record({
      seq: 900,
      namespace: `sd-c1-m-${memberH}`,
      memberH,
      event: { type: "CONSENT_GIVEN", scope: "storage", seq: 900, ts: "2026-10-09T09:00:00.000Z" },
      state: "saved",
      blobId: "b900",
      code: null,
    });
    const action = await field.service.handle(field.message({ userId: MEMBER, chatId: MEMBER, chatType: "private", messageId: 5, text: "/mydata" }));
    expect(action.kind === "reply" && action.text).toContain("no longer use your stored Telegram ID");
    expect(action.kind === "reply" && action.text).toContain("I cannot delete it");
  });
});
