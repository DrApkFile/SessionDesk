import { MemberService } from "../../src/bots/member/service.js";
import type { IncomingMessage } from "../../src/bots/shared/incoming.js";
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
import { PendingClassifications } from "../../src/bots/shared/pending.js";
import type { FetchLike } from "../../src/models/textModel.js";
import { FakeMemory, type FakeMemoryOptions } from "./fakeMemory.js";

export const GROUP_CHAT_ID = -1001234567890;
export const COMMUNITY = "c1";
export const SECRET_PHRASE = "ada@example.com";

export interface HarnessOptions {
  readonly classification?: string;
  readonly replyText?: string;
  readonly modelStatus?: number;
  readonly groqStatus?: number;
  readonly groqClassification?: string;
  readonly memory?: FakeMemoryOptions;
}

export interface Harness {
  readonly service: MemberService;
  readonly pending: PendingClassifications;
  readonly classifier: Classifier;
  readonly waits: number[];
  readonly directory: MemberDirectory;
  readonly cache: LedgerCache;
  readonly queue: WriteQueue;
  readonly memory: FakeMemory;
  readonly health: MemoryHealth;
  readonly chat: CommunityChat;
  readonly logLines: string[];
  readonly clock: { now: () => Date };
  message(partial: Partial<IncomingMessage>): IncomingMessage;
  namespaceOfMember(userId: number): string;
  breakModel(status?: number): void;
  mendModel(): void;
  breakGroq(status?: number): void;
  advanceMinutes(minutes: number): void;
}

interface ModelState {
  status: number;
  groqStatus: number;
  at: Date;
}

function modelFetch(options: HarnessOptions, modelState: ModelState): FetchLike {
  return async (_url, init) => {
    const status = modelState.status;
    if (status >= 400) return { ok: false, status, text: async () => "high demand" };
    const classifying = init.body.includes("Reply with JSON only");
    const text = classifying ? (options.classification ?? '{"kind":"chit_chat"}') : (options.replyText ?? "Here is what I have on record for you.");
    return { ok: true, status, text: async () => JSON.stringify({ candidates: [{ content: { parts: [{ text }] } }] }) };
  };
}

function groqFetch(options: HarnessOptions, modelState: ModelState): FetchLike {
  return async () => {
    if (modelState.groqStatus >= 400) return { ok: false, status: modelState.groqStatus, text: async () => "groq down" };
    const text = options.groqClassification ?? '{"kind":"feedback","themeLabel":"from groq"}';
    return { ok: true, status: 200, text: async () => JSON.stringify({ choices: [{ message: { content: text } }] }) };
  };
}

export function harness(options: HarnessOptions = {}): Harness {
  const modelState: ModelState = { status: options.modelStatus ?? 200, groqStatus: options.groqStatus ?? 200, at: new Date("2026-10-08T09:00:00.000Z") };
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
  const chat = new CommunityChat(GROUP_CHAT_ID);
  const directory = new MemberDirectory();
  const clock = { now: () => modelState.at };
  const waits: number[] = [];
  const gemini = new GeminiModel({ apiKey: "AIzatestkey", model: "gemini-3.8-flash", fallbackModel: "gemini-3.5-flash" }, async () => {}, modelFetch(options, modelState));
  const groq = new GroqModel({ apiKey: "gsk_testkey", model: "qwen/qwen3.8-27b" }, async () => {}, groqFetch(options, modelState));
  const classifier = new Classifier(gemini, groq, clock);
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
    replyModel: gemini,
    pending,
    clock,
    log: new Log("test", (line) => logLines.push(line)),
    chat,
    ids: countingIds(),
    directory,
  });

  built = service;

  return {
    service,
    pending,
    classifier,
    waits,
    directory,
    cache,
    queue,
    memory,
    health,
    chat,
    logLines,
    clock,
    namespaceOfMember: (userId) => `sd-${COMMUNITY}-m-${service.memberHashOf(userId)}`,
    breakModel: (status = 503) => {
      modelState.status = status;
    },
    mendModel: () => {
      modelState.status = 200;
    },
    breakGroq: (status = 503) => {
      modelState.groqStatus = status;
    },
    advanceMinutes: (minutes: number) => {
      modelState.at = new Date(modelState.at.getTime() + minutes * 60_000);
    },
    message: (partial) => ({
      chatId: GROUP_CHAT_ID,
      chatType: "supergroup",
      messageId: 1,
      userId: 42_000_001,
      isBot: false,
      userName: "ada",
      text: "hello",
      mentionsBot: false,
      replyToUserId: null,
      replyToIsBot: false,
      ...partial,
    }),
  };
}
