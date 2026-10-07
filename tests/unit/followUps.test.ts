import { describe, expect, it } from "vitest";
import { FollowUpScheduler, type SentReminder } from "../../src/bots/shared/followUpScheduler.js";
import { MemberDirectory } from "../../src/bots/shared/directory.js";
import { Log } from "../../src/bots/shared/log.js";
import { duePromises, managerReminder, memberReminder, reminderKey } from "../../src/core/followUps.js";
import { resolve } from "../../src/core/resolver.js";
import type { LedgerEntry } from "../../src/core/state.js";
import { LedgerCache } from "../../src/memory/cache.js";

const MEMBER_H = "a".repeat(24);
const MEMBER_ID = 42_000_001;
const MANAGER_ID = 4242;

function ledger(due: string, dmConsent: boolean, state: "open" | "fulfilled" = "open"): readonly LedgerEntry[] {
  const entries: LedgerEntry[] = [
    { memberH: MEMBER_H, event: { type: "CONSENT_GIVEN", scope: dmConsent ? "storage_and_dm" : "storage", seq: 1, ts: "2026-10-06T09:00:00.000Z" } },
    { memberH: MEMBER_H, event: { type: "PROMISE_MADE", promiseId: "p-1", memberH: MEMBER_H, due, text: "we will check the login bug", byManagerId: MANAGER_ID, seq: 2, ts: "2026-10-06T10:00:00.000Z" } },
  ];
  if (state === "fulfilled") entries.push({ memberH: MEMBER_H, event: { type: "PROMISE_FULFILLED", promiseId: "p-1", seq: 3, ts: "2026-10-07T10:00:00.000Z" } });
  return entries;
}

function cacheOf(entries: readonly LedgerEntry[]): LedgerCache {
  const cache = new LedgerCache();
  cache.replaceAll(entries.map((entry) => ({ seq: entry.event.seq, namespace: `sd-c1-m-${MEMBER_H}`, memberH: entry.memberH, event: entry.event, state: "saved" as const, blobId: `b${entry.event.seq}`, code: null })));
  return cache;
}

interface Field {
  readonly scheduler: FollowUpScheduler;
  readonly managerMessages: string[];
  readonly memberMessages: string[];
  readonly logLines: string[];
}

function field(entries: readonly LedgerEntry[], now: string, knowsMember = true): Field {
  const managerMessages: string[] = [];
  const memberMessages: string[] = [];
  const logLines: string[] = [];
  const directory = new MemberDirectory();
  if (knowsMember) directory.remember({ userId: MEMBER_ID, memberH: MEMBER_H, userName: "ada" }, new Date(now));
  const scheduler = new FollowUpScheduler({
    cache: cacheOf(entries),
    directory,
    managerIds: [MANAGER_ID],
    clock: { now: () => new Date(now) },
    log: new Log("followups", (line) => logLines.push(line)),
    toManager: async (_chatId, text) => {
      managerMessages.push(text);
    },
    toMember: async (_chatId, text) => {
      memberMessages.push(text);
    },
  });
  return { scheduler, managerMessages, memberMessages, logLines };
}

