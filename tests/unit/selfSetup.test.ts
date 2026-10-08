import { describe, expect, it } from "vitest";
import { claimOwner, describeGovernance, requireOwner, setupCodeMatches } from "../../src/core/governance.js";
import { memberHash } from "../../src/core/namespace.js";
import { resolve } from "../../src/core/resolver.js";
import type { LedgerEntry } from "../../src/core/state.js";
import { LedgerCache } from "../../src/memory/cache.js";
import { CLAIMED, CLAIM_NEEDS_DM, SETUP_NEEDS_GROUP } from "../../src/bots/manager/setupCommands.js";
import { userKey } from "../../src/platform/platform.js";
import { MANAGER_ID, OUTSIDER_ID, SETUP_CODE, managerHarness, SECRET_SEED, type ManagerHarness } from "../support/managerHarness.js";

const OWNER = 7_000_001;
const HELPER = 7_000_002;
const CONFIG_NAMESPACE = "sd-c1-config";
const hashOf = (id: number | string): string => memberHash(SECRET_SEED, { platform: "telegram", id: String(id) });

function unclaimed(options: Parameters<typeof managerHarness>[0] = {}): ManagerHarness {
  return managerHarness({ managerKeys: [], ...options });
}

async function claimBy(field: ManagerHarness, userId: number, code = SETUP_CODE): Promise<string> {
  return field.ask(`/claim ${code}`, { userId, chatKind: "direct", chatId: userId, messageId: 10 });
}

describe("the first person with the setup code becomes the owner", () => {
  it("records the owner in the config namespace and explains what to do next", async () => {
    const field = unclaimed();
    const reply = await claimBy(field, OWNER);
    expect(reply).toBe(CLAIMED);
    expect(field.cache.state().governance.ownerH).toBe(hashOf(OWNER));
    expect(field.cache.state().governance.managerHs.has(hashOf(OWNER))).toBe(true);
    await field.queue.settled();
    expect(field.community.stored.get(CONFIG_NAMESPACE)).toHaveLength(1);
  });

  it("refuses a wrong code and changes nothing", async () => {
    const field = unclaimed();
    const reply = await claimBy(field, OWNER, "not-the-code");
    expect(reply).toContain("setup code is wrong");
    expect(reply).toContain("Nothing changed");
    expect(field.cache.state().governance.ownerH).toBeNull();
    expect(field.cache.size()).toBe(0);
  });

  it("refuses a second claim once there is an owner", async () => {
    const field = unclaimed();
    await claimBy(field, OWNER);
    const second = await claimBy(field, HELPER);
    expect(second).toContain("already has an owner");
    expect(field.cache.state().governance.ownerH).toBe(hashOf(OWNER));
  });

  it("only takes the code in a direct message, so a group never sees it", async () => {
    const field = unclaimed();
    const reply = await field.ask(`/claim ${SETUP_CODE}`, { userId: OWNER, chatKind: "community", chatId: -100555 });
    expect(reply).toBe(CLAIM_NEEDS_DM);
    expect(field.cache.state().governance.ownerH).toBeNull();
  });

  it("refuses everyone when no setup code is configured at all", async () => {
    const field = unclaimed({ setupCode: null });
    const reply = await claimBy(field, OWNER);
    expect(reply).toContain("no setup code is configured");
    expect(field.cache.state().governance.ownerH).toBeNull();
  });

  it("compares the code without leaking whether it was close", () => {
    expect(setupCodeMatches("abc123xyz9", "abc123xyz9")).toBe(true);
    expect(setupCodeMatches(" abc123xyz9 ", "abc123xyz9")).toBe(true);
    expect(setupCodeMatches("abc123xyz8", "abc123xyz9")).toBe(false);
    expect(setupCodeMatches("", "abc123xyz9")).toBe(false);
  });
});

