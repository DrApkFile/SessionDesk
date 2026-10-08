import { MemberService } from "../../src/bots/member/service.js";
import type { IncomingMessage } from "../../src/bots/shared/incoming.js";
import { userKey, type ChatKind, type Platform } from "../../src/platform/platform.js";
import { MemberDirectory } from "../../src/bots/shared/directory.js";
import { MemoryHealth } from "../../src/bots/shared/health.js";
import { Log } from "../../src/bots/shared/log.js";
import { EventPipeline } from "../../src/bots/shared/pipeline.js";
import { CommunityChat } from "../../src/bots/shared/startup.js";
import { countingIds } from "../../src/core/ports.js";
import { SeqAllocator } from "../../src/core/seq.js";
import { LedgerCache } from "../../src/memory/cache.js";
import { WriteQueue } from "../../src/memory/writeQueue.js";
import { Classifier } from "../../src/models/classifier.js";
import { GeminiModel } from "../../src/models/gemini.js";
import { GroqModel } from "../../src/models/groq.js";
import { ReplyChain } from "../../src/models/replyChain.js";
import { PendingClassifications } from "../../src/bots/shared/pending.js";
import type { FetchLike } from "../../src/models/textModel.js";
import { FakeMemory, type FakeMemoryOptions } from "./fakeMemory.js";

export const GROUP_CHAT_ID = -1001234567890;
export const MANAGER_ID = 4242;
export const COMMUNITY = "c1";
export const SECRET_PHRASE = "ada@example.com";

export interface HarnessOptions {
  readonly classification?: string;
  readonly replyText?: string;
  readonly modelStatus?: number;
  readonly groqStatus?: number;
  readonly groqClassification?: string;
  readonly groqReplyText?: string;
  readonly memory?: FakeMemoryOptions;
  readonly managerKeys?: readonly string[];
  readonly platform?: Platform;
  readonly communityChatId?: string | number | null;
  readonly directMessagesNeedOptIn?: boolean;
}

export interface MessageDraft {
  readonly platform?: Platform;
  readonly chatId?: string | number;
  readonly chatKind?: ChatKind;
  readonly chatType?: "private" | "group" | "supergroup" | "channel";
  readonly messageId?: string | number;
  readonly userId?: string | number;
  readonly isBot?: boolean;
  readonly userName?: string | null;
  readonly text?: string;
  readonly mentionsBot?: boolean;
  readonly replyToUserId?: string | number | null;
  readonly replyToIsBot?: boolean;
  readonly replyToText?: string | null;
}

export function draftToMessage(defaults: IncomingMessage, draft: MessageDraft): IncomingMessage {
  const chatKind: ChatKind =
    draft.chatKind ?? (draft.chatType === undefined ? defaults.chatKind : draft.chatType === "private" ? "direct" : draft.chatType === "channel" ? "other" : "community");
  return {
    platform: draft.platform ?? defaults.platform,
    chatId: draft.chatId === undefined ? defaults.chatId : String(draft.chatId),
    chatKind,
    messageId: draft.messageId === undefined ? defaults.messageId : String(draft.messageId),
    userId: draft.userId === undefined ? defaults.userId : String(draft.userId),
    isBot: draft.isBot ?? defaults.isBot,
    userName: draft.userName === undefined ? defaults.userName : draft.userName,
    text: draft.text ?? defaults.text,
    mentionsBot: draft.mentionsBot ?? defaults.mentionsBot,
    replyToUserId: draft.replyToUserId === undefined ? defaults.replyToUserId : draft.replyToUserId === null ? null : String(draft.replyToUserId),
    replyToIsBot: draft.replyToIsBot ?? defaults.replyToIsBot,
    replyToText: draft.replyToText === undefined ? defaults.replyToText : draft.replyToText,
  };
}

export interface Harness {
  readonly service: MemberService;
  readonly pending: PendingClassifications;
  readonly classifier: Classifier;
  readonly replies: ReplyChain;
  readonly waits: number[];
  readonly directory: MemberDirectory;
  readonly cache: LedgerCache;
  readonly queue: WriteQueue;
  readonly memory: FakeMemory;
  readonly health: MemoryHealth;
  readonly chat: CommunityChat;
  readonly logLines: string[];
  readonly clock: { now: () => Date };
  message(partial: MessageDraft): IncomingMessage;
  namespaceOfMember(userId: number | string): string;
  breakModel(status?: number): void;
  classifyAs(json: string): void;
  mendModel(): void;
  breakGroq(status?: number): void;
  breakReplyModels(status?: number): void;
  breakGroqReplies(status?: number): void;
  advanceMinutes(minutes: number): void;
}

interface ModelState {
  status: number;
  replyStatus: number | null;
  groqStatus: number;
  groqReplyStatus: number | null;
  at: Date;
  classification: string;
}

function modelFetch(options: HarnessOptions, modelState: ModelState): FetchLike {
  return async (_url, init) => {
    const classifying = init.body.includes("Reply with JSON only");
    const status = classifying ? modelState.status : (modelState.replyStatus ?? modelState.status);
    if (status >= 400) return { ok: false, status, text: async () => "high demand" };
    const text = classifying ? modelState.classification : (options.replyText ?? "Here is what I have on record for you.");
    return { ok: true, status, text: async () => JSON.stringify({ candidates: [{ content: { parts: [{ text }] } }] }) };
  };
}