describe("a promise that comes due is followed up", () => {
  it("finds a promise due today and one already overdue, and ignores a future one", () => {
    const now = new Date("2026-10-08T09:00:00.000Z");
    expect(duePromises(resolve(ledger("2026-10-08", false)), now)).toHaveLength(1);
    expect(duePromises(resolve(ledger("2026-10-06", false)), now)[0]?.overdue).toBe(true);
    expect(duePromises(resolve(ledger("2026-10-20", false)), now)).toEqual([]);
  });

  it("ignores a promise that was already kept", () => {
    expect(duePromises(resolve(ledger("2026-10-08", false, "fulfilled")), new Date("2026-10-08T09:00:00.000Z"))).toEqual([]);
  });

  it("DMs the manager with the promise, who it is for and how to close it", async () => {
    const run = field(ledger("2026-10-08", false), "2026-10-08T09:00:00.000Z");
    const sent = await run.scheduler.tick();
    expect(sent.map((reminder: SentReminder) => reminder.audience)).toEqual(["manager"]);
    expect(run.managerMessages[0]).toContain("p-1 is due today (2026-10-08)");
    expect(run.managerMessages[0]).toContain("@ada");
    expect(run.managerMessages[0]).toContain("/done p-1");
  });

  it("says overdue to the manager once the day has passed", async () => {
    const run = field(ledger("2026-10-06", false), "2026-10-08T09:00:00.000Z");
    await run.scheduler.tick();
    expect(run.managerMessages[0]).toContain("overdue since 2026-10-06");
  });

  it("tells the member honestly when they agreed to DMs", async () => {
    const run = field(ledger("2026-10-08", true), "2026-10-08T09:00:00.000Z");
    const sent = await run.scheduler.tick();
    expect(sent.map((reminder) => reminder.audience)).toEqual(["manager", "member"]);
    expect(run.memberMessages[0]).toContain("promised you something by today");
    expect(run.memberMessages[0]).toContain("still open");
    expect(run.memberMessages[0]).toContain("team has been reminded");
    for (const falseClaim of ["has been done", "is fixed", "completed", "sorted", "already done"]) {
      expect(run.memberMessages[0]).not.toContain(falseClaim);
    }
  });

  it("does not DM a member who only agreed to storage", async () => {
    const run = field(ledger("2026-10-08", false), "2026-10-08T09:00:00.000Z");
    await run.scheduler.tick();
    expect(run.memberMessages).toEqual([]);
    expect(run.logLines.join("\n")).toContain("no dm consent on record");
  });

  it("does not DM a member it has not seen since boot, and says why", async () => {
    const run = field(ledger("2026-10-08", true), "2026-10-08T09:00:00.000Z", false);
    await run.scheduler.tick();
    expect(run.memberMessages).toEqual([]);
    expect(run.logLines.join("\n")).toContain("no dm address on record and not seen since boot");
  });

  it("sends one reminder per promise per day, however often it checks", async () => {
    const run = field(ledger("2026-10-08", true), "2026-10-08T09:00:00.000Z");
    await run.scheduler.tick();
    await run.scheduler.tick();
    await run.scheduler.tick();
    expect(run.managerMessages).toHaveLength(1);
    expect(run.memberMessages).toHaveLength(1);
    expect(run.scheduler.ticks()).toBe(3);
    expect(reminderKey("p-1", "2026-10-09")).not.toBe(reminderKey("p-1", "2026-10-08"));
  });

  it("keeps going when Telegram refuses one of the messages", async () => {
    const logLines: string[] = [];
    const directory = new MemberDirectory();
    directory.remember({ userId: MEMBER_ID, memberH: MEMBER_H, userName: "ada" }, new Date("2026-10-08T09:00:00.000Z"));
    const memberMessages: string[] = [];
    const scheduler = new FollowUpScheduler({
      cache: cacheOf(ledger("2026-10-08", true)),
      directory,
      managerIds: [MANAGER_ID],
      clock: { now: () => new Date("2026-10-08T09:00:00.000Z") },
      log: new Log("followups", (line) => logLines.push(line)),
      toManager: async () => {
        throw new Error("Forbidden: bot was blocked by the user");
      },
      toMember: async (_chatId, text) => {
        memberMessages.push(text);
      },
    });
    const sent = await scheduler.tick();
    expect(sent.map((reminder) => reminder.audience)).toEqual(["member"]);
    expect(memberMessages).toHaveLength(1);
    expect(logLines.join("\n")).toContain("followup_failed");
  });

  it("writes nothing to walrus: a reminder is a message, not an event", async () => {
    const run = field(ledger("2026-10-08", true), "2026-10-08T09:00:00.000Z");
    await run.scheduler.tick();
    expect(run.logLines.join("\n")).not.toContain("PROMISE_");
  });

  it("builds the two message texts from the promise on record", () => {
    const due = duePromises(resolve(ledger("2026-10-06", true)), new Date("2026-10-08T09:00:00.000Z"))[0];
    expect(due).toBeDefined();
    if (due === undefined) return;
    expect(managerReminder(due, "@ada")).toContain("we will check the login bug");
    expect(memberReminder(due)).toContain("we will check the login bug");
  });
});
