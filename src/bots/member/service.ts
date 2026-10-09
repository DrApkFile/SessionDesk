import type { Classification } from "../../core/classification.js";
import { ERRORS } from "../../core/errors.js";
import { buildFactsSheet, templateReply } from "../../core/factsSheet.js";
import { memberHash, resolveNamespace } from "../../core/namespace.js";
import { ABOUT_OTHERS_REFUSAL, asksAboutAnotherMember } from "../../core/aboutOthers.js";
import { readFeedback } from "../../core/feedbackWords.js";
import type { ItemVisibility } from "../../core/vocabulary.js";
import { captureVerdict } from "../../core/reusableAnswer.js";
import type { MessageKind } from "../../core/vocabulary.js";
import { guardStoredText } from "../../core/redactor.js";
import { ANSWER_FEEDBACK_WINDOW_MINUTES, ANSWER_MAX_DISTANCE, KNOWN_ISSUE_MAX_DISTANCE, MIN_REUSE_CONTENT_WORDS, THEME_LABELS_OFFERED } from "../../core/tuning.js";
import { clipStoredText } from "../../core/text.js";
import { lookUpCommunityKnowledge } from "./communityLookup.js";
import { clarifyWhichReply, conflictNoteForManagers, conflictingAnswersReply, earlierAnswerReply, findEarlierAnswer, findKnownIssue, knownIssueReply, termsSaid } from "./reuse.js";
import { captureChoices, decisionChoices } from "../shared/answerDecisions.js";
import { NO_MANAGER_REACHABLE, answerToConfirmNotice } from "../shared/answerNotice.js";
import type { AnswerSource } from "../../core/vocabulary.js";
import { reuseQueryOf, strippedOfNames } from "../../core/reuseQuery.js";
import { keyTermsIn, type TermAgreement } from "../../core/keyTerms.js";
import type { AnswerMatch } from "../../core/answers.js";
import type { CommittableWrite } from "../shared/pipeline.js";
import { internalLeakIn, reviewReply } from "../../core/replyGuard.js";
import { planWrites, themeFor, type PlannedWrite } from "../../core/writeGate.js";
import { replyPrompt } from "../../models/prompts.js";
import { memberCommands } from "./commands.js";
import type { MemberDeps } from "./deps.js";
import { consentKey, dmAddressKey } from "../../core/idempotency.js";
import { dmAddressDraft } from "../../core/dmAddress.js";
import { userKey, type ChatKind, type Platform } from "../../platform/platform.js";
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

interface AnswerCapture {
  readonly answerId: string;
  readonly question: string | null;
  readonly answer: string;
  readonly source: AnswerSource;
  readonly writes: readonly CommittableWrite[];
}

export interface ConsentTap {
  readonly platform?: Platform;
  readonly userId: string | number;
  readonly chatId: string | number;
  readonly chatKind: ChatKind;
  readonly messageId: string | number;
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
  readonly #pendingClarifications = new Map<string, { answerId: string; blobId: string; question: string; at: number }>();

  constructor(deps: MemberDeps) {
    this.#deps = deps;
  }

