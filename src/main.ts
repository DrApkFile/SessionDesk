import type { Bot } from "grammy";
import { configSummary, loadConfig } from "./config.js";
import { BudgetGovernor } from "./core/budget.js";
import { namespaceKindOf } from "./core/namespace.js";
import { realSleep, systemClock } from "./core/ports.js";
import { SeqAllocator } from "./core/seq.js";
import { SHUTDOWN_DRAIN_SECONDS } from "./core/tuning.js";
import { describeBoot, rebuildFromWalrus } from "./memory/boot.js";
import { LedgerCache } from "./memory/cache.js";
import { MemwalAdapter } from "./memory/memwalAdapter.js";
import { createMemwalClient } from "./memory/memwalClient.js";
import { WriteQueue } from "./memory/writeQueue.js";
import { Classifier } from "./models/classifier.js";
import { GeminiModel } from "./models/gemini.js";
import { GroqModel } from "./models/groq.js";
import { MemoryHealth } from "./bots/shared/health.js";
import { randomIds } from "./bots/shared/ids.js";
import { Log } from "./bots/shared/log.js";
import { PendingClassifications } from "./bots/shared/pending.js";
import { EventPipeline } from "./bots/shared/pipeline.js";
import { CommunityChat } from "./bots/shared/startup.js";
import { MemberService } from "./bots/member/service.js";
import { buildMemberBot } from "./bots/member/telegram.js";
import { createNotesMemory } from "./bots/manager/notes.js";
import { ManagerService } from "./bots/manager/service.js";
import { buildManagerBot } from "./bots/manager/telegram.js";
import { MemberDirectory } from "./bots/shared/directory.js";
import { NamespaceRouter } from "./memory/router.js";
import { PollingSupervisor, type Pollable } from "./bots/shared/polling.js";
import { FollowUpScheduler } from "./bots/shared/followUpScheduler.js";
import type { LastWrite } from "./server/healthReport.js";
import { startHealthServer } from "./server/httpServer.js";

const log = new Log("sessiondesk");

const loaded = loadConfig(process.env);
if (!loaded.ok) {
  log.say("config_rejected", { problems: loaded.problems.length });
  for (const problem of loaded.problems) log.say("config_problem", { problem });
  process.exit(1);
}
const config = loaded.config;
log.say("config", configSummary(config));

const cache = new LedgerCache();
const notesCache = new LedgerCache();
const health = new MemoryHealth();
const directory = new MemberDirectory();
const communityBudget = new BudgetGovernor(systemClock);
const community = new MemwalAdapter(
  createMemwalClient({
    key: config.memwal.accountA.privateKey,
    accountId: config.memwal.accountA.accountId,
    serverUrl: config.memwal.serverUrl,
  }),
  communityBudget,
);
const notes = createNotesMemory({ serverUrl: config.memwal.serverUrl, accountB: config.memwal.accountB, communityKey: config.community.key }, systemClock);
const memory = new NamespaceRouter(community, new Map([[notes.namespace, notes.port]]));

log.say("boot_start", { communityKey: config.community.key, serverUrl: config.memwal.serverUrl });
const booted = await rebuildFromWalrus(community, config.community.key, cache);
if (!booted.ok) {
  log.say("boot_refused", { code: booted.code, detail: booted.detail ?? "" });
  process.exit(1);
}
health.applyBoot(booted.value, new Date());
log.say("boot_done", { summary: describeBoot(booted.value), complete: booted.value.complete, health: health.summary() });

const bootedNotes = await rebuildFromWalrus(notes.port, config.community.key, notesCache);
if (!bootedNotes.ok) {
  log.say("notes_boot_refused", { code: bootedNotes.code, detail: bootedNotes.detail ?? "" });
  process.exit(1);
}
log.say("notes_boot_done", { summary: describeBoot(bootedNotes.value), account: "B", namespace: notes.namespace });


const seqStart = Math.max(booted.value.nextSeq, bootedNotes.value.nextSeq);
const bootedAt = new Date().toISOString();
let lastWrite: LastWrite | null = null;

const queue = new WriteQueue(
  memory,
  realSleep,
  (job) => {
    const target = job.namespace === notes.namespace ? notesCache : cache;
    if (job.state === "saved" && job.blobId !== null) {
      target.markSaved(job.seq, job.namespace, job.blobId);
      lastWrite = { at: new Date().toISOString(), state: "saved", namespaceKind: namespaceKindOf(job.namespace), code: null };
      log.say("write_saved", { seq: job.seq, namespace: job.namespace, blobId: job.blobId });
      return;
    }
    if (job.state === "failed" && job.code !== null) {
      target.markFailed(job.seq, job.namespace, job.code);
      lastWrite = { at: new Date().toISOString(), state: "failed", namespaceKind: namespaceKindOf(job.namespace), code: job.code };
      log.say("write_failed", { seq: job.seq, namespace: job.namespace, code: job.code, attempts: job.attempts });
    }
  },
  systemClock,
);

const seq = new SeqAllocator(seqStart);
const pipeline = new EventPipeline(seq, (namespace) => (namespace === notes.namespace ? notesCache : cache), queue, config.community.key);
const chat = new CommunityChat(config.telegram.communityChatId);
const self = { username: "" };
const gemini = new GeminiModel(config.gemini, realSleep, fetch);
const groq = new GroqModel(config.groq, realSleep, fetch);
const classifier = new Classifier(gemini, groq, systemClock);

let member: MemberService | null = null;
const pending = new PendingClassifications(
  realSleep,
  systemClock,
  async (held) => (member === null ? "model_down" : member.retryHeld(held)),
  log.child("pending"),
);

