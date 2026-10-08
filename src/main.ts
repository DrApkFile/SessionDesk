import { configSummary, enabledPlatforms, loadConfig } from "./config.js";
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
import { ReplyChain } from "./models/replyChain.js";
import { MemoryHealth } from "./bots/shared/health.js";
import { randomBytes } from "node:crypto";
import { randomIds } from "./bots/shared/ids.js";
import { SETUP_CODE_CHARS, describeGovernance } from "./core/governance.js";
import { Log } from "./bots/shared/log.js";
import { PendingClassifications } from "./bots/shared/pending.js";
import { EventPipeline } from "./bots/shared/pipeline.js";
import { CommunityChat } from "./bots/shared/startup.js";
import { MemberService } from "./bots/member/service.js";
import { createNotesMemory } from "./bots/manager/notes.js";
import { ManagerService } from "./bots/manager/service.js";
import { decisionChoices } from "./bots/manager/answerDecisions.js";
import { MemberDirectory } from "./bots/shared/directory.js";
import { NamespaceRouter } from "./memory/router.js";
import { PLATFORMS, userKey } from "./platform/platform.js";
import { plannedPlatforms, type PlatformRuntime } from "./platform/runtime.js";
import { startTelegram } from "./platform/telegram/start.js";
import { startDiscord } from "./platform/discord/start.js";
import { startSlack } from "./platform/slack/start.js";
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
const telegramSettings = config.telegram;
const chat = new CommunityChat(telegramSettings === null ? null : telegramSettings.communityChatId, () => {
  const where = cache.state().governance.community;
  return where === null ? null : { platform: where.platform, chatId: where.chatId };
});
const self = { username: "" };
const gemini = new GeminiModel(config.gemini, realSleep, fetch);
const groq = new GroqModel(config.groq, realSleep, fetch);
const classifier = new Classifier(gemini, groq, systemClock);
const replies = new ReplyChain([
  new GeminiModel({ ...config.gemini, fallbackModel: config.gemini.model }, realSleep, fetch),
  new GeminiModel({ ...config.gemini, model: config.gemini.fallbackModel }, realSleep, fetch),
  groq,
]);

let member: MemberService | null = null;
const pending = new PendingClassifications(
  realSleep,
  systemClock,
  async (held) => (member === null ? "model_down" : member.retryHeld(held)),
  log.child("pending"),
);

const setupCode = config.setupCode ?? randomBytes(6).toString("base64url").slice(0, SETUP_CODE_CHARS);
if (config.setupCode === null) {
  log.say("setup_code_generated", {
    note: "printed once and never again: whoever runs this should DM the manager bot /claim <code> to become the owner",
  });
  console.log(`\n    SETUP CODE: ${setupCode}\n    Send this to the manager bot as: /claim ${setupCode}\n    It is not printed again, and never appears in /health, /status or evidence.\n`);
} else {
  log.say("setup_code", { source: "SETUP_CODE environment variable", printed: false });
}

const allManagerIds = [
  ...(config.telegram?.managerIds ?? []).map((id) => userKey("telegram", id)),
  ...(config.discord?.managerIds ?? []).map((id) => userKey("discord", id)),
  ...(config.slack?.managerIds ?? []).map((id) => userKey("slack", id)),
];

const service = new MemberService({
  communityKey: config.community.key,
  namespaceSecret: config.community.namespaceSecret,
  cache,
  pipeline,
  health,
  classifier,
  replies,
  pending,
  clock: systemClock,
  log: log.child("member"),
  chat,
  ids: randomIds(),
  directory,
  memory,
  managerIds: allManagerIds,
  self,
  directMessagesNeedOptIn: true,
  notifyManagers: async (notice) => {
    for (const managerKey of config.telegram?.managerIds ?? []) {
      for (const runtime of runtimes) {
        await runtime.toManager(managerKey, notice.text, decisionChoices(notice.answerIds)).catch(() => undefined);
      }
    }
    log.say("managers_notified", { answers: notice.answerIds.join(","), managers: config.telegram?.managerIds.length ?? 0 });
  },
});
member = service;