  memberHashOf(userId: string | number, platform: Platform = "telegram"): string {
    return memberHash(this.#deps.namespaceSecret, { platform, id: String(userId) });
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
    if (message.chatKind === "other") return silent("not a chat the bot serves");
    if (!isPrivate(message)) {
      const known = this.#deps.chat.check(message.chatId);
      if (!known.ok) {
        this.#deps.log.say("foreign_chat", { chatId: message.chatId, detail: known.detail ?? known.code });
        return silent("not the community chat");
      }
    }

    const memberH = this.memberHashOf(message.userId, message.platform);
    this.#deps.directory.remember({ platform: message.platform, userId: message.userId, memberH, userName: message.userName }, this.#deps.clock.now());
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

  recordConsent(userId: string | number, chatId: string | number, messageId: string | number, scope: ConsentScope, platform: Platform = "telegram"): MemberAction {
    const memberH = this.memberHashOf(userId, platform);
    if (this.#deps.cache.state().members.get(memberH)?.consented === true) return reply(ALREADY_CONSENTED);
    this.#writeConsent(memberH, scope, String(chatId), String(messageId));
    if (scope === "storage_and_dm") this.#writeDmAddress(memberH, String(userId), String(chatId), String(messageId), platform);
    return reply(scope === "storage_and_dm" ? DM_CONSENT_RECORDED : CONSENT_RECORDED);
  }

  #rememberDmAddress(message: IncomingMessage, memberH: string): void {
    const member = this.#deps.cache.state().members.get(memberH);
    if (member === undefined || !member.consented || !member.dmConsent || member.dmUserId !== null) return;
    this.#deps.pipeline.commit(
      [{ draft: dmAddressDraft(message.platform, message.userId), namespaces: [{ kind: "member", memberH }], idempotency: dmAddressKey(this.#deps.communityKey, memberH) }],
      { chatId: message.chatId, messageId: message.messageId },
      this.#deps.clock.now(),
    );
    this.#deps.log.say("dm_address_stored", { memberH, note: "telegram id stored encrypted for promise follow-ups" });
  }

  #captureManagerAnswer(message: IncomingMessage, kind: MessageKind, label: string | undefined): AnswerCapture | null {
    const question = message.replyToText;
    if (question === null || message.replyToUserId === null || message.replyToIsBot) return null;
    if (!this.#deps.managerIds.includes(userKey(message.platform, message.userId))) return null;
    if (this.#deps.managerIds.includes(userKey(message.platform, message.replyToUserId))) return null;
    if (!guardStoredText(question).ok || !guardStoredText(message.text).ok) {
      this.#deps.log.say("answer_secret_blocked", { chat: chatLabel(message) });
      return null;
    }
    const verdict = captureVerdict(kind, question, message.text);
    if (!verdict.worth) {
      this.#deps.log.say("answer_not_captured", { chat: chatLabel(message), because: verdict.because });
      return null;
    }
    const theme = this.#themeFor(label);
    if (theme === null) return null;
    const answerId = this.#deps.ids.newAnswerId();
    const questionText = strippedOfNames(clipStoredText(question), [this.#deps.self.username], this.#knownNames());
    const answerText = clipStoredText(message.text);
    this.#deps.log.say("answer_captured", { chat: chatLabel(message), answerId, source: "manager", reusable: false });
    return {
      answerId,
      question: questionText,
      answer: answerText,
      source: "manager",
      writes: [
        ...theme.created,
        {
          draft: { type: "ANSWER", answerId, questionText, answerText, answeredBy: "manager", themeId: theme.themeId },
          namespaces: [{ kind: "answers" }],
        },
      ],
    };
  }

  #themeFor(label: string | undefined): { readonly themeId: string; readonly created: readonly CommittableWrite[] } | null {
    const held = [...this.#deps.cache.state().themes.values()].map((theme) => ({ themeId: theme.themeId, label: theme.label }));
    const theme = themeFor(label, held, this.#deps.ids);
    if (!theme.ok) return null;
    return { themeId: theme.value.themeId, created: theme.value.created === null ? [] : [{ draft: theme.value.created, namespaces: [{ kind: "themes" }] }] };
  }

  async #askManagersToConfirm(capture: AnswerCapture): Promise<void> {
    const delivery = await this.#deps
      .notifyManagers({
        text: answerToConfirmNotice(capture.source, capture.question, capture.answer, capture.answerId),
        answerIds: [capture.answerId],
        choices: captureChoices(capture.answerId),
      })
      .catch(() => ({ delivered: 0, failed: 0 }));
    this.#deps.log.say("answer_awaiting_confirmation", {
      answerId: capture.answerId,
      source: capture.source,
      managersReached: delivery.delivered,
      managersUnreachable: delivery.failed,
      note: delivery.delivered === 0 ? NO_MANAGER_REACHABLE : "pending until a manager taps Keep",
    });
  }

  #captureThankedAnswer(message: IncomingMessage, kind: string, planned: readonly PlannedWrite[], label: string | undefined): AnswerCapture | null {
    if (kind !== "thanks" || !planned.some((write) => write.draft.type === "CONTRIBUTION")) return null;
    const answerText = message.replyToText;
    if (answerText === null || !guardStoredText(answerText).ok) return null;
    const theme = this.#themeFor(label);
    if (theme === null) return null;
    const answerId = this.#deps.ids.newAnswerId();
    const clipped = clipStoredText(answerText);
    this.#deps.log.say("answer_captured", { chat: chatLabel(message), answerId, source: "member", reusable: false });
    return {
      answerId,
      question: null,
      answer: clipped,
      source: "member",
      writes: [
        ...theme.created,
        {
          draft: { type: "ANSWER", answerId, answerText: clipped, answeredBy: "member", themeId: theme.themeId },
          namespaces: [{ kind: "answers" }],
        },
      ],
    };
  }

  #upgradeToDm(message: IncomingMessage, memberH: string): MemberAction {
    const member = this.#deps.cache.state().members.get(memberH);
    if (member === undefined || !member.consented) {
      this.#writeConsent(memberH, "storage_and_dm", message.chatId, message.messageId);
      this.#writeDmAddress(memberH, message.userId, message.chatId, message.messageId, message.platform);
      return reply(DM_CONSENT_RECORDED);
    }
    if (member.dmConsent && member.dmUserId !== null) return reply(ALREADY_CONSENTED);
    this.#writeConsent(memberH, "storage_and_dm", message.chatId, message.messageId);
    this.#writeDmAddress(memberH, message.userId, message.chatId, message.messageId, message.platform);
    return reply(DM_CONSENT_RECORDED);
  }

  #writeConsent(memberH: string, scope: ConsentScope, chatId: string, messageId: string): number {
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

  #writeDmAddress(memberH: string, userId: string, chatId: string, messageId: string, platform: Platform = "telegram"): void {
    this.#deps.pipeline.commit(
      [
        {
          draft: dmAddressDraft(platform, userId),
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
    const platform = tap.platform ?? "telegram";
    const inCommunity = tap.chatKind === "direct" || this.#deps.chat.check(String(tap.chatId)).ok;
    if (!inCommunity) {
      this.#deps.log.say("tap_ignored", { chat: String(tap.chatId), reason: "not the community chat" });
      return { ignored: true, wrote: false, alert: "" };
    }
    const memberH = this.memberHashOf(String(tap.userId), platform);
    const member = this.#deps.cache.state().members.get(memberH);
    const wantsDm = tap.scope === "storage_and_dm";
    const canDmNow = tap.chatKind === "direct" || !this.#deps.directMessagesNeedOptIn;

    if (member?.consented === true) {
      if (wantsDm && canDmNow && (!member.dmConsent || member.dmUserId === null)) {
        this.#writeConsent(memberH, "storage_and_dm", String(tap.chatId), String(tap.messageId));
        this.#writeDmAddress(memberH, String(tap.userId), String(tap.chatId), String(tap.messageId), platform);
        return { ignored: false, wrote: true, alert: tapWelcome(this.#deps.self.username) };
      }
      this.#deps.log.say("tap_duplicate", { memberH, chat: tap.chatKind === "direct" ? "dm" : String(tap.chatId) });
      return { ignored: false, wrote: false, alert: wantsDm && !canDmNow ? tapNeedsDmStart(this.#deps.self.username) : TAP_ALREADY };
    }

    const scope: ConsentScope = wantsDm && canDmNow ? "storage_and_dm" : "storage";
    this.#writeConsent(memberH, scope, String(tap.chatId), String(tap.messageId));
    if (scope === "storage_and_dm") this.#writeDmAddress(memberH, String(tap.userId), String(tap.chatId), String(tap.messageId), platform);
    const alert = wantsDm && !canDmNow ? tapNeedsDmStart(this.#deps.self.username) : tapWelcome(this.#deps.self.username);
    return { ignored: false, wrote: true, alert };
  }

  async #askWhichQuestion(message: IncomingMessage, memberH: string, match: AnswerMatch, agreement: TermAgreement): Promise<MemberAction> {
    const storedTerm = agreement.onlyStored[0]?.surface ?? keyTermsIn(match.answer.answerText)[0]?.surface ?? null;
    const askedTerm = agreement.onlyAsked[0]?.surface ?? null;
    if (storedTerm === null || askedTerm === null) {
      this.#deps.log.say("reuse_withheld", { memberH, answerId: match.answer.answerId, reason: "key terms differ and neither side can be named" });
      return this.#answer(message, memberH, false, false);
    }
    this.#pendingClarifications.set(`${message.chatId}|${memberH}`, {
      answerId: match.answer.answerId,
      blobId: match.blobId,
      question: message.text,
      at: this.#deps.clock.now().getTime(),
    });
    this.#deps.log.say("reuse_clarification_asked", {
      memberH,
      answerId: match.answer.answerId,
      storedTerm,
      askedTerm,
    });
    return reply(clarifyWhichReply(storedTerm, askedTerm));
  }

  async #readClarification(message: IncomingMessage, memberH: string): Promise<MemberAction | null> {
    const key = `${message.chatId}|${memberH}`;
    const pending = this.#pendingClarifications.get(key);
    if (pending === undefined) return null;
    if ((this.#deps.clock.now().getTime() - pending.at) / 60_000 > ANSWER_FEEDBACK_WINDOW_MINUTES) {
      this.#pendingClarifications.delete(key);
      return null;
    }
    const reading = readFeedback(message.text);
    if (reading === "unclear") {
      this.#pendingClarifications.delete(key);
      return null;
    }
    this.#pendingClarifications.delete(key);
    const answer = this.#deps.cache.state().answers.get(pending.answerId);
    if (reading === "helpful" && answer !== undefined && answer.state === "active") {
      this.#deps.log.say("answer_reused", { memberH, answerId: answer.answerId, after: "clarification" });
      this.#offerPending(message, memberH, answer.answerId);
      return this.#speak(message, earlierAnswerReply({ answer, blobId: pending.blobId, distance: 0 }));
    }
    this.#deps.log.say("reuse_declined", { memberH, answerId: pending.answerId });
    return this.#answer({ ...message, text: pending.question }, memberH, false, false);
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

    const clarified = await this.#readClarification(message, memberH);
    if (clarified !== null) return clarified;

    const feedback = this.#readAnswerFeedback(message, memberH);
    if (feedback !== null) return feedback;

    const guarded = guardStoredText(message.text);
    if (!guarded.ok) {
      this.#deps.log.say("secret_blocked", { memberH, chat: chatLabel(message), kinds: guarded.detail ?? "" });
      return reply(SECRET_WARNING);
    }

    const classified = await this.#deps.classifier.classify(message.text, this.#knownThemeLabels());
    if (!classified.ok) {
      this.#deps.pending.hold({
        memberH,
        text: message.text,
        chatId: message.chatId,
        messageId: message.messageId,
        receivedAt: this.#deps.clock.now(),
        replyToMemberH: this.#helperFor(message),
        visibility: isPrivate(message) ? "private" : "public",
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
    const visibility: ItemVisibility = isPrivate(message) ? "private" : "public";
    const planned = this.#planFor(classified.value.classification, message.text, memberH, this.#helperFor(message), visibility);
    const thanked = this.#captureThankedAnswer(message, kind, planned, classified.value.classification.themeLabel);
    const capture = thanked ?? this.#captureManagerAnswer(message, kind, classified.value.classification.themeLabel);
    const answerWrites = capture === null ? [] : capture.writes;

    let knownIssue = null;
    let writes: readonly CommittableWrite[] = [...planned, ...answerWrites];
    if ((kind === "bug" || kind === "feature" || kind === "feedback") && planned.some((write) => write.draft.type === "ITEM_OPENED")) {
      const looked = await findKnownIssue(this.#deps.memory, this.#deps.communityKey, this.#deps.cache.state(), message.text);
      knownIssue = looked.kind === "one" ? looked.match : null;
      const near = looked.kind === "none" ? null : looked.match;
      this.#deps.log.say("known_issue_attempt", {
        memberH,
        classifiedAs: kind,
        maxDistance: KNOWN_ISSUE_MAX_DISTANCE,
        decision: looked.kind,
        distance: near === null ? "" : Math.round(near.distance * 1000) / 1000,
        reportTerms: looked.kind === "none" ? "" : termsSaid(looked.agreement.asked),
        itemTerms: looked.kind === "none" ? "" : termsSaid(looked.agreement.stored),
        termsOnlyInReport: looked.kind === "terms_differ" ? termsSaid(looked.agreement.onlyAsked.map((key) => key.term)) : "",
      });
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

    if (capture !== null) await this.#askManagersToConfirm(capture);

    if (knownIssue !== null) {
      const affected = this.#deps.cache.state().items.get(knownIssue.item.itemId)?.affected ?? knownIssue.item.affected;
      return this.#speak(message, knownIssueReply(knownIssue, affected));
    }

    if (kind === "question") {
      const query = reuseQueryOf(message.text, [this.#deps.self.username], this.#knownNames());
      if (!query.worthMatching) {
        this.#deps.log.say("reuse_skipped", {
          memberH,
          reason: "too few content words after stripping names",
          contentWords: query.contentWords.length,
          needed: MIN_REUSE_CONTENT_WORDS,
        });
      } else {
        const attempt = await findEarlierAnswer(this.#deps.memory, this.#deps.communityKey, this.#deps.cache.state(), query.text);
        this.#deps.log.say("reuse_attempt", {
          memberH,
          classifiedAs: kind,
          classifier: classified.value.classifier,
          contentWords: query.contentWords.length,
          candidates: attempt.candidates,
          topDistances: attempt.topDistances.join(","),
          maxDistance: ANSWER_MAX_DISTANCE,
          decision: attempt.lookup.kind,
          askedTerms: termsSaid(attempt.terms.asked),
          storedTerms: termsSaid(attempt.terms.stored),
          termsOnlyInQuestion: termsSaid(attempt.terms.onlyAsked),
          termsOnlyInAnswer: termsSaid(attempt.terms.onlyStored),
        });
        if (attempt.lookup.kind === "unclear") {
          return this.#askWhichQuestion(message, memberH, attempt.lookup.match, attempt.lookup.agreement);
        }
        if (attempt.lookup.kind === "one") {
          this.#deps.log.say("answer_reused", {
            memberH,
            answerId: attempt.lookup.match.answer.answerId,
            distance: Math.round(attempt.lookup.match.distance * 1000) / 1000,
          });
          this.#offerPending(message, memberH, attempt.lookup.match.answer.answerId);
          return this.#speak(message, earlierAnswerReply(attempt.lookup.match));
        }
        if (attempt.lookup.kind === "conflicting") {
          const matches = attempt.lookup.matches;
          this.#deps.log.say("reuse_conflict", { memberH, answers: matches.map((match) => match.answer.answerId).join(",") });
          await this.#deps
            .notifyManagers({
              text: conflictNoteForManagers(query.text, matches),
              answerIds: matches.slice(0, 2).map((match) => match.answer.answerId),
              choices: decisionChoices(matches.slice(0, 2).map((match) => match.answer.answerId)),
            })
            .catch(() => undefined);
          return this.#speak(message, conflictingAnswersReply());
        }
      }
    }

    if (!isPrivate(message) && !message.mentionsBot) return silent("group message, not mentioned");
    return this.#answer(message, memberH, false, partial);
  }

  async retryHeld(held: HeldMessage): Promise<RetryOutcome> {
    const classified = await this.#deps.classifier.classify(held.text);
    if (!classified.ok) return "model_down";
    const planned = this.#planFor(classified.value.classification, held.text, held.memberH, held.replyToMemberH, held.visibility);
    const recorded = planned.length === 0 ? [] : this.#deps.pipeline.commit(planned, { chatId: held.chatId, messageId: held.messageId }, held.receivedAt);
    this.#deps.log.say("stored_after_outage", {
      memberH: held.memberH,
      kind: classified.value.classification.kind,
      classifier: classified.value.classifier,
      events: recorded.map((write) => `${write.event.seq}:${write.event.type}`).join(","),
    });
    return "classified";
  }

