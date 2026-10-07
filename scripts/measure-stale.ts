import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { estimateTokens } from "@mysten-incubation/memwal";
import { loadConfig } from "../src/config.js";
import { BudgetGovernor } from "../src/core/budget.js";
import type { LedgerEvent } from "../src/core/events.js";
import { buildFactsSheet } from "../src/core/factsSheet.js";
import { idempotencyKey } from "../src/core/idempotency.js";
import { memberHash } from "../src/core/namespace.js";
import { realSleep, systemClock } from "../src/core/ports.js";
import { decode } from "../src/core/codec.js";
import { resolve as resolveLedger } from "../src/core/resolver.js";
import type { LedgerEntry } from "../src/core/state.js";
import { PLAIN_RECALL_TOP_K, RECALL_LIMIT } from "../src/core/tuning.js";
import { ITEM_STATUSES } from "../src/core/vocabulary.js";
import { MemwalAdapter } from "../src/memory/memwalAdapter.js";
import { createMemwalClient } from "../src/memory/memwalClient.js";
import { encode } from "../src/core/codec.js";
import { WriteQueue } from "../src/memory/writeQueue.js";

const SCENARIOS = [
  { theme: "android login", text: "android login fails on 2.3", question: "is the android login bug fixed yet?" },
  { theme: "payments", text: "card payment fails at checkout with error 500", question: "any news on the card payment failure?" },
  { theme: "notifications", text: "push notifications never arrive on ios", question: "did you fix push notifications on ios?" },
  { theme: "export", text: "csv export is missing the last row", question: "what is the status of the csv export bug?" },
  { theme: "search", text: "search returns nothing for arabic text", question: "is arabic search working now?" },
] as const;

const loaded = loadConfig(process.env);
if (!loaded.ok) {
  console.error(`Config is not usable:\n${loaded.problems.join("\n")}`);
  process.exit(1);
}
const config = loaded.config;

const skipWrites = process.env.MEASURE_SKIP_WRITES === "1";
const runId = process.env.MEASURE_RUN_ID ?? randomBytes(4).toString("hex");
const startedAt = new Date();
const commit = execFileSync("git", ["rev-parse", "--short", "HEAD"], { encoding: "utf8" }).trim();
const communityKey = `${config.community.key}meas`;
const memberH = memberHash(config.community.namespaceSecret, 10_000_001);
const itemsNamespace = `sd-${communityKey}-items`;
const memberNamespace = `sd-${communityKey}-m-${memberH}`;
const themesNamespace = `sd-${communityKey}-themes`;

const adapter = new MemwalAdapter(
  createMemwalClient({
    key: config.memwal.accountA.privateKey,
    accountId: config.memwal.accountA.accountId,
    serverUrl: config.memwal.serverUrl,
  }),
  new BudgetGovernor(systemClock),
);

const stamp = (seq: number): string => new Date(startedAt.getTime() + seq * 1000).toISOString();
const plan: Array<{ event: LedgerEvent; namespace: string; memberH: string | null }> = [];
let seq = 0;

SCENARIOS.forEach((scenario, index) => {
  const themeId = `t-${runId}-${index}`;
  const itemId = `i-${runId}-${index}`;
  seq += 1;
  plan.push({ event: { type: "THEME_CREATED", themeId, label: `${scenario.theme} ${runId}`, seq, ts: stamp(seq) }, namespace: themesNamespace, memberH: null });
  seq += 1;
  const opened: LedgerEvent = { type: "ITEM_OPENED", itemId, kind: "bug", themeId, text: scenario.text, seq, ts: stamp(seq) };
  plan.push({ event: opened, namespace: memberNamespace, memberH });
  plan.push({ event: opened, namespace: itemsNamespace, memberH: null });
  seq += 1;
  plan.push({ event: { type: "ITEM_STATUS", itemId, status: "acknowledged", seq, ts: stamp(seq) }, namespace: itemsNamespace, memberH: null });
  seq += 1;
  plan.push({ event: { type: "ITEM_STATUS", itemId, status: "fixed", seq, ts: stamp(seq) }, namespace: itemsNamespace, memberH: null });
});

console.log(`measurement run=${runId} commit=${commit} date=${startedAt.toISOString()} community=${communityKey}`);
console.log(`N=${SCENARIOS.length} scenarios, ${skipWrites ? "measuring lines already on mainnet" : `writing ${plan.length} lines to mainnet at 30-38 s each`}`);

if (!skipWrites) {
  const queue = new WriteQueue(adapter, realSleep, (job) => {
    if (job.state !== "saved") console.error(`  write ${job.seq} ${job.namespace} ${job.state} ${job.code ?? ""}`);
  });
  plan.forEach((step, index) => {
    queue.enqueue({
      seq: step.event.seq,
      namespace: step.namespace,
      text: encode(step.event),
      idempotencyKey: idempotencyKey({ communityKey, chatId: -2, messageId: index + 1, eventType: step.event.type, index }),
    });
  });
  await queue.settled();
  const written = queue.counts();
  console.log(`written: saved=${written.saved} failed=${written.failed} pending=${written.pending}`);
  if (written.saved !== plan.length) {
    console.error("not every line was saved, so the measurement would be run on partial data");
    process.exit(1);
  }
}