const managerService = new ManagerService(
  {
    communityKey: config.community.key,
    managerIds: allManagerIds,
    cache,
    notesCache,
    pipeline,
    health,
    model: groq,
    clock: systemClock,
    log: log.child("manager"),
    ids: randomIds(),
    directory,
    namespaceSecret: config.community.namespaceSecret,
    setupCode,
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
        governance: describeGovernance(cache.state().governance, allManagerIds),
        followUpChecks: followUps.ticks(),
        platforms: runtimes.map((runtime) => `${runtime.platform}:${runtime.supervisors.every((supervisor) => supervisor.polling()) ? "polling" : "down"}`).join(" "),
        bootSummary: describeBoot(booted.value),
        notesBootSummary: describeBoot(bootedNotes.value),
      }),
    },
  },
  config.community.namespaceSecret,
);

const runtimes: PlatformRuntime[] = [];
if (telegramSettings !== null) {
  runtimes.push(
    await startTelegram({
      settings: telegramSettings,
      member: service,
      manager: managerService,
      chat,
      self,
      log,
      sleep: realSleep,
      clock: systemClock,
    }),
  );
}
if (config.discord !== null) {
  runtimes.push(
    await startDiscord({
      settings: config.discord,
      member: service,
      manager: managerService,
      log: log.child("discord"),
      sleep: realSleep,
      clock: systemClock,
    }),
  );
}
if (config.slack !== null) {
  runtimes.push(
    await startSlack({
      settings: config.slack,
      member: service,
      manager: managerService,
      log: log.child("slack"),
      sleep: realSleep,
      clock: systemClock,
    }),
  );
}
for (const plan of plannedPlatforms(config.enabled, { telegram: config.telegram !== null, discord: config.discord !== null, slack: config.slack !== null })) {
  if (!plan.willStart) log.say("platform_not_started", { platform: plan.platform, enabled: plan.enabled, configured: plan.configured });
}
log.say("platforms", { enabled: enabledPlatforms(config).join(",") || "none", started: runtimes.map((runtime) => runtime.platform).join(",") });

const followUps = new FollowUpScheduler({
  cache,
  directory,
  managerIds: allManagerIds,
  clock: systemClock,
  log: log.child("followups"),
  toManager: async (chatId, text) => {
    for (const runtime of runtimes) await runtime.toManager(chatId, text).catch(() => undefined);
  },
  toMember: async (chatId, text) => {
    for (const runtime of runtimes) await runtime.toMember(chatId, text).catch(() => undefined);
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
    bots: runtimes.flatMap((runtime) =>
      runtime.supervisors.map((supervisor) => ({
        name: `${runtime.platform}:${supervisor.state() === "polling" ? "polling" : supervisor.state()}`,
        polling: supervisor.polling(),
        state: supervisor.state(),
        conflicts: supervisor.conflicts(),
        pollingSince: supervisor.pollingSince(),
      })),
    ),
    platforms: PLATFORMS.map((platform) => ({
      platform,
      enabled: config.enabled[platform],
      started: runtimes.some((runtime) => runtime.platform === platform),
      polling: runtimes.some((runtime) => runtime.platform === platform && runtime.supervisors.every((supervisor) => supervisor.polling())),
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
  await Promise.all(runtimes.flatMap((runtime) => runtime.supervisors.map((supervisor) => supervisor.stop())));
  await Promise.all(runtimes.map((runtime) => runtime.stop()));
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

log.say("reply_chain", { order: replies.names().join(" -> ") });
log.say("ready", {
  platforms: runtimes.map((runtime) => runtime.platform).join(","),
  seqNext: seq.peek(),
  queue: queue.depth(),
  managers: allManagerIds.length,
  port: config.port,
});
await Promise.all(runtimes.flatMap((runtime) => runtime.supervisors.map((supervisor) => supervisor.run())));
