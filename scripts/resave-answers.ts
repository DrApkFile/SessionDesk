import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { loadConfig } from "../src/config.js";
import { BudgetGovernor } from "../src/core/budget.js";
import { decode } from "../src/core/codec.js";
import { keyFromMaterial } from "../src/core/idempotency.js";
import { resolveNamespace } from "../src/core/namespace.js";
import { systemClock } from "../src/core/ports.js";
import { searchablePrefix, storedLine } from "../src/core/searchableLine.js";
import { RECALL_LIMIT, WRITE_TIMEOUT_MS } from "../src/core/tuning.js";
import { MemwalAdapter } from "../src/memory/memwalAdapter.js";
import { createMemwalClient } from "../src/memory/memwalClient.js";

const loaded = loadConfig(process.env);
if (!loaded.ok) {
  console.error(`Config is not usable:\n${loaded.problems.join("\n")}`);
  process.exit(1);
}
const config = loaded.config;
const runId = randomBytes(4).toString("hex");
const commit = execFileSync("git", ["rev-parse", "--short", "HEAD"], { encoding: "utf8" }).trim();
const namespace = resolveNamespace(config.community.key, { kind: "answers" });

const adapter = new MemwalAdapter(
  createMemwalClient({ key: config.memwal.accountA.privateKey, accountId: config.memwal.accountA.accountId, serverUrl: config.memwal.serverUrl }),
  new BudgetGovernor(systemClock),
);

console.log(`resave answers run=${runId} commit=${commit} namespace=${namespace}`);
const recalled = await adapter.recallNamespace(namespace, RECALL_LIMIT);
if (!recalled.ok) {
  console.error(`cannot read the answers namespace: ${recalled.code} ${recalled.detail ?? ""}`);
  process.exit(1);
}

const needsResave = recalled.value.lines
  .map((line) => ({ line, event: decode(line.text) }))
  .filter((held) => held.event !== null && held.event.type === "ANSWER")
  .filter((held) => !held.line.text.startsWith("Question:"));

console.log(`answers on record: ${recalled.value.lines.length}, already searchable: ${recalled.value.lines.length - needsResave.length}, to resave: ${needsResave.length}`);
if (needsResave.length === 0) {
  console.log("nothing to do.");
  process.exit(0);
}

let saved = 0;
for (const held of needsResave) {
  const event = held.event;
  if (event === null || event.type !== "ANSWER") continue;
  if (searchablePrefix(event) === null) continue;
  const written = await adapter.remember(
    { namespace, text: storedLine(event), idempotencyKey: keyFromMaterial(`resave|${config.community.key}|${event.answerId}`) },
    WRITE_TIMEOUT_MS,
  );
  if (written.ok) {
    saved += 1;
    console.log(`  ${event.answerId} resaved as ${written.value.blobId}`);
  } else {
    console.error(`  ${event.answerId} failed: ${written.code} ${written.detail ?? ""}`);
  }
}
console.log("");
console.log(`resaved ${saved} of ${needsResave.length}. The older copies stay on Walrus; both decode to the same answer, and the resolver treats an identical repeat as a no-op.`);
