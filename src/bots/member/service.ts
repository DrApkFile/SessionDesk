import type { Classification } from "../../core/classification.js";
import { ERRORS } from "../../core/errors.js";
import { buildFactsSheet, templateReply } from "../../core/factsSheet.js";
import { memberHash, resolveNamespace } from "../../core/namespace.js";
import { guardStoredText } from "../../core/redactor.js";
import { reviewReply } from "../../core/replyGuard.js";
import { planWrites, type PlannedWrite } from "../../core/writeGate.js";
import { replyPrompt } from "../../models/prompts.js";
import { memberCommands } from "./commands.js";
import type { MemberDeps } from "./deps.js";
import type { HeldMessage, RetryOutcome } from "../shared/pending.js";
import { commandOf, isCommand, isPrivate, reply, silent, type IncomingMessage, type MemberAction } from "../shared/incoming.js";
import { ALREADY_CONSENTED, CONSENT_IN_GROUP, CONSENT_NOTICE, CONSENT_RECORDED, DM_CONSENT_RECORDED, HELD_FOR_CLASSIFIER, SECRET_WARNING, type ConsentScope } from "./notices.js";

export class MemberService {
  readonly #deps: MemberDeps;

  constructor(deps: MemberDeps) {
    this.#deps = deps;
  }

