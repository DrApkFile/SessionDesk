import type { Classification } from "../../core/classification.js";
import { ERRORS } from "../../core/errors.js";
import { buildFactsSheet, templateReply } from "../../core/factsSheet.js";
import { memberHash, resolveNamespace } from "../../core/namespace.js";
import { readFeedback } from "../../core/feedbackWords.js";
import { guardStoredText } from "../../core/redactor.js";
import { ANSWER_FEEDBACK_WINDOW_MINUTES } from "../../core/tuning.js";
import { clipStoredText } from "../../core/text.js";
import { earlierAnswerReply, findEarlierAnswer, findKnownIssue, knownIssueReply } from "./reuse.js";
import type { CommittableWrite } from "../shared/pipeline.js";
import { internalLeakIn, reviewReply } from "../../core/replyGuard.js";
import { planWrites, themeFor, type PlannedWrite } from "../../core/writeGate.js";
import { replyPrompt } from "../../models/prompts.js";
import { memberCommands } from "./commands.js";
import type { MemberDeps } from "./deps.js";
import { consentKey, dmAddressKey } from "../../core/idempotency.js";
import type { HeldMessage, RetryOutcome } from "../shared/pending.js";
import { chatLabel, commandOf, isCommand, isPrivate, reply, silent, type IncomingMessage, type MemberAction } from "../shared/incoming.js";
import {
  ALREADY_CONSENTED,
  CONSENT_NOTICE,
  CONSENT_RECORDED,
  DM_CONSENT_RECORDED,
  DM_START_PAYLOAD,
  GROUP_OPTIN_PROMPT,
  HELD_FOR_CLASSIFIER,
  SECRET_WARNING,
  FEEDBACK_HELPFUL,
  FEEDBACK_NOT_HELPFUL,
  TAP_ALREADY,
  tapNeedsDmStart,
  tapWelcome,
  type ConsentScope,
} from "./notices.js";

export interface ConsentTap {
  readonly userId: number;
  readonly chatId: number;
  readonly chatType: "private" | "group" | "supergroup" | "channel";
  readonly messageId: number;
  readonly scope: ConsentScope;
}

export interface TapOutcome {
  readonly ignored: boolean;
  readonly wrote: boolean;
  readonly alert: string;
}

export class MemberService {
  readonly #deps: MemberDeps;
  readonly #offers = new Map<string, { answerId: string; at: number }>();

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
    this.#rememberDmAddress(message, memberH);
    const problem = this.#deps.health.problemFor(this.namespacesFor(memberH));
    if (problem === "MEMORY_UNAVAILABLE") {
      this.#deps.log.say("memory_unavailable", { memberH, chat: chatLabel(message) });
      return this.#speak(message, ERRORS.MEMORY_UNAVAILABLE.message);
    }

    if (isCommand(message.text)) {
      const command = commandOf(message.text);
      if (command.name === "/start" && command.rest.trim().toLowerCase() === DM_START_PAYLOAD && isPrivate(message)) {
        return this.#upgradeToDm(message, memberH);
      }
      return memberCommands(this.#deps, message, memberH);
    }
    return this.#handleTalk(message, memberH, problem === "MEMORY_PARTIAL");
  }