  #planFor(
    classification: Classification,
    text: string,
    memberH: string,
    helperH: string | null,
    visibility: ItemVisibility,
  ): readonly PlannedWrite[] {
    const state = this.#deps.cache.state();
    const planned = planWrites(classification, text, {
      memberH,
      consented: true,
      themes: [...state.themes.values()].map((theme) => ({ themeId: theme.themeId, label: theme.label })),
      replyToMemberH: helperH,
      helperPairDayCounts: helperH === null ? new Map() : (state.members.get(helperH)?.helperPairDayCounts ?? new Map()),
      day: this.#deps.clock.now().toISOString().slice(0, 10),
      ids: this.#deps.ids,
      visibility,
    });
    if (!planned.ok) {
      this.#deps.log.say("gate_refused", { code: planned.code, detail: planned.detail ?? "" });
      return [];
    }
    return planned.value;
  }

  #helperFor(message: IncomingMessage): string | null {
    if (message.replyToUserId === null || message.replyToIsBot) return null;
    const helperH = this.memberHashOf(message.replyToUserId, message.platform);
    return this.#deps.cache.state().members.get(helperH)?.consented === true ? helperH : null;
  }

  async #answer(message: IncomingMessage, memberH: string, modelDown: boolean, partial: boolean): Promise<MemberAction> {
    const asking = asksAboutAnotherMember(message.text, [this.#deps.self.username], this.#otherNames(memberH));
    if (asking.asksAboutSomeoneElse) {
      this.#deps.log.say("about_others_refused", { memberH, handles: asking.handles.length });
      return reply(ABOUT_OTHERS_REFUSAL);
    }

    const saved = this.#deps.cache.memoriesOf(memberH).length;
    const community = await lookUpCommunityKnowledge(this.#deps.memory, this.#deps.communityKey, this.#deps.cache.state(), message.text);
    this.#deps.log.say("community_lookup", {
      memberH,
      candidates: community.candidates,
      publicItems: community.items.length,
      distances: community.items.map((item) => item.distance).join(","),
      themes: community.themes.length,
      activeAnswers: community.answersConsidered,
      maxDistance: KNOWN_ISSUE_MAX_DISTANCE,
    });
    const sheet = buildFactsSheet(this.#deps.cache.state(), memberH, this.#deps.clock.now(), saved, community);
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

  #knownThemeLabels(): readonly string[] {
    return [...this.#deps.cache.state().themes.values()]
      .sort((left, right) => right.itemIds.length + right.questionCount - (left.itemIds.length + left.questionCount))
      .slice(0, THEME_LABELS_OFFERED)
      .map((theme) => theme.label);
  }

  #knownNames(): readonly string[] {
    return this.#deps.directory.userNames();
  }

  #otherNames(memberH: string): readonly string[] {
    const names: string[] = [];
    for (const known of this.#deps.cache.state().members.keys()) {
      if (known === memberH) continue;
      const seen = this.#deps.directory.byMemberH(known);
      if (seen?.userName != null) names.push(seen.userName);
    }
    return names;
  }

  #speak(message: IncomingMessage, text: string): MemberAction {
    if (isPrivate(message) || message.mentionsBot || isCommand(message.text)) return reply(text);
    return silent("group message, not mentioned");
  }
}

export { commandOf };