  memberHashOf(userId: number): string {
    return memberHash(this.#deps.namespaceSecret, userId);
  }

  namespacesFor(memberH: string): readonly string[] {
    return [
      resolveNamespace(this.#deps.communityKey, { kind: "member", memberH }),
      resolveNamespace(this.#deps.communityKey, { kind: "items" }),
      resolveNamespace(this.#deps.communityKey, { kind: "themes" }),
    ];
  }

  async handle(message: IncomingMessage): Promise<MemberAction> {
    if (message.isBot) return silent("sender is a bot");
    if (message.chatType === "channel") return silent("channel post");
    if (!isPrivate(message)) {
      const known = this.#deps.chat.check(message.chatId);
      if (!known.ok) {
        this.#deps.log.say("foreign_chat", { chatId: message.chatId, detail: known.detail ?? known.code });
        return silent("not the community chat");
      }
    }

    const memberH = this.memberHashOf(message.userId);
    this.#deps.directory.remember({ userId: message.userId, memberH, userName: message.userName }, this.#deps.clock.now());
    const problem = this.#deps.health.problemFor(this.namespacesFor(memberH));
    if (problem === "MEMORY_UNAVAILABLE") {
      this.#deps.log.say("memory_unavailable", { memberH, chatId: message.chatId });
      return this.#speak(message, ERRORS.MEMORY_UNAVAILABLE.message);
    }

    if (isCommand(message.text)) return memberCommands(this.#deps, message, memberH);
    return this.#handleTalk(message, memberH, problem === "MEMORY_PARTIAL");
  }

  recordConsent(userId: number, chatId: number, messageId: number, scope: ConsentScope): MemberAction {
    const memberH = this.memberHashOf(userId);
    if (this.#deps.cache.state().members.get(memberH)?.consented === true) return reply(ALREADY_CONSENTED);
    const recorded = this.#deps.pipeline.commit(
      [{ draft: { type: "CONSENT_GIVEN", scope }, namespaces: [{ kind: "member", memberH }] }],
      { chatId, messageId },
      this.#deps.clock.now(),
    );
    this.#deps.log.say("consent_given", { memberH, scope, seq: recorded[0]?.event.seq ?? 0 });
    return reply(scope === "storage_and_dm" ? DM_CONSENT_RECORDED : CONSENT_RECORDED);
  }

  async #handleTalk(message: IncomingMessage, memberH: string, partial: boolean): Promise<MemberAction> {
    const state = this.#deps.cache.state();
    const consented = state.members.get(memberH)?.consented === true;
    if (!consented) {
      this.#deps.log.say("not_consented", { memberH, chatId: message.chatId });
      if (isPrivate(message)) return reply(CONSENT_NOTICE, true);
      return message.mentionsBot ? reply(CONSENT_IN_GROUP) : silent("no consent, not mentioned");
    }

    const guarded = guardStoredText(message.text);
    if (!guarded.ok) {
      this.#deps.log.say("secret_blocked", { memberH, kinds: guarded.detail ?? "" });
      return reply(SECRET_WARNING);
    }

    const classified = await this.#deps.classifier.classify(message.text);
    if (!classified.ok) {
      this.#deps.pending.hold({
        memberH,
        text: message.text,
        chatId: message.chatId,
        messageId: message.messageId,
        receivedAt: this.#deps.clock.now(),
        replyToMemberH: this.#helperFor(message),
      });
      this.#deps.log.say("classify_deferred", { memberH, detail: classified.detail ?? classified.code, outageMs: this.#deps.classifier.outageMs() });
      if (!isPrivate(message) && !message.mentionsBot) return silent("group message, not mentioned");
      const saved = this.#deps.cache.memoriesOf(memberH).length;
      const sheet = buildFactsSheet(this.#deps.cache.state(), memberH, this.#deps.clock.now(), saved);
      return reply(`${templateReply(sheet)}\n\n${HELD_FOR_CLASSIFIER}`);
    }
    if (!classified.value.wellFormed) {
      this.#deps.log.say("classify_refused", { memberH, classifier: classified.value.classifier, model: classified.value.model });
    }

    const planned = this.#planFor(classified.value.classification, message.text, memberH, this.#helperFor(message));
    if (planned.length > 0) {
      const recorded = this.#deps.pipeline.commit(planned, { chatId: message.chatId, messageId: message.messageId }, this.#deps.clock.now());
      this.#deps.log.say("stored", {
        memberH,
        kind: classified.value.classification.kind,
        classifier: classified.value.classifier,
        events: recorded.map((write) => `${write.event.seq}:${write.event.type}`).join(","),
        queue: this.#deps.pipeline.queueDepth(),
      });
    }

    if (!isPrivate(message) && !message.mentionsBot) return silent("group message, not mentioned");
    return this.#answer(message, memberH, false, partial);
  }

  async retryHeld(held: HeldMessage): Promise<RetryOutcome> {
    const classified = await this.#deps.classifier.classify(held.text);
    if (!classified.ok) return "model_down";
    const planned = this.#planFor(classified.value.classification, held.text, held.memberH, held.replyToMemberH);
    const recorded = planned.length === 0 ? [] : this.#deps.pipeline.commit(planned, { chatId: held.chatId, messageId: held.messageId }, held.receivedAt);
    this.#deps.log.say("stored_after_outage", {
      memberH: held.memberH,
      kind: classified.value.classification.kind,
      classifier: classified.value.classifier,
      events: recorded.map((write) => `${write.event.seq}:${write.event.type}`).join(","),
    });
    return "classified";
  }

  #planFor(classification: Classification, text: string, memberH: string, helperH: string | null): readonly PlannedWrite[] {
    const state = this.#deps.cache.state();
    const planned = planWrites(classification, text, {
      memberH,
      consented: true,
      themes: [...state.themes.values()].map((theme) => ({ themeId: theme.themeId, label: theme.label })),
      replyToMemberH: helperH,
      helperPairDayCounts: helperH === null ? new Map() : (state.members.get(helperH)?.helperPairDayCounts ?? new Map()),
      day: this.#deps.clock.now().toISOString().slice(0, 10),
      ids: this.#deps.ids,
    });
    if (!planned.ok) {
      this.#deps.log.say("gate_refused", { code: planned.code, detail: planned.detail ?? "" });
      return [];
    }
    return planned.value;
  }

  #helperFor(message: IncomingMessage): string | null {
    if (message.replyToUserId === null || message.replyToIsBot) return null;
    const helperH = this.memberHashOf(message.replyToUserId);
    return this.#deps.cache.state().members.get(helperH)?.consented === true ? helperH : null;
  }

  async #answer(message: IncomingMessage, memberH: string, modelDown: boolean, partial: boolean): Promise<MemberAction> {
    const saved = this.#deps.cache.memoriesOf(memberH).length;
    const sheet = buildFactsSheet(this.#deps.cache.state(), memberH, this.#deps.clock.now(), saved);
    const suffix = partial ? `\n\n${ERRORS.MEMORY_PARTIAL.message}` : "";
    if (modelDown) return reply(`${templateReply(sheet)}\n\n${ERRORS.MODEL_UNAVAILABLE.message}${suffix}`);

    const asked = await this.#deps.replyModel.ask({ prompt: replyPrompt(sheet, message.text), json: false });
    if (!asked.ok) {
      this.#deps.log.say("reply_model_failed", { code: asked.code });
      return reply(`${templateReply(sheet)}\n\n${ERRORS.MODEL_UNAVAILABLE.message}${suffix}`);
    }
    const reviewed = reviewReply(asked.value.text, sheet);
    if (!reviewed.ok) {
      this.#deps.log.say("reply_refused", { detail: reviewed.detail ?? "", model: asked.value.model });
      return reply(`${templateReply(sheet)}\n\n${ERRORS.MODEL_OUTPUT_REFUSED.message}${suffix}`);
    }
    return reply(`${reviewed.value}${suffix}`);
  }

  #speak(message: IncomingMessage, text: string): MemberAction {
    if (isPrivate(message) || message.mentionsBot || isCommand(message.text)) return reply(text);
    return silent("group message, not mentioned");
  }
}

export { commandOf };
