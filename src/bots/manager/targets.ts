import { onlyMatch } from "../../core/onlyMatch.js";
import { refuse, ok, type Result } from "../../core/result.js";
import type { ItemFacts } from "../../core/state.js";
import type { MemberDirectory } from "../shared/directory.js";
import type { ManagerDeps } from "./deps.js";

export function findItem(deps: ManagerDeps, raw: string): Result<ItemFacts> {
  const wanted = raw.trim().toLowerCase();
  if (wanted.length === 0) return refuse("UNKNOWN_ITEM", "no item id given");
  const items = [...deps.cache.state().items.values()];
  const exact = items.find((item) => item.itemId.toLowerCase() === wanted);
  if (exact !== undefined) return ok(exact);
  const matched = onlyMatch(items, (item) => item.itemId.toLowerCase().startsWith(wanted));
  if (matched.kind === "one") return ok(matched.value);
  if (matched.kind === "many") return refuse("AMBIGUOUS_TARGET", `${wanted} matches ${matched.count} items`);
  return refuse("UNKNOWN_ITEM", wanted);
}

export function findPromise(deps: ManagerDeps, raw: string): Result<string> {
  const wanted = raw.trim().toLowerCase();
  if (wanted.length === 0) return refuse("UNKNOWN_ITEM", "no promise id given");
  const promises = [...deps.cache.state().promises.values()];
  const matched = onlyMatch(promises, (promise) => promise.promiseId.toLowerCase() === wanted || promise.promiseId.toLowerCase().startsWith(wanted));
  if (matched.kind === "one") return ok(matched.value.promiseId);
  if (matched.kind === "many") return refuse("AMBIGUOUS_TARGET", `${wanted} matches ${matched.count} promises`);
  return refuse("UNKNOWN_ITEM", wanted);
}

export function findMember(directory: MemberDirectory, raw: string, replyToMemberH: string | null): Result<string> {
  const wanted = raw.trim();
  if (wanted.length === 0) {
    if (replyToMemberH !== null) return ok(replyToMemberH);
    return refuse("UNKNOWN_ITEM", "name a member with @username or a member code, or reply to their message");
  }
  const byName = directory.byUserName(wanted);
  if (byName.kind === "one") return ok(byName.value.memberH);
  if (byName.kind === "many") return refuse("AMBIGUOUS_TARGET", `${wanted} matches ${byName.count} members`);
  const byCode = directory.byCode(wanted.replace(/^@/, ""));
  if (byCode.kind === "one") return ok(byCode.value.memberH);
  if (byCode.kind === "many") return refuse("AMBIGUOUS_TARGET", `${wanted} matches ${byCode.count} members`);
  return refuse("UNKNOWN_ITEM", `I have not seen ${wanted} since I started. Reply to one of their messages instead.`);
}
