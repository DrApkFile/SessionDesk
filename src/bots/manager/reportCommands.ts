import { buildFactsSheet } from "../../core/factsSheet.js";
import { ERRORS } from "../../core/errors.js";
import { reply, type BotAction } from "../shared/incoming.js";
import { THEME_WINDOW_DAYS } from "../../core/tuning.js";
import type { ManagerContext, ManagerDeps } from "./deps.js";
import { recentThemes, topHelpers } from "./summary.js";
import { findMember } from "./targets.js";

export function themes(deps: ManagerDeps): BotAction {
  const found = recentThemes(deps.cache.state(), deps.clock.now());
  if (found.length === 0) return reply(`No themes in the last ${THEME_WINDOW_DAYS} days.`);
  const lines = found.map((theme) => `${theme.label}: ${theme.itemIds.length} item(s), ${theme.questionCount} question(s)${theme.itemIds.length === 0 ? "" : ` [${theme.itemIds.join(" ")}]`}`);
  return reply([`Themes in the last ${THEME_WINDOW_DAYS} days, busiest first:`, ...lines].join("\n"));
}

export function helpers(deps: ManagerDeps): BotAction {
  const found = topHelpers(deps.cache.state());
  if (found.length === 0) return reply("Nobody has contribution points yet.");
  return reply(["Contribution points:", ...found.map((helper) => `${deps.directory.label(helper.memberH)}: ${helper.points}`)].join("\n"));
}

export function memberCard(deps: ManagerDeps, context: ManagerContext, rest: string): BotAction {
  const found = findMember(deps.directory, rest, context.replyToMemberH);
  if (!found.ok) return reply(`${ERRORS[found.code].message} ${found.detail ?? ""}`.trim());
  const memberH = found.value;
  const saved = deps.cache.memoriesOf(memberH).length;
  const sheet = buildFactsSheet(deps.cache.state(), memberH, deps.clock.now(), saved);
  const notes = deps.notesCache.state().notes.filter((note) => note.memberH === memberH);
  const noteLines = notes.length === 0 ? ["manager notes: —"] : ["manager notes:", ...notes.map((note) => `  ${note.ts.slice(0, 10)}: ${note.text}`)];
  return reply([`${deps.directory.label(memberH)}`, sheet.text, ...noteLines].join("\n"));
}

export function status(deps: ManagerDeps): BotAction {
  const snapshot = deps.status.snapshot();
  const lines = Object.entries(snapshot).map(([key, value]) => `${key}: ${String(value)}`);
  return reply(["SessionDesk status", ...lines, `memory: ${deps.health.summary()}`].join("\n"));
}
