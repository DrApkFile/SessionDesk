import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { loadConfig } from "../src/config.js";
import { BudgetGovernor } from "../src/core/budget.js";
import { encode } from "../src/core/codec.js";
import type { LedgerEvent } from "../src/core/events.js";
import { idempotencyKey } from "../src/core/idempotency.js";
import { memberHash } from "../src/core/namespace.js";
import { realSleep, systemClock } from "../src/core/ports.js";
import { resolve as resolveLedger } from "../src/core/resolver.js";
import type { LedgerEntry } from "../src/core/state.js";
import { LEDGER_RECALL_QUERY, RECALL_LIMIT } from "../src/core/tuning.js";
import { describeBoot, rebuildFromWalrus } from "../src/memory/boot.js";
import { LedgerCache } from "../src/memory/cache.js";
import { MemwalAdapter } from "../src/memory/memwalAdapter.js";
import { createMemwalClient } from "../src/memory/memwalClient.js";
import { WriteQueue, type WriteJob } from "../src/memory/writeQueue.js";

const loaded = loadConfig(process.env);
if (!loaded.ok) {
  console.error(`Config is not usable:\n${loaded.problems.join("\n")}`);
  process.exit(1);
}
const config = loaded.config;

const runId = randomBytes(4).toString("hex");
const startedAt = new Date();
const commit = execFileSync("git", ["rev-parse", "--short", "HEAD"], { encoding: "utf8" }).trim();
const communityKey = `${config.community.key}rt`;
const testMemberH = memberHash(config.community.namespaceSecret, 10_000_000 + Number(`0x${runId}`) % 1_000_000);

const client = createMemwalClient({
  key: config.memwal.accountA.privateKey,
  accountId: config.memwal.accountA.accountId,
  serverUrl: config.memwal.serverUrl,
});
const adapter = new MemwalAdapter(client, new BudgetGovernor(systemClock));

const stamp = (seq: number): string => new Date(startedAt.getTime() + seq * 1000).toISOString();

const events: readonly LedgerEvent[] = [
  { type: "CONSENT_GIVEN", scope: "storage_and_dm", seq: 1, ts: stamp(1) },
  { type: "THEME_CREATED", themeId: `t-${runId}`, label: `android login ${runId}`, seq: 2, ts: stamp(2) },
  { type: "ITEM_OPENED", itemId: `i-${runId}`, kind: "bug", themeId: `t-${runId}`, text: `restore test ${runId}: android login fails`, seq: 3, ts: stamp(3) },
  { type: "ITEM_STATUS", itemId: `i-${runId}`, status: "acknowledged", seq: 4, ts: stamp(4) },
  { type: "ITEM_STATUS", itemId: `i-${runId}`, status: "fixed", seq: 5, ts: stamp(5) },
];

const memberNamespace = `sd-${communityKey}-m-${testMemberH}`;
const itemsNamespace = `sd-${communityKey}-items`;
const themesNamespace = `sd-${communityKey}-themes`;

const plan: ReadonlyArray<{ event: LedgerEvent; namespace: string; memberH: string | null }> = [
  { event: events[0]!, namespace: memberNamespace, memberH: testMemberH },
  { event: events[1]!, namespace: themesNamespace, memberH: null },
  { event: events[2]!, namespace: memberNamespace, memberH: testMemberH },
  { event: events[2]!, namespace: itemsNamespace, memberH: null },
  { event: events[3]!, namespace: itemsNamespace, memberH: null },
  { event: events[4]!, namespace: itemsNamespace, memberH: null },
];

const expected: readonly LedgerEntry[] = plan.map((step) => ({ event: step.event, memberH: step.memberH }));

const settledJobs: WriteJob[] = [];
const queue = new WriteQueue(adapter, realSleep, (job) => settledJobs.push({ ...job }));

console.log(`restore test run=${runId} commit=${commit} started=${startedAt.toISOString()} community=${communityKey}`);
console.log(`writing ${plan.length} lines to mainnet, 30-38 s each is normal`);

const writeStarted = Date.now();
plan.forEach((step, index) => {
  queue.enqueue({
    seq: step.event.seq,
    namespace: step.namespace,
    text: encode(step.event),
    idempotencyKey: idempotencyKey({ communityKey, chatId: -1, messageId: index + 1, eventType: step.event.type, index }),
  });
});
await queue.settled();
const writeMs = Date.now() - writeStarted;

const saved = settledJobs.filter((job) => job.state === "saved");
const failed = settledJobs.filter((job) => job.state !== "saved");
for (const job of settledJobs) console.log(`  seq=${job.seq} ${job.namespace} ${job.state} ${job.blobId ?? job.code ?? ""}`);

const cache = new LedgerCache();
const rebuildStarted = Date.now();
const report = await rebuildFromWalrus(adapter, communityKey, cache, RECALL_LIMIT);
const rebuildMs = Date.now() - rebuildStarted;

if (!report.ok) {
  console.error(`rebuild refused: ${report.code} ${report.detail ?? ""}`);
  process.exit(1);
}

console.log(`rebuild ${describeBoot(report.value)} in ${rebuildMs} ms`);

const rebuiltItem = cache.state().items.get(`i-${runId}`);
const expectedItem = resolveLedger(expected).items.get(`i-${runId}`);
const statusMatches = rebuiltItem?.status === expectedItem?.status;
const memberFound = cache.state().members.get(testMemberH) !== undefined;

const passed = failed.length === 0 && statusMatches && rebuiltItem?.status === "fixed" && memberFound;

const result = {
  runId,
  commit,
  date: startedAt.toISOString(),
  environment: `node ${process.version} on ${process.platform}`,
  network: "walrus memory mainnet",
  serverUrl: config.memwal.serverUrl,
  accountId: config.memwal.accountA.accountId,
  communityKey,
  writes: { planned: plan.length, saved: saved.length, failed: failed.length, totalMs: writeMs, msPerWrite: Math.round(writeMs / plan.length) },
  blobIds: saved.map((job) => ({ seq: job.seq, namespace: job.namespace, blobId: job.blobId })),
  failures: failed.map((job) => ({ seq: job.seq, namespace: job.namespace, code: job.code })),
  rebuild: { ...report.value, ms: rebuildMs },
  statusAfterRestart: rebuiltItem?.status ?? null,
  statusExpected: expectedItem?.status ?? null,
  memberFoundAfterRestart: memberFound,
  staleStatusBaseline: "not measured: this script reads with our own recent-sorted recall, which is not a plain semantic baseline (P1)",
  passed,
};

mkdirSync("evidence", { recursive: true });
const path = `evidence/restore-test-${runId}.json`;
writeFileSync(path, `${JSON.stringify(result, null, 2)}\n`);

console.log(`status after restart: ${result.statusAfterRestart} (expected ${result.statusExpected})`);
console.log(`${passed ? "PASS" : "FAIL"} written to ${path}`);
process.exit(passed ? 0 : 1);