function groqFetch(options: HarnessOptions, modelState: ModelState): FetchLike {
  return async (_url, init) => {
    const classifying = init.body.includes("Reply with JSON only");
    const groqStatus = classifying ? modelState.groqStatus : (modelState.groqReplyStatus ?? modelState.groqStatus);
    if (groqStatus >= 400) return { ok: false, status: groqStatus, text: async () => "groq down" };
    const text = classifying
      ? (options.groqClassification ?? '{"kind":"feedback","themeLabel":"from groq"}')
      : (options.groqReplyText ?? "Answer from the backup model.");
    return { ok: true, status: 200, text: async () => JSON.stringify({ choices: [{ message: { content: text } }] }) };
  };
}

export function harness(options: HarnessOptions = {}): Harness {
  const modelState: ModelState = {
    status: options.modelStatus ?? 200,
    replyStatus: null,
    groqStatus: options.groqStatus ?? 200,
    groqReplyStatus: null,
    at: new Date("2026-10-08T09:00:00.000Z"),
    classification: options.classification ?? '{"kind":"chit_chat"}',
  };
  const memory = new FakeMemory(options.memory ?? {});
  const cache = new LedgerCache();
  const queue = new WriteQueue(memory, async () => {}, (job) => {
    if (job.state === "saved" && job.blobId !== null) cache.markSaved(job.seq, job.namespace, job.blobId);
    if (job.state === "failed" && job.code !== null) cache.markFailed(job.seq, job.namespace, job.code);
  });
  const logLines: string[] = [];
  const health = new MemoryHealth();
  health.applyBoot(
    { namespaces: 0, linesRead: 0, decoded: 0, undecodable: 0, dropped: 0, partialNamespaces: [], atLimitNamespaces: [], failures: [], maxSeq: 0, nextSeq: 1, complete: true },
    new Date("2026-10-08T09:00:00.000Z"),
  );
  const chat = new CommunityChat(options.communityChatId === null ? null : (options.communityChatId ?? GROUP_CHAT_ID), () => {
    const where = cache.state().governance.community;
    return where === null ? null : { platform: where.platform, chatId: where.chatId };
  });
  const directory = new MemberDirectory();
  const self = { username: "sdmemberbot" };
  const clock = { now: () => modelState.at };
  const waits: number[] = [];
  const gemini = new GeminiModel({ apiKey: "AIzatestkey", model: "gemini-3.8-flash", fallbackModel: "gemini-3.5-flash" }, async () => {}, modelFetch(options, modelState));
  const groq = new GroqModel({ apiKey: "gsk_testkey", model: "qwen/qwen3.8-27b" }, async () => {}, groqFetch(options, modelState));
  const classifier = new Classifier(gemini, groq, clock);
  const geminiPrimary = new GeminiModel({ apiKey: "AIzatestkey", model: "gemini-3.8-flash", fallbackModel: "gemini-3.8-flash" }, async () => {}, modelFetch(options, modelState));
  const geminiBackup = new GeminiModel({ apiKey: "AIzatestkey", model: "gemini-3.5-flash", fallbackModel: "gemini-3.5-flash" }, async () => {}, modelFetch(options, modelState));
  const replies = new ReplyChain([geminiPrimary, geminiBackup, groq]);
  let built: MemberService | null = null;
  const pending = new PendingClassifications(
    async (ms) => {
      waits.push(ms);
    },
    clock,
    async (held) => (built === null ? "model_down" : built.retryHeld(held)),
    new Log("pending", (line) => logLines.push(line)),
  );
  const service = new MemberService({
    communityKey: COMMUNITY,
    namespaceSecret: "f".repeat(64),
    cache,
    pipeline: new EventPipeline(new SeqAllocator(1), () => cache, queue, COMMUNITY),
    health,
    classifier,
    replies,
    pending,
    clock,
    log: new Log("test", (line) => logLines.push(line)),
    chat,
    ids: countingIds(),
    directory,
    directMessagesNeedOptIn: options.directMessagesNeedOptIn ?? true,
    memory,
    managerIds: options.managerKeys ?? [userKey("telegram", String(MANAGER_ID))],
    self,
  });

  built = service;

  return {
    service,
    pending,
    classifier,
    replies,
    waits,
    directory,
    cache,
    queue,
    memory,
    health,
    chat,
    logLines,
    clock,
    namespaceOfMember: (userId) => `sd-${COMMUNITY}-m-${service.memberHashOf(userId, options.platform ?? "telegram")}`,
    breakModel: (status = 503) => {
      modelState.status = status;
    },
    classifyAs: (json: string) => {
      modelState.classification = json;
    },
    mendModel: () => {
      modelState.status = 200;
    },
    breakGroq: (status = 503) => {
      modelState.groqStatus = status;
    },
    breakReplyModels: (status = 503) => {
      modelState.replyStatus = status;
    },
    breakGroqReplies: (status = 503) => {
      modelState.groqReplyStatus = status;
    },
    advanceMinutes: (minutes: number) => {
      modelState.at = new Date(modelState.at.getTime() + minutes * 60_000);
    },
    message: (partial) =>
      draftToMessage(
        {
          platform: options.platform ?? "telegram",
          chatId: String(options.communityChatId ?? GROUP_CHAT_ID),
          chatKind: "community",
          messageId: "1",
          userId: "42000001",
          isBot: false,
          userName: "ada",
          text: "hello",
          mentionsBot: false,
          replyToUserId: null,
          replyToIsBot: false,
          replyToText: null,
        },
        partial,
      ),
  };
}
