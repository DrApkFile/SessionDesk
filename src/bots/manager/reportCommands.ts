import { buildFactsSheet } from "../../core/factsSheet.js";
import { ERRORS } from "../../core/errors.js";
import { reply, type BotAction } from "../shared/incoming.js";
import { THEMES_SHOWN, THEME_WINDOW_DAYS } from "../../core/tuning.js";
import type { ManagerContext, ManagerDeps } from "./deps.js";
import { affectedIn, recentThemes, topHelpers } from "./summary.js";
import { buildWeeklyFacts } from "./weekly.js";
import { reportPrompt } from "../../models/prompts.js";
import { reviewReply } from "../../core/replyGuard.js";
import { findMember } from "./targets.js";

export function themes(deps: ManagerDeps): BotAction {
  const found = recentThemes(deps.cache.state(), deps.clock.now());
  if (found.length === 0) return reply(`No themes in the last ${THEME_WINDOW_DAYS} days.`);
  const state = deps.cache.state();
  const shown = found.slice(0, THEMES_SHOWN);
  const lines = shown.flatMap((theme) => {
    const affected = affectedIn(state, theme.itemIds);
    const head = `${theme.label}: ${theme.itemIds.length} item(s), ${theme.questionCount} question(s), ${affected} extra member(s) affected`;
    return theme.itemIds.length === 0 ? [head] : [head, `   ${theme.itemIds.join(" ")}`];
  });
  const more = found.length - shown.length;
  const tail = more <= 0 ? [] : [`and ${more} more.`];
  return reply([`Themes in the last ${THEME_WINDOW_DAYS} days, busiest first:`, ...lines, ...tail].join("\n"));
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
  const state = deps.cache.state();
  const affectedItems = [...state.items.values()].filter((item) => item.affectedBy.includes(memberH));
  const affectedLines = affectedItems.length === 0 ? [] : [`also affected by: ${affectedItems.map((item) => `${item.itemId} (${item.status}, ${item.affected} affected)`).join(", ")}`];
  const notes = deps.notesCache.state().notes.filter((note) => note.memberH === memberH);
  const noteLines = notes.length === 0 ? ["manager notes: —"] : ["manager notes:", ...notes.map((note) => `  ${note.ts.slice(0, 10)}: ${note.text}`)];
  return reply([`${deps.directory.label(memberH)}`, sheet.text, ...affectedLines, ...noteLines].join("\n"));
}

export async function weeklyReport(deps: ManagerDeps): Promise<BotAction> {
  const facts = buildWeeklyFacts(deps.cache.state(), deps.directory, deps.clock.now());
  const asked = await deps.model.ask({ prompt: reportPrompt(facts), json: false });
  if (!asked.ok) {
    deps.log.say("report_model_failed", { code: asked.code });
    return reply([`${ERRORS.MODEL_UNAVAILABLE.message} Here is the data it would have written from:`, "", facts].join("\n"));
  }
  const reviewed = reviewReply(asked.value.text, { text: facts });
  if (!reviewed.ok) {
    deps.log.say("report_refused", { detail: reviewed.detail ?? "", model: asked.value.model });
    return reply([`${ERRORS.MODEL_OUTPUT_REFUSED.message} Here is the data instead:`, "", facts].join("\n"));
  }
  deps.log.say("report_drafted", { model: asked.value.model, chars: reviewed.value.length });
  return reply([reviewed.value, "", "Draft only, from the counted data below. Check it before posting.", "", facts].join("\n"));
}

export function status(deps: ManagerDeps): BotAction {
  const snapshot = deps.status.snapshot();
  const lines = Object.entries(snapshot).map(([key, value]) => `${key}: ${String(value)}`);
  return reply(["SessionDesk status", ...lines, `memory: ${deps.health.summary()}`].join("\n"));
}