function staleStatusesIn(context: string, itemId: string, current: string): readonly string[] {
  const named = ITEM_STATUSES.filter((status) => context.includes(`status=${status}`) || context.includes(`t=ITEM_STATUS|itemId=${itemId}|status=${status}`));
  return named.filter((status) => status !== current);
}

interface ArmResult {
  readonly scenario: string;
  readonly itemId: string;
  readonly currentStatus: string;
  readonly staleStatuses: readonly string[];
  readonly stale: boolean;
  readonly tokens: number;
  readonly lines: number;
}

const plainResults: ArmResult[] = [];
const resolverResults: ArmResult[] = [];

const wholeNamespace = await adapter.recallNamespace(itemsNamespace, RECALL_LIMIT);
const memberLines = await adapter.recallNamespace(memberNamespace, RECALL_LIMIT);
if (!wholeNamespace.ok || !memberLines.ok) {
  console.error("could not read back the measurement namespaces");
  process.exit(1);
}

const fromWalrus: LedgerEntry[] = [];
for (const line of wholeNamespace.value.lines) {
  const event = decode(line.text);
  if (event !== null) fromWalrus.push({ event, memberH: null });
}
for (const line of memberLines.value.lines) {
  const event = decode(line.text);
  if (event !== null) fromWalrus.push({ event, memberH });
}
const truth = resolveLedger(fromWalrus);
console.log(`resolver arm reads ${fromWalrus.length} lines back from walrus and folds them by seq`);

for (const [index, scenario] of SCENARIOS.entries()) {
  const itemId = `i-${runId}-${index}`;
  const current = truth.items.get(itemId)?.status ?? "unknown";

  const plain = await adapter.search(itemsNamespace, scenario.question, PLAIN_RECALL_TOP_K, 1);
  const plainContext = plain.ok ? plain.value.lines.map((line) => line.text).join("\n") : "";
  plainResults.push({
    scenario: scenario.question,
    itemId,
    currentStatus: current,
    staleStatuses: staleStatusesIn(plainContext, itemId, current),
    stale: staleStatusesIn(plainContext, itemId, current).length > 0,
    tokens: estimateTokens(plainContext),
    lines: plain.ok ? plain.value.lines.length : 0,
  });

  const sheet = buildFactsSheet(truth, memberH, new Date(), memberLines.value.lines.length);
  const stale = staleStatusesIn(sheet.text, itemId, current);
  resolverResults.push({
    scenario: scenario.question,
    itemId,
    currentStatus: current,
    staleStatuses: stale,
    stale: stale.length > 0,
    tokens: estimateTokens(sheet.text),
    lines: sheet.itemCount,
  });
}

const percentage = (results: readonly ArmResult[]): number => Math.round((results.filter((result) => result.stale).length / results.length) * 1000) / 10;
const meanTokens = (results: readonly ArmResult[]): number => Math.round(results.reduce((total, result) => total + result.tokens, 0) / results.length);

const result = {
  runId,
  commit,
  date: startedAt.toISOString(),
  environment: `node ${process.version} on ${process.platform}`,
  network: "walrus memory mainnet",
  communityKey,
  preRegistered: "docs/DECISIONS.md, written before this run",
  n: SCENARIOS.length,
  metric: "percentage of scenarios whose model context contains at least one status for the queried item that is not its current status",
  tokenMethod: "estimateTokens from @mysten-incubation/memwal",
  bothArmsReadFromWalrus: true,
  resolverLinesReadBack: fromWalrus.length,
  plainTopK: PLAIN_RECALL_TOP_K,
  arms: {
    plainSemanticRecall: { staleContextPercent: percentage(plainResults), meanContextTokens: meanTokens(plainResults), cases: plainResults },
    resolver: { staleContextPercent: percentage(resolverResults), meanContextTokens: meanTokens(resolverResults), cases: resolverResults },
  },
};

mkdirSync("evidence", { recursive: true });
const path = `evidence/measurement-stale-status-${runId}.json`;
writeFileSync(path, `${JSON.stringify(result, null, 2)}\n`);

console.log("");
console.log(`plain top-${PLAIN_RECALL_TOP_K} semantic recall: stale context in ${percentage(plainResults)}% of ${SCENARIOS.length} cases, mean ${meanTokens(plainResults)} tokens`);
console.log(`our resolver:                stale context in ${percentage(resolverResults)}% of ${SCENARIOS.length} cases, mean ${meanTokens(resolverResults)} tokens`);
console.log(`written to ${path}`);
