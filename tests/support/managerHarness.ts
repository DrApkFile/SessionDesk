import { ManagerService } from "../../src/bots/manager/service.js";
import { MemberDirectory } from "../../src/bots/shared/directory.js";
import { MemoryHealth } from "../../src/bots/shared/health.js";
import { Log } from "../../src/bots/shared/log.js";
import { EventPipeline } from "../../src/bots/shared/pipeline.js";
import type { IncomingMessage } from "../../src/bots/shared/incoming.js";
import { memberHash, resolveNamespace } from "../../src/core/namespace.js";
import { countingIds } from "../../src/core/ports.js";
import { SeqAllocator } from "../../src/core/seq.js";
import { LedgerCache } from "../../src/memory/cache.js";
import { NamespaceRouter } from "../../src/memory/router.js";
import { WriteQueue } from "../../src/memory/writeQueue.js";
import { GroqModel } from "../../src/models/groq.js";
import type { FetchLike } from "../../src/models/textModel.js";
import { FakeMemory } from "./fakeMemory.js";

export const MANAGER_ID = 4242;
export const OUTSIDER_ID = 9999;
export const MANAGER_CHAT = 4242;
export const COMMUNITY = "c1";
export const SECRET_SEED = "f".repeat(64);
export const NOTES_NAMESPACE = resolveNamespace(COMMUNITY, { kind: "notes" });

export interface ManagerHarnessOptions {
  readonly answer?: string;
  readonly modelStatus?: number;
}

export interface ManagerHarness {
  readonly service: ManagerService;
  readonly cache: LedgerCache;
  readonly notesCache: LedgerCache;
  readonly community: FakeMemory;
  readonly notesMemory: FakeMemory;
  readonly queue: WriteQueue;
  readonly directory: MemberDirectory;
  readonly logLines: string[];
  readonly clock: { now: () => Date };
  readonly pipeline: EventPipeline;
  memberHashOf(userId: number): string;
  message(partial: Partial<IncomingMessage>): IncomingMessage;
  ask(text: string, partial?: Partial<IncomingMessage>): Promise<string>;
}

function groqFetch(options: ManagerHarnessOptions): FetchLike {
  return async () => {
    const status = options.modelStatus ?? 200;
    if (status >= 400) return { ok: false, status, text: async () => "groq down" };
    const text = options.answer ?? "Nothing is owed right now.";
    return { ok: true, status: 200, text: async () => JSON.stringify({ choices: [{ message: { content: text } }] }) };
  };
}

export function managerHarness(options: ManagerHarnessOptions = {}): ManagerHarness {
  const community = new FakeMemory();
  const notesMemory = new FakeMemory();
  const cache = new LedgerCache();
  const notesCache = new LedgerCache();
  const memory = new NamespaceRouter(community, new Map([[NOTES_NAMESPACE, notesMemory]]));
  const queue = new WriteQueue(memory, async () => {}, (job) => {
    const target = job.namespace === NOTES_NAMESPACE ? notesCache : cache;
    if (job.state === "saved" && job.blobId !== null) target.markSaved(job.seq, job.namespace, job.blobId);
    if (job.state === "failed" && job.code !== null) target.markFailed(job.seq, job.namespace, job.code);
  });
  const logLines: string[] = [];
  const clock = { now: () => new Date("2026-10-08T09:00:00.000Z") };
  const directory = new MemberDirectory();
  const pipeline = new EventPipeline(new SeqAllocator(1), (namespace) => (namespace === NOTES_NAMESPACE ? notesCache : cache), queue, COMMUNITY);
  const health = new MemoryHealth();
  health.applyBoot(
    { namespaces: 0, linesRead: 0, decoded: 0, undecodable: 0, dropped: 0, partialNamespaces: [], atLimitNamespaces: [], failures: [], maxSeq: 0, nextSeq: 1, complete: true },
    clock.now(),
  );

  const service = new ManagerService(
    {
      communityKey: COMMUNITY,
      managerIds: [MANAGER_ID],
      cache,
      notesCache,
      pipeline,
      health,
      model: new GroqModel({ apiKey: "gsk_test", model: "qwen/qwen3.8-27b" }, async () => {}, groqFetch(options)),
      clock,
      log: new Log("manager", (line) => logLines.push(line)),
      ids: countingIds(),
      directory,
      status: { snapshot: () => ({ seqNext: 7, queueDepth: queue.depth(), unclassifiedHeld: 0 }) },
    },
    SECRET_SEED,
  );

  const message = (partial: Partial<IncomingMessage>): IncomingMessage => ({
    chatId: MANAGER_CHAT,
    chatType: "private",
    messageId: 1,
    userId: MANAGER_ID,
    isBot: false,
    userName: "boss",
    text: "/owed",
    mentionsBot: true,
    replyToUserId: null,
    replyToIsBot: false,
    ...partial,
  });

  return {
    service,
    cache,
    notesCache,
    community,
    notesMemory,
    queue,
    directory,
    logLines,
    clock,
    pipeline,
    memberHashOf: (userId) => memberHash(SECRET_SEED, userId),
    message,
    ask: async (text, partial = {}) => {
      const action = await service.handle(message({ text, ...partial }));
      return action.kind === "reply" ? action.text : "";
    },
  };
}