describe("only the owner changes who the managers are", () => {
  it("lets the owner add a manager by replying to their message", async () => {
    const field = unclaimed();
    await claimBy(field, OWNER);
    const reply = await field.ask("/addmanager", { userId: OWNER, chatKind: "direct", chatId: OWNER, messageId: 11, replyToUserId: HELPER });
    expect(reply).toContain("can run manager commands now");
    expect(field.cache.state().governance.managerHs.has(hashOf(HELPER))).toBe(true);
  });

  it("lets the owner add a manager by id", async () => {
    const field = unclaimed();
    await claimBy(field, OWNER);
    await field.ask(`/addmanager ${HELPER}`, { userId: OWNER, chatKind: "direct", chatId: OWNER, messageId: 12 });
    expect(field.cache.state().governance.managerHs.has(hashOf(HELPER))).toBe(true);
  });

  it("refuses a non-owner, even one who is already a manager", async () => {
    const field = unclaimed();
    await claimBy(field, OWNER);
    await field.ask(`/addmanager ${HELPER}`, { userId: OWNER, chatKind: "direct", chatId: OWNER, messageId: 13 });
    const reply = await field.ask(`/addmanager ${OUTSIDER_ID}`, { userId: HELPER, chatKind: "direct", chatId: HELPER, messageId: 14 });
    expect(reply).toContain("only the owner can do that");
    expect(field.cache.state().governance.managerHs.has(hashOf(OUTSIDER_ID))).toBe(false);
  });

  it("removes a manager, and refuses to remove the owner", async () => {
    const field = unclaimed();
    await claimBy(field, OWNER);
    await field.ask(`/addmanager ${HELPER}`, { userId: OWNER, chatKind: "direct", chatId: OWNER, messageId: 15 });
    const removed = await field.ask(`/removemanager ${HELPER}`, { userId: OWNER, chatKind: "direct", chatId: OWNER, messageId: 16 });
    expect(removed).toContain("no longer run manager commands");
    expect(field.cache.state().governance.managerHs.has(hashOf(HELPER))).toBe(false);
    const self = await field.ask(`/removemanager ${OWNER}`, { userId: OWNER, chatKind: "direct", chatId: OWNER, messageId: 17 });
    expect(self).toContain("owner cannot be removed");
    expect(field.cache.state().governance.ownerH).toBe(hashOf(OWNER));
  });

  it("refuses to remove someone who was never a manager", async () => {
    const field = unclaimed();
    await claimBy(field, OWNER);
    const reply = await field.ask(`/removemanager ${OUTSIDER_ID}`, { userId: OWNER, chatKind: "direct", chatId: OWNER, messageId: 18 });
    expect(reply).toContain("not a manager");
  });

  it("refuses the pure rules outright when nobody owns the assistant", () => {
    const governance = { ownerH: null, managerHs: new Set<string>(), community: null };
    expect(requireOwner(governance, hashOf(OWNER)).ok).toBe(false);
    expect(claimOwner({ ...governance, ownerH: hashOf(OWNER) }, SETUP_CODE, SETUP_CODE).ok).toBe(false);
  });
});

describe("a manager names the group with /setup", () => {
  it("records the group and suggests /optin next", async () => {
    const field = unclaimed();
    await claimBy(field, OWNER);
    const reply = await field.ask("/setup", { userId: OWNER, chatKind: "community", chatId: -100777, messageId: 20 });
    expect(reply).toContain("treat this group as your community");
    expect(reply).toContain("/optin");
    expect(field.cache.state().governance.community).toEqual({ platform: "telegram", chatId: "-100777" });
  });

  it("refuses a non-manager", async () => {
    const field = unclaimed();
    await claimBy(field, OWNER);
    const reply = await field.ask("/setup", { userId: OUTSIDER_ID, chatKind: "community", chatId: -100777, messageId: 21 });
    expect(reply).toContain("for community managers");
    expect(field.cache.state().governance.community).toBeNull();
  });

  it("refuses in a direct message, since there is no group to name", async () => {
    const field = unclaimed();
    await claimBy(field, OWNER);
    expect(await field.ask("/setup", { userId: OWNER, chatKind: "direct", chatId: OWNER, messageId: 22 })).toBe(SETUP_NEEDS_GROUP);
  });

  it("refuses before anybody has claimed the assistant", async () => {
    const field = unclaimed();
    const reply = await field.ask("/setup", { userId: OWNER, chatKind: "community", chatId: -100777, messageId: 23 });
    expect(reply).toContain("Nobody has claimed this assistant yet");
  });
});

