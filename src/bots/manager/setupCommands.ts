import { ERRORS } from "../../core/errors.js";
import { canRemoveManager, claimOwner, requireOwner } from "../../core/governance.js";
import { memberHash } from "../../core/namespace.js";
import { reply, type BotAction } from "../shared/incoming.js";
import type { ManagerContext, ManagerDeps } from "./deps.js";

export const CLAIMED = [
  "You are the owner of this assistant now. Nobody else can claim it.",
  "Next: add me to your group, then send /setup in that group so I know which group to serve.",
  "You can let someone else run manager commands with /addmanager, replying to one of their messages.",
].join("\n");

export const CLAIM_NEEDS_DM = "Send /claim to me in a direct message, not in a group, so nobody else sees the code.";
export const ADD_MANAGER_USAGE = "Reply to one of their messages with /addmanager, or give me their user id: /addmanager 123456789.";
export const SETUP_NEEDS_GROUP = "Send /setup in the group you want me to serve, not here.";

export function communitySet(platform: string, chatId: string): string {
  return [
    `Done. I will treat this ${platform === "telegram" ? "group" : "channel"} as your community from now on.`,
    "Next: send /optin here and I will post the notice people tap to join, and pin it.",
  ].join("\n");
}

export function claim(deps: ManagerDeps, context: ManagerContext, rest: string): BotAction {
  if (context.message.chatKind !== "direct") return reply(CLAIM_NEEDS_DM);
  const governance = deps.cache.state().governance;
  const allowed = claimOwner(governance, rest, deps.setupCode);
  if (!allowed.ok) {
    deps.log.say("claim_refused", { platform: context.message.platform, detail: allowed.detail ?? allowed.code });
    return reply(`${allowed.detail ?? ERRORS.NOT_MANAGER.message}. Nothing changed.`);
  }
  const ownerH = memberHash(deps.namespaceSecret, { platform: context.message.platform, id: context.managerId });
  const recorded = deps.pipeline.commit(
    [{ draft: { type: "OWNER_SET", ownerH }, namespaces: [{ kind: "config" }], idempotency: `owner|${deps.communityKey}` }],
    { chatId: context.message.chatId, messageId: context.message.messageId },
    deps.clock.now(),
  );
  deps.log.say("owner_claimed", { ownerCode: ownerH.slice(0, 8), seq: recorded[0]?.event.seq ?? 0 });
  return reply(CLAIMED);
}

function targetOf(deps: ManagerDeps, context: ManagerContext, rest: string): string | null {
  const given = rest.trim();
  if (given.length > 0) return memberHash(deps.namespaceSecret, { platform: context.message.platform, id: given.replace(/^@/, "") });
  return context.replyToMemberH;
}

export function addManager(deps: ManagerDeps, context: ManagerContext, rest: string): BotAction {
  const governance = deps.cache.state().governance;
  const actorH = memberHash(deps.namespaceSecret, { platform: context.message.platform, id: context.managerId });
  const owner = requireOwner(governance, actorH);
  if (!owner.ok) return reply(`${owner.detail ?? ERRORS.NOT_MANAGER.message}. Nothing changed.`);

  const managerH = targetOf(deps, context, rest);
  if (managerH === null) return reply(ADD_MANAGER_USAGE);
  if (governance.managerHs.has(managerH)) return reply("They can already run manager commands, so nothing changed.");

  const recorded = deps.pipeline.commit(
    [{ draft: { type: "MANAGER_ADDED", managerH, byOwnerH: actorH }, namespaces: [{ kind: "config" }], idempotency: `manager-added|${deps.communityKey}|${managerH}` }],
    { chatId: context.message.chatId, messageId: context.message.messageId },
    deps.clock.now(),
  );
  deps.log.say("manager_added", { managerCode: managerH.slice(0, 8), seq: recorded[0]?.event.seq ?? 0 });
  return reply(`Done. ${deps.directory.label(managerH)} can run manager commands now. ${ERRORS.WRITE_PENDING.message}`);
}

export function removeManager(deps: ManagerDeps, context: ManagerContext, rest: string): BotAction {
  const governance = deps.cache.state().governance;
  const actorH = memberHash(deps.namespaceSecret, { platform: context.message.platform, id: context.managerId });
  const owner = requireOwner(governance, actorH);
  if (!owner.ok) return reply(`${owner.detail ?? ERRORS.NOT_MANAGER.message}. Nothing changed.`);

  const managerH = targetOf(deps, context, rest);
  if (managerH === null) return reply(ADD_MANAGER_USAGE);
  const removable = canRemoveManager(governance, managerH);
  if (!removable.ok) return reply(`${removable.detail ?? ERRORS.UNKNOWN_ITEM.message}. Nothing changed.`);

  const recorded = deps.pipeline.commit(
    [
      {
        draft: { type: "MANAGER_REMOVED", managerH, byOwnerH: actorH },
        namespaces: [{ kind: "config" }],
        idempotency: `manager-removed|${deps.communityKey}|${managerH}|${recordedCount(deps)}`,
      },
    ],
    { chatId: context.message.chatId, messageId: context.message.messageId },
    deps.clock.now(),
  );
  deps.log.say("manager_removed", { managerCode: managerH.slice(0, 8), seq: recorded[0]?.event.seq ?? 0 });
  return reply(`Done. ${deps.directory.label(managerH)} can no longer run manager commands. ${ERRORS.WRITE_PENDING.message}`);
}

function recordedCount(deps: ManagerDeps): number {
  return deps.cache.state().maxSeq;
}

export function setupCommunity(deps: ManagerDeps, context: ManagerContext): BotAction {
  if (context.message.chatKind === "direct") return reply(SETUP_NEEDS_GROUP);
  const actorH = memberHash(deps.namespaceSecret, { platform: context.message.platform, id: context.managerId });
  const governance = deps.cache.state().governance;
  const bySetterH = governance.managerHs.has(actorH) ? actorH : (governance.ownerH ?? actorH);
  if (!governance.managerHs.has(bySetterH)) {
    deps.log.say("setup_refused", { reason: "no owner has claimed this assistant yet" });
    return reply("Nobody has claimed this assistant yet. Send /claim with the setup code to me in a direct message first. Nothing changed.");
  }

  const recorded = deps.pipeline.commit(
    [
      {
        draft: { type: "COMMUNITY_SET", platform: context.message.platform, chatId: context.message.chatId, bySetterH },
        namespaces: [{ kind: "config" }],
        idempotency: `community|${deps.communityKey}|${context.message.platform}|${context.message.chatId}`,
      },
    ],
    { chatId: context.message.chatId, messageId: context.message.messageId },
    deps.clock.now(),
  );
  deps.log.say("community_set", { platform: context.message.platform, chat: context.message.chatId, seq: recorded[0]?.event.seq ?? 0 });
  return reply(communitySet(context.message.platform, context.message.chatId));
}