const service = new MemberService({
  communityKey: config.community.key,
  namespaceSecret: config.community.namespaceSecret,
  cache,
  pipeline,
  health,
  classifier,
  replyModel: gemini,
  pending,
  clock: systemClock,
  log: log.child("member"),
  chat,
  ids: randomIds(),
  directory,
  memory,
  managerIds: config.telegram.managerIds,
  self,
});

member = service;

const managerService = new ManagerService(
  {
    communityKey: config.community.key,
    managerIds: config.telegram.managerIds,
    cache,
    notesCache,
    pipeline,
    health,
    model: groq,
    clock: systemClock,
    log: log.child("manager"),
    ids: randomIds(),
    directory,
    status: {
      snapshot: () => ({
        seqNext: seq.peek(),
        queueDepth: queue.depth(),
        queuePaused: String(queue.paused()),
        queueRateLimitPauses: queue.pauses(),
        unclassifiedHeld: pending.waiting(),
        unclassifiedDropped: pending.dropped(),
        communityPointsUsedThisHour: communityBudget.usedInWindow(),
        communityPointsLeft: communityBudget.remaining(),
        notesPointsUsedThisHour: notes.budget.usedInWindow(),
        membersSeenSinceBoot: directory.size(),
        followUpChecks: followUps.ticks(),
        bootSummary: describeBoot(booted.value),
        notesBootSummary: describeBoot(bootedNotes.value),
      }),
    },
  },
  config.community.namespaceSecret,
);

const memberBot = await buildMemberBot(config.telegram.memberBotToken, service, log.child("member"), chat, self);
const managerBot = await buildManagerBot(config.telegram.managerBotToken, managerService, log.child("manager"));

const group = await memberBot.bot.api.getChat(config.telegram.communityChatId).catch((error: unknown) => {
  log.say("group_unreachable", {
    configured: config.telegram.communityChatId,
    detail: String(error instanceof Error ? error.message : error).slice(0, 200),
    action: "add the member bot to the group, then check COMMUNITY_CHAT_ID",
  });
  return null;
});
if (group === null) process.exit(1);
log.say("group", { configured: config.telegram.communityChatId, seen: group.id, type: group.type, title: ("title" in group ? group.title : null) ?? "—" });
if (group.id !== config.telegram.communityChatId) {
  log.say("group_mismatch", { configured: config.telegram.communityChatId, seen: group.id, action: `set COMMUNITY_CHAT_ID=${group.id} and restart` });
  process.exit(1);
}

function pollable(name: string, bot: Bot): Pollable {
  return {
    name,
    start: (onPolling) =>
      bot.start({
        onStart: (me) => {
          log.say("polling", { bot: name, username: me.username });
          onPolling();
        },
      }),
    stop: () => bot.stop(),
  };
}

const supervisors = [
  new PollingSupervisor(pollable("member", memberBot.bot), realSleep, systemClock, log.child("member")),
  new PollingSupervisor(pollable("manager", managerBot.bot), realSleep, systemClock, log.child("manager")),
];

const followUps = new FollowUpScheduler({
  cache,
  directory,
  managerIds: config.telegram.managerIds,
  clock: systemClock,
  log: log.child("followups"),
  toManager: async (chatId, text) => {
    await managerBot.bot.api.sendMessage(chatId, text);
  },
  toMember: async (chatId, text) => {
    await memberBot.bot.api.sendMessage(chatId, text);
  },
});
followUps.start();

const server = startHealthServer(
  config.port,
  () => ({
    bootOk: booted.ok && bootedNotes.ok,
    bootComplete: booted.value.complete,
    bootedAt,
    bootSummary: describeBoot(booted.value),
    bots: supervisors.map((supervisor, index) => ({
      name: index === 0 ? "member" : "manager",
      polling: supervisor.polling(),
      state: supervisor.state(),
      conflicts: supervisor.conflicts(),
      pollingSince: supervisor.pollingSince(),
    })),
    queue: { ...queue.counts(), depth: queue.depth(), paused: queue.paused(), closed: queue.closed(), pauses: queue.pauses() },
    lastWrite,
    unclassifiedHeld: pending.waiting(),
    unclassifiedDropped: pending.dropped(),
    memory: health.summary(),
    now: new Date(),
  }),
  log.child("http"),
);

let stopping = false;
async function stop(signal: string): Promise<void> {
  if (stopping) return;
  stopping = true;
  log.say("stopping", { signal, queue: queue.depth(), unclassifiedHeld: pending.waiting() });
  followUps.stop();
  await Promise.all(supervisors.map((supervisor) => supervisor.stop()));
  queue.close();
  const drained = await queue.drain(SHUTDOWN_DRAIN_SECONDS * 1000);
  log.say("drained", {
    signal,
    saved: drained.saved,
    failed: drained.failed,
    stillPending: drained.pending,
    refusedAfterClose: queue.refused(),
    drainSeconds: SHUTDOWN_DRAIN_SECONDS,
  });
  if (drained.pending > 0) log.say("writes_lost", { count: drained.pending, stored: false, note: "queued but not confirmed by the relayer before shutdown" });
  if (pending.waiting() > 0) log.say("unclassified_lost", { count: pending.waiting(), stored: false, note: "held in memory only, never written to Walrus" });
  server.close();
  log.say("stopped", { signal, pending: pending.describe() });
  process.exit(0);
}
process.once("SIGINT", () => void stop("SIGINT"));
process.once("SIGTERM", () => void stop("SIGTERM"));

log.say("ready", { bots: "member+manager", seqNext: seq.peek(), queue: queue.depth(), managers: config.telegram.managerIds.length, port: config.port });
await Promise.all(supervisors.map((supervisor) => supervisor.run()));
