import { timingSafeEqual, createHash } from "node:crypto";
import { refuse, ok, type Result } from "./result.js";
import type { CommunityState, Governance } from "./state.js";

export const SETUP_CODE_CHARS = 10;

export function setupCodeMatches(given: string, expected: string): boolean {
  const left = createHash("sha256").update(given.trim()).digest();
  const right = createHash("sha256").update(expected.trim()).digest();
  return timingSafeEqual(left, right);
}

export function claimOwner(governance: Governance, givenCode: string, expectedCode: string | null): Result<true> {
  if (expectedCode === null) return refuse("NOT_MANAGER", "no setup code is configured, so nobody can claim this SessionDesk");
  if (governance.ownerH !== null) return refuse("NOT_MANAGER", "this SessionDesk already has an owner");
  if (givenCode.trim().length === 0) return refuse("NOT_MANAGER", "no setup code given");
  if (!setupCodeMatches(givenCode, expectedCode)) return refuse("NOT_MANAGER", "that setup code is wrong");
  return ok(true);
}

export function requireOwner(governance: Governance, actorH: string): Result<string> {
  if (governance.ownerH === null) return refuse("NOT_MANAGER", "nobody owns this SessionDesk yet");
  if (governance.ownerH !== actorH) return refuse("NOT_MANAGER", "only the owner can do that");
  return ok(actorH);
}

export function canRemoveManager(governance: Governance, managerH: string): Result<string> {
  if (managerH === governance.ownerH) return refuse("NOT_MANAGER", "the owner cannot be removed");
  if (!governance.managerHs.has(managerH)) return refuse("UNKNOWN_ITEM", "that person is not a manager");
  return ok(managerH);
}

export function isManagerByEvents(governance: Governance, actorH: string): boolean {
  return governance.managerHs.has(actorH);
}

export function isManagerByEnv(envManagerKeys: readonly string[], actorKey: string): boolean {
  return envManagerKeys.includes(actorKey);
}

export function managerCount(governance: Governance, envManagerKeys: readonly string[]): number {
  return governance.managerHs.size + envManagerKeys.length;
}

export function communityOf(state: CommunityState): Governance["community"] {
  return state.governance.community;
}

export function describeGovernance(governance: Governance, envManagerKeys: readonly string[]): string {
  return [
    `owner=${governance.ownerH === null ? "unclaimed" : governance.ownerH.slice(0, 8)}`,
    `managersFromSetup=${governance.managerHs.size}`,
    `managersFromEnv=${envManagerKeys.length}`,
    `community=${governance.community === null ? "unset" : `${governance.community.platform}:${governance.community.chatId}`}`,
  ].join(" ");
}
