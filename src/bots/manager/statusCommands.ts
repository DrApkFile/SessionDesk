import { ERRORS } from "../../core/errors.js";
import { transitionItem } from "../../core/items.js";
import { reply, type BotAction } from "../shared/incoming.js";
import type { ItemStatus } from "../../core/vocabulary.js";
import type { ManagerContext, ManagerDeps } from "./deps.js";
import { findItem } from "./targets.js";

export const STATUS_COMMANDS = {
  "/ack": "acknowledged",
  "/fixed": "fixed",
  "/verify": "verified",
  "/reopen": "reported",
  "/duplicate": "duplicate",
  "/wontfix": "wont_fix",
} as const satisfies Record<string, ItemStatus>;

export type StatusCommand = keyof typeof STATUS_COMMANDS;

export function isStatusCommand(name: string): name is StatusCommand {
  return Object.hasOwn(STATUS_COMMANDS, name);
}

export function changeStatus(deps: ManagerDeps, context: ManagerContext, command: StatusCommand, rest: string): BotAction {
  const wanted = STATUS_COMMANDS[command];
  const found = findItem(deps, rest);
  if (!found.ok) {
    deps.log.say("status_target_refused", { command, code: found.code, detail: found.detail ?? "" });
    return reply(`${ERRORS[found.code].message} ${found.detail ?? ""}`.trim());
  }

  const item = found.value;
  const moved = transitionItem(item.status, wanted, true);
  if (!moved.ok) {
    deps.log.say("status_refused", { itemId: item.itemId, from: item.status, to: wanted, code: moved.code });
    return reply(`${item.itemId} is ${item.status}, so it cannot become ${wanted}. ${ERRORS[moved.code].message}`);
  }

  const recorded = deps.pipeline.commit(
    [{ draft: { type: "ITEM_STATUS", itemId: item.itemId, status: moved.value }, namespaces: [{ kind: "items" }] }],
    { chatId: context.message.chatId, messageId: context.message.messageId },
    deps.clock.now(),
  );
  deps.log.say("status_changed", { itemId: item.itemId, from: item.status, to: moved.value, byManagerId: context.managerId, seq: recorded[0]?.event.seq ?? 0 });
  const owner = item.openedByH === null ? "nobody on record" : deps.directory.label(item.openedByH);
  return reply(`${item.itemId} is now ${moved.value} (was ${item.status}). Filed for ${owner}. ${ERRORS.WRITE_PENDING.message}`);
}
