import { refuse, ok, type Result } from "./result.js";

export interface ConsentFacts {
  readonly consented: boolean;
  readonly dmConsent: boolean;
}

export const NO_CONSENT: ConsentFacts = { consented: false, dmConsent: false };

export function requireConsent(facts: ConsentFacts): Result<ConsentFacts> {
  if (!facts.consented) return refuse("NOT_CONSENTED");
  return ok(facts);
}

export function mayDirectMessage(facts: ConsentFacts): boolean {
  return facts.consented && facts.dmConsent;
}

export function requireManager(managerIds: readonly string[], userId: string): Result<string> {
  if (!managerIds.includes(userId)) return refuse("NOT_MANAGER");
  return ok(userId);
}
