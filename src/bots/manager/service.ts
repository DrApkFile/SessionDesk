import { isManagerByEnv, isManagerByEvents } from "../../core/governance.js";
import { memberHash } from "../../core/namespace.js";
import { userKey } from "../../platform/platform.js";
import { reviewReply } from "../../core/replyGuard.js";
import { ERRORS } from "../../core/errors.js";
import { managerPrompt } from "../../models/prompts.js";
import { commandOf, isCommand, reply, silent, type BotAction, type IncomingMessage } from "../shared/incoming.js";
import type { ManagerContext, ManagerDeps } from "./deps.js";
import { MANAGER_HELP } from "./help.js";
import { listAnswers, retire } from "./answerCommands.js";
import { addManager, claim, removeManager, setupCommunity } from "./setupCommands.js";
import { listNotes, writeNote } from "./noteCommands.js";
import { donePromise, makePromise, owed } from "./promiseCommands.js";
import { helpers, memberCard, status, themes, weeklyReport } from "./reportCommands.js";
import { changeStatus, isStatusCommand } from "./statusCommands.js";
import { buildSummary } from "./summary.js";
import { grantAmbassador, revokeAmbassador } from "./tierCommands.js";

export class ManagerService {
  readonly #deps: ManagerDeps;
  readonly #namespaceSecret: string;

  constructor(deps: ManagerDeps, namespaceSecret: string) {
    this.#deps = deps;
    this.#namespaceSecret = namespaceSecret;
  }

  #actorHash(message: IncomingMessage): string {
    return memberHash(this.#namespaceSecret, { platform: message.platform, id: message.userId });
  }

  #mayManage(message: IncomingMessage): boolean {
    const governance = this.#deps.cache.state().governance;
    if (isManagerByEnv(this.#deps.managerIds, userKey(message.platform, message.userId))) return true;
    return isManagerByEvents(governance, this.#actorHash(message));
  }

  async handle(message: IncomingMessage): Promise<BotAction> {
    if (message.isBot) return silent("sender is a bot");
    const { name: commandName } = isCommand(message.text) ? commandOf(message.text) : { name: "" };
    const claiming = commandName === "/claim";
    if (!claiming && !this.#mayManage(message)) {
      this.#deps.log.say("not_manager", { platform: message.platform, chat: message.chatKind, reason: "not on this platform's manager list" });
      const governance = this.#deps.cache.state().governance;
      if (governance.ownerH === null && this.#deps.managerIds.length === 0) {
        return reply("Nobody has claimed this assistant yet. Whoever set it up has a setup code: send /claim with it to me in a direct message.");
      }
      return reply(`${ERRORS.NOT_MANAGER.message} ${ERRORS.NOT_MANAGER.nextAction}`);
    }

    const context: ManagerContext = {
      message,
      managerId: message.userId,
      replyToMemberH:
        message.replyToUserId === null || message.replyToIsBot
          ? null
          : memberHash(this.#namespaceSecret, { platform: message.platform, id: message.replyToUserId }),
    };

    if (!isCommand(message.text)) return this.#answerFreeText(message);

    const { name, rest } = commandOf(message.text);
    if (name === "/claim") return claim(this.#deps, context, rest);
    if (name === "/addmanager") return addManager(this.#deps, context, rest);
    if (name === "/removemanager") return removeManager(this.#deps, context, rest);
    if (name === "/setup") return setupCommunity(this.#deps, context);
    if (isStatusCommand(name)) return changeStatus(this.#deps, context, name, rest);
    if (name === "/owed") return owed(this.#deps);
    if (name === "/themes") return themes(this.#deps);
    if (name === "/helpers") return helpers(this.#deps);
    if (name === "/member") return memberCard(this.#deps, context, rest);
    if (name === "/promise") return makePromise(this.#deps, context, rest);
    if (name === "/done") return donePromise(this.#deps, context, rest);
    if (name === "/note") return writeNote(this.#deps, context, rest);
    if (name === "/notes") return listNotes(this.#deps);
    if (name === "/ambassador") return grantAmbassador(this.#deps, context, rest);
    if (name === "/unambassador") return revokeAmbassador(this.#deps, context, rest);
    if (name === "/answers") return listAnswers(this.#deps);
    if (name === "/retire") return retire(this.#deps, context, rest);
    if (name === "/report") return weeklyReport(this.#deps);
    if (name === "/status") return status(this.#deps);
    return reply(MANAGER_HELP);
  }

  summary(): string {
    return buildSummary(this.#deps.cache.state(), this.#deps.directory, this.#deps.clock.now());
  }

  async #answerFreeText(message: IncomingMessage): Promise<BotAction> {
    const summary = this.summary();
    const asked = await this.#deps.model.ask({ prompt: managerPrompt(summary, message.text), json: false });
    if (!asked.ok) {
      this.#deps.log.say("manager_model_failed", { code: asked.code, detail: asked.detail ?? "" });
      return reply(`${ERRORS.MODEL_UNAVAILABLE.message}\n\n${summary}`);
    }
    const reviewed = reviewReply(asked.value.text, { text: summary });
    if (!reviewed.ok) {
      this.#deps.log.say("manager_reply_refused", { detail: reviewed.detail ?? "", model: asked.value.model });
      return reply(`${ERRORS.MODEL_OUTPUT_REFUSED.message}\n\n${summary}`);
    }
    return reply(reviewed.value);
  }
}