  recordConsent(userId: number, chatId: number, messageId: number, scope: ConsentScope): MemberAction {
    const memberH = this.memberHashOf(userId);
    if (this.#deps.cache.state().members.get(memberH)?.consented === true) return reply(ALREADY_CONSENTED);
    this.#writeConsent(memberH, scope, chatId, messageId);
    if (scope === "storage_and_dm") this.#writeDmAddress(memberH, userId, chatId, messageId);
    return reply(scope === "storage_and_dm" ? DM_CONSENT_RECORDED : CONSENT_RECORDED);
  }

  #rememberDmAddress(message: IncomingMessage, memberH: string): void {
    const member = this.#deps.cache.state().members.get(memberH);
    if (member === undefined || !member.consented || !member.dmConsent || member.dmUserId !== null) return;
    this.#deps.pipeline.commit(
      [{ draft: { type: "DM_ADDRESS", telegramUserId: message.userId }, namespaces: [{ kind: "member", memberH }] }],
      { chatId: message.chatId, messageId: message.messageId },
      this.#deps.clock.now(),
    );
    this.#deps.log.say("dm_address_stored", { memberH, note: "telegram id stored encrypted for promise follow-ups" });
  }

  #captureAnswer(message: IncomingMessage, label: string | undefined): readonly CommittableWrite[] {
    const question = message.replyToText;
    if (question === null || message.replyToUserId === null || message.replyToIsBot) return [];
    if (!question.includes("?")) return [];
    if (!this.#deps.managerIds.includes(message.userId)) return [];
    if (this.#deps.managerIds.includes(message.replyToUserId)) return [];
    if (!guardStoredText(question).ok || !guardStoredText(message.text).ok) {
      this.#deps.log.say("answer_secret_blocked", { chat: chatLabel(message) });
      return [];
    }
    const state = this.#deps.cache.state();
    const theme = themeFor(label, [...state.themes.values()].map((held) => ({ themeId: held.themeId, label: held.label })), this.#deps.ids);
    if (!theme.ok) return [];
    const created: readonly CommittableWrite[] = theme.value.created === null ? [] : [{ draft: theme.value.created, namespaces: [{ kind: "themes" }] }];
    return [
      ...created,
      {
        draft: {
          type: "ANSWER",
          answerId: this.#deps.ids.newAnswerId(),
          questionText: clipStoredText(question),
          answerText: clipStoredText(message.text),
          answeredBy: "manager",
          themeId: theme.value.themeId,
        },
        namespaces: [{ kind: "answers" }],
      },
    ];
  }

  #captureThankedAnswer(message: IncomingMessage, kind: string, planned: readonly PlannedWrite[], label: string | undefined): readonly CommittableWrite[] {
    if (kind !== "thanks" || !planned.some((write) => write.draft.type === "CONTRIBUTION")) return [];
    const answerText = message.replyToText;
    if (answerText === null || !guardStoredText(answerText).ok) return [];
    const state = this.#deps.cache.state();
    const theme = themeFor(label, [...state.themes.values()].map((held) => ({ themeId: held.themeId, label: held.label })), this.#deps.ids);
    if (!theme.ok) return [];
    const created: readonly CommittableWrite[] = theme.value.created === null ? [] : [{ draft: theme.value.created, namespaces: [{ kind: "themes" }] }];
    return [
      ...created,
      {
        draft: {
          type: "ANSWER",
          answerId: this.#deps.ids.newAnswerId(),
          answerText: clipStoredText(answerText),
          answeredBy: "member",
          themeId: theme.value.themeId,
        },
        namespaces: [{ kind: "answers" }],
      },
    ];
  }

  #upgradeToDm(message: IncomingMessage, memberH: string): MemberAction {
    const member = this.#deps.cache.state().members.get(memberH);
    if (member === undefined || !member.consented) {
      this.#writeConsent(memberH, "storage_and_dm", message.chatId, message.messageId);
      this.#writeDmAddress(memberH, message.userId, message.chatId, message.messageId);
      return reply(DM_CONSENT_RECORDED);
    }
    if (member.dmConsent && member.dmUserId !== null) return reply(ALREADY_CONSENTED);
    this.#writeConsent(memberH, "storage_and_dm", message.chatId, message.messageId);
    this.#writeDmAddress(memberH, message.userId, message.chatId, message.messageId);
    return reply(DM_CONSENT_RECORDED);
  }

  #writeConsent(memberH: string, scope: ConsentScope, chatId: number, messageId: number): number {
    const recorded = this.#deps.pipeline.commit(
      [
        {
          draft: { type: "CONSENT_GIVEN", scope },
          namespaces: [{ kind: "member", memberH }],
          idempotency: consentKey(this.#deps.communityKey, memberH, scope),
        },
      ],
      { chatId, messageId },
      this.#deps.clock.now(),
    );
    const seq = recorded[0]?.event.seq ?? 0;
    this.#deps.log.say("consent_given", { memberH, scope, seq });
    return seq;
  }

  #writeDmAddress(memberH: string, userId: number, chatId: number, messageId: number): void {
    this.#deps.pipeline.commit(
      [
        {
          draft: { type: "DM_ADDRESS", telegramUserId: userId },
          namespaces: [{ kind: "member", memberH }],
          idempotency: dmAddressKey(this.#deps.communityKey, memberH),
        },
      ],
      { chatId, messageId },
      this.#deps.clock.now(),
    );
    this.#deps.log.say("dm_address_stored", { memberH, note: "telegram id stored encrypted for promise follow-ups" });
  }

  consentFromTap(tap: ConsentTap): TapOutcome {
    const inCommunity = tap.chatType === "private" || this.#deps.chat.check(tap.chatId).ok;
    if (!inCommunity) {
      this.#deps.log.say("tap_ignored", { chat: String(tap.chatId), reason: "not the community chat" });
      return { ignored: true, wrote: false, alert: "" };
    }
    const memberH = this.memberHashOf(tap.userId);
    const member = this.#deps.cache.state().members.get(memberH);
    const wantsDm = tap.scope === "storage_and_dm";
    const canDmNow = tap.chatType === "private";

    if (member?.consented === true) {
      if (wantsDm && canDmNow && (!member.dmConsent || member.dmUserId === null)) {
        this.#writeConsent(memberH, "storage_and_dm", tap.chatId, tap.messageId);
        this.#writeDmAddress(memberH, tap.userId, tap.chatId, tap.messageId);
        return { ignored: false, wrote: true, alert: tapWelcome(this.#deps.self.username) };
      }
      this.#deps.log.say("tap_duplicate", { memberH, chat: tap.chatType === "private" ? "dm" : String(tap.chatId) });
      return { ignored: false, wrote: false, alert: wantsDm && !canDmNow ? tapNeedsDmStart(this.#deps.self.username) : TAP_ALREADY };
    }

    const scope: ConsentScope = wantsDm && canDmNow ? "storage_and_dm" : "storage";
    this.#writeConsent(memberH, scope, tap.chatId, tap.messageId);
    if (scope === "storage_and_dm") this.#writeDmAddress(memberH, tap.userId, tap.chatId, tap.messageId);
    const alert = wantsDm && !canDmNow ? tapNeedsDmStart(this.#deps.self.username) : tapWelcome(this.#deps.self.username);
    return { ignored: false, wrote: true, alert };
  }

  #offerPending(message: IncomingMessage, memberH: string, answerId: string): void {
    this.#offers.set(`${message.chatId}|${memberH}`, { answerId, at: this.#deps.clock.now().getTime() });
  }

  #readAnswerFeedback(message: IncomingMessage, memberH: string): MemberAction | null {
    const key = `${message.chatId}|${memberH}`;
    const offered = this.#offers.get(key);
    if (offered === undefined) return null;
    const ageMinutes = (this.#deps.clock.now().getTime() - offered.at) / 60_000;
    if (ageMinutes > ANSWER_FEEDBACK_WINDOW_MINUTES) {
      this.#offers.delete(key);
      return null;
    }
    const reading = readFeedback(message.text);
    if (reading === "unclear") return null;

    this.#offers.delete(key);
    const helpful = reading === "helpful";
    this.#deps.pipeline.commit(
      [{ draft: { type: "ANSWER_FEEDBACK", answerId: offered.answerId, helpful }, namespaces: [{ kind: "answers" }] }],
      { chatId: message.chatId, messageId: message.messageId },
      this.#deps.clock.now(),
    );
    this.#deps.log.say("answer_feedback", { memberH, answerId: offered.answerId, helpful, storedItem: false });
    return reply(helpful ? FEEDBACK_HELPFUL : FEEDBACK_NOT_HELPFUL);
  }

  async #handleTalk(message: IncomingMessage, memberH: string, partial: boolean): Promise<MemberAction> {
    const state = this.#deps.cache.state();
    const consented = state.members.get(memberH)?.consented === true;
    if (!consented) {
      this.#deps.log.say("not_consented", { memberH, chat: chatLabel(message) });
      if (isPrivate(message)) return reply(CONSENT_NOTICE, true);
      return message.mentionsBot ? reply(GROUP_OPTIN_PROMPT, true) : silent("no consent, not mentioned");
    }

    const feedback = this.#readAnswerFeedback(message, memberH);
    if (feedback !== null) return feedback;

    const guarded = guardStoredText(message.text);
    if (!guarded.ok) {
      this.#deps.log.say("secret_blocked", { memberH, chat: chatLabel(message), kinds: guarded.detail ?? "" });
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
      this.#deps.log.say("classify_deferred", { memberH, chat: chatLabel(message), detail: classified.detail ?? classified.code, outageMs: this.#deps.classifier.outageMs() });
      if (!isPrivate(message) && !message.mentionsBot) return silent("group message, not mentioned");
      const saved = this.#deps.cache.memoriesOf(memberH).length;
      const sheet = buildFactsSheet(this.#deps.cache.state(), memberH, this.#deps.clock.now(), saved);
      return reply(`${templateReply(sheet)}\n\n${HELD_FOR_CLASSIFIER}`);
    }
    if (!classified.value.wellFormed) {
      this.#deps.log.say("classify_refused", { memberH, classifier: classified.value.classifier, model: classified.value.model });
    }

    const kind = classified.value.classification.kind;
    const planned = this.#planFor(classified.value.classification, message.text, memberH, this.#helperFor(message));
    const answerWrites = [
      ...this.#captureAnswer(message, classified.value.classification.themeLabel),
      ...this.#captureThankedAnswer(message, kind, planned, classified.value.classification.themeLabel),
    ];

    let knownIssue = null;
    let writes: readonly CommittableWrite[] = [...planned, ...answerWrites];
    if ((kind === "bug" || kind === "feature" || kind === "feedback") && planned.some((write) => write.draft.type === "ITEM_OPENED")) {
      knownIssue = await findKnownIssue(this.#deps.memory, this.#deps.communityKey, this.#deps.cache.state(), message.text);
      if (knownIssue !== null) {
        writes = [
          { draft: { type: "ITEM_AFFECTS", itemId: knownIssue.item.itemId, memberH }, namespaces: [{ kind: "member", memberH }, { kind: "items" }] },
          ...answerWrites,
        ];
      }
    }

    if (writes.length > 0) {
      const recorded = this.#deps.pipeline.commit(writes, { chatId: message.chatId, messageId: message.messageId }, this.#deps.clock.now());
      this.#deps.log.say("stored", {
        memberH,
        chat: chatLabel(message),
        kind,
        classifier: classified.value.classifier,
        knownIssue: knownIssue === null ? "none" : knownIssue.item.itemId,
        events: recorded.map((write) => `${write.event.seq}:${write.event.type}`).join(","),
        queue: this.#deps.pipeline.queueDepth(),
      });
    }

    if (knownIssue !== null) {
      const affected = this.#deps.cache.state().items.get(knownIssue.item.itemId)?.affected ?? knownIssue.item.affected;
      return this.#speak(message, knownIssueReply(knownIssue, affected));
    }

    if (kind === "question") {
      const earlier = await findEarlierAnswer(this.#deps.memory, this.#deps.communityKey, this.#deps.cache.state(), message.text);
      if (earlier !== null) {
        this.#deps.log.say("answer_reused", { answerId: earlier.answer.answerId, distance: earlier.distance, memberH });
        this.#offerPending(message, memberH, earlier.answer.answerId);
        return this.#speak(message, earlierAnswerReply(earlier));
      }
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
    const fallback = `${ERRORS.MODEL_UNAVAILABLE.message} ${templateReply(sheet)}${suffix}`;
    if (modelDown) return reply(fallback);

    const answered = await this.#deps.replies.askChecked({ prompt: replyPrompt(sheet, message.text), json: false }, (text) => {
      const reviewed = reviewReply(text, sheet);
      if (!reviewed.ok) return { accepted: false, reason: reviewed.detail ?? reviewed.code };
      const leak = internalLeakIn(reviewed.value);
      return leak === null ? { accepted: true, reason: "" } : { accepted: false, reason: `leaked ${leak}` };
    });

    if (!answered.ok) {
      this.#deps.log.say("reply_fell_back_to_template", { memberH, detail: answered.detail ?? answered.code });
      return reply(fallback);
    }
    this.#deps.log.say("reply_answered", {
      memberH,
      answeredBy: answered.value.model,
      attempts: answered.value.attempts,
      tried: answered.value.tried.map((attempt) => `${attempt.model}:${attempt.outcome}`).join(" "),
    });
    return reply(`${answered.value.text.trim()}${suffix}`);
  }

  #speak(message: IncomingMessage, text: string): MemberAction {
    if (isPrivate(message) || message.mentionsBot || isCommand(message.text)) return reply(text);
    return silent("group message, not mentioned");
  }
}

export { commandOf };
