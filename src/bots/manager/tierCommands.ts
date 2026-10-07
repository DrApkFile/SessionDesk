import { ERRORS } from "../../core/errors.js";
import { grantTier, revokeTier } from "../../core/tier.js";
import { reply, type BotAction } from "../shared/incoming.js";
import type { ManagerContext, ManagerDeps } from "./deps.js";
import { findMember } from "./targets.js";

export function grantAmbassador(deps: ManagerDeps, context: ManagerContext, rest: string): BotAction {
  const found = findMember(deps.directory, rest, context.replyToMemberH);
  if (!found.ok) return reply(`${ERRORS[found.code].message} ${found.detail ?? ""}`.trim());
  const memberH = found.value;
  const granted = grantTier(deps.cache.state().members.get(memberH)?.grantedTier ?? null, "ambassador");
  if (!granted.ok) return reply(`${deps.directory.label(memberH)} is already an ambassador, so nothing changed.`);

  const recorded = deps.pipeline.commit(
    [{ draft: { type: "TIER_SET", memberH, tier: granted.value, byManagerId: context.managerId }, namespaces: [{ kind: "member", memberH }] }],
    { chatId: context.message.chatId, messageId: context.message.messageId },
    deps.clock.now(),
  );
  deps.log.say("tier_set", { memberH, tier: granted.value, byManagerId: context.managerId, seq: recorded[0]?.event.seq ?? 0 });
  return reply(`${deps.directory.label(memberH)} is now an ambassador. ${ERRORS.WRITE_PENDING.message}`);
}

export function revokeAmbassador(deps: ManagerDeps, context: ManagerContext, rest: string): BotAction {
  const found = findMember(deps.directory, rest, context.replyToMemberH);
  if (!found.ok) return reply(`${ERRORS[found.code].message} ${found.detail ?? ""}`.trim());
  const memberH = found.value;
  const member = deps.cache.state().members.get(memberH);
  const revoked = revokeTier(member?.grantedTier ?? null);
  if (!revoked.ok) return reply(`${deps.directory.label(memberH)} holds no granted tier, so nothing changed.`);

  const recorded = deps.pipeline.commit(
    [{ draft: { type: "TIER_REVOKED", memberH, byManagerId: context.managerId }, namespaces: [{ kind: "member", memberH }] }],
    { chatId: context.message.chatId, messageId: context.message.messageId },
    deps.clock.now(),
  );
  deps.log.say("tier_revoked", { memberH, byManagerId: context.managerId, seq: recorded[0]?.event.seq ?? 0 });
  return reply(`${deps.directory.label(memberH)} is no longer an ambassador and goes back to their earned tier. ${ERRORS.WRITE_PENDING.message}`);
}