describe("the whole arrangement survives a restart", () => {
  it("rebuilds owner, managers and community from the config namespace", async () => {
    const field = unclaimed();
    await claimBy(field, OWNER);
    await field.ask(`/addmanager ${HELPER}`, { userId: OWNER, chatKind: "direct", chatId: OWNER, messageId: 30 });
    await field.ask("/setup", { userId: OWNER, chatKind: "community", chatId: -100777, messageId: 31 });
    await field.queue.settled();

    const rebuilt = new LedgerCache();
    rebuilt.replaceAll(field.cache.lines());
    const governance = rebuilt.state().governance;
    expect(governance.ownerH).toBe(hashOf(OWNER));
    expect(governance.managerHs.has(hashOf(HELPER))).toBe(true);
    expect(governance.community).toEqual({ platform: "telegram", chatId: "-100777" });
  });

  it("lets the added manager act after the restart", async () => {
    const field = unclaimed();
    await claimBy(field, OWNER);
    await field.ask(`/addmanager ${HELPER}`, { userId: OWNER, chatKind: "direct", chatId: OWNER, messageId: 32 });
    const lines = field.cache.lines();

    const fresh = unclaimed();
    fresh.cache.replaceAll(lines);
    const status = await fresh.ask("/status", { userId: HELPER, chatKind: "direct", chatId: HELPER, messageId: 33 });
    expect(status).toContain("SessionDesk status");
  });

  it("ignores a manager change that did not come from the owner", () => {
    const ownerH = hashOf(OWNER);
    const entries: readonly LedgerEntry[] = [
      { memberH: null, event: { type: "OWNER_SET", ownerH, seq: 1, ts: "2026-10-08T09:00:00.000Z" } },
      { memberH: null, event: { type: "MANAGER_ADDED", managerH: hashOf(OUTSIDER_ID), byOwnerH: hashOf(HELPER), seq: 2, ts: "2026-10-08T09:01:00.000Z" } },
      { memberH: null, event: { type: "COMMUNITY_SET", platform: "telegram", chatId: "-100999", bySetterH: hashOf(OUTSIDER_ID), seq: 3, ts: "2026-10-08T09:02:00.000Z" } },
    ];
    const state = resolve(entries);
    expect(state.governance.managerHs.has(hashOf(OUTSIDER_ID))).toBe(false);
    expect(state.governance.community).toBeNull();
    expect(state.rejectedEvents).toBe(2);
  });

  it("ignores a second OWNER_SET, so ownership cannot be taken by writing a line", () => {
    const entries: readonly LedgerEntry[] = [
      { memberH: null, event: { type: "OWNER_SET", ownerH: hashOf(OWNER), seq: 1, ts: "2026-10-08T09:00:00.000Z" } },
      { memberH: null, event: { type: "OWNER_SET", ownerH: hashOf(OUTSIDER_ID), seq: 2, ts: "2026-10-08T09:01:00.000Z" } },
    ];
    const state = resolve(entries);
    expect(state.governance.ownerH).toBe(hashOf(OWNER));
    expect(state.rejectedEvents).toBe(1);
  });
});

describe("the env settings keep production running unchanged", () => {
  it("treats an env-listed manager as a manager with no claim at all", async () => {
    const field = managerHarness();
    expect(field.cache.state().governance.ownerH).toBeNull();
    expect(await field.ask("/status")).toContain("SessionDesk status");
  });

  it("does not let an event remove an env-listed manager", async () => {
    const field = managerHarness();
    await claimBy(field, OWNER);
    await field.ask(`/removemanager ${MANAGER_ID}`, { userId: OWNER, chatKind: "direct", chatId: OWNER, messageId: 40 });
    expect(await field.ask("/status", { userId: MANAGER_ID })).toContain("SessionDesk status");
  });

  it("tells an unknown person how to claim when nothing is configured yet", async () => {
    const field = unclaimed();
    const reply = await field.ask("/owed", { userId: OUTSIDER_ID });
    expect(reply).toContain("Nobody has claimed this assistant yet");
    expect(reply).toContain("/claim");
  });

  it("describes governance for /status without naming anybody", () => {
    const governance = { ownerH: hashOf(OWNER), managerHs: new Set([hashOf(OWNER), hashOf(HELPER)]), community: null };
    const described = describeGovernance(governance, [userKey("telegram", String(MANAGER_ID))]);
    expect(described).toContain("managersFromSetup=2");
    expect(described).toContain("managersFromEnv=1");
    expect(described).not.toContain(String(OWNER));
    expect(described).not.toContain(hashOf(OWNER));
  });
});

describe("the setup code never leaks", () => {
  it("stays out of every log line, the status snapshot and the stored events", async () => {
    const field = unclaimed();
    await claimBy(field, OWNER);
    await field.ask(`/claim ${SETUP_CODE}`, { userId: HELPER, chatKind: "direct", chatId: HELPER, messageId: 50 });
    const status = await field.ask("/status", { userId: OWNER, chatKind: "direct", chatId: OWNER, messageId: 51 });
    await field.queue.settled();
    for (const written of field.logLines) expect(written).not.toContain(SETUP_CODE);
    expect(status).not.toContain(SETUP_CODE);
    for (const line of field.community.stored.get(CONFIG_NAMESPACE) ?? []) expect(line.text).not.toContain(SETUP_CODE);
  });

  it("never writes a raw user id into a governance event", async () => {
    const field = unclaimed();
    await claimBy(field, OWNER);
    await field.ask(`/addmanager ${HELPER}`, { userId: OWNER, chatKind: "direct", chatId: OWNER, messageId: 52 });
    await field.queue.settled();
    for (const line of field.community.stored.get(CONFIG_NAMESPACE) ?? []) {
      expect(line.text).not.toContain(String(OWNER));
      expect(line.text).not.toContain(String(HELPER));
    }
  });
});
