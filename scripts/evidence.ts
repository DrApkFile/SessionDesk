import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { loadConfig } from "../src/config.js";
import { BudgetGovernor } from "../src/core/budget.js";
import { systemClock } from "../src/core/ports.js";
import { RECALL_LIMIT } from "../src/core/tuning.js";
import { MemwalAdapter } from "../src/memory/memwalAdapter.js";
import { createMemwalClient } from "../src/memory/memwalClient.js";
import type { MemoryPort } from "../src/memory/port.js";
import { createNotesMemory } from "../src/bots/manager/notes.js";
import { A06_MIN_MEMBERS, A06_MIN_MEMORIES, aggregateNamespace, publicEvidence, summarise, type NamespaceEvidence } from "../src/evidence/aggregate.js";

const loaded = loadConfig(process.env);
if (!loaded.ok) {
  console.error(`Config is not usable:\n${loaded.problems.join("\n")}`);
  process.exit(1);
}
const config = loaded.config;

const runId = randomBytes(4).toString("hex");
const startedAt = new Date();
const commit = execFileSync("git", ["rev-parse", "--short", "HEAD"], { encoding: "utf8" }).trim();
const prefix = `sd-${config.community.key}-`;

async function readAccount(port: MemoryPort, label: string): Promise<{ namespaces: NamespaceEvidence[]; failures: string[] }> {
  const listed = await port.namespacesWithPrefix(prefix);
  if (!listed.ok) {
    console.error(`${label}: cannot list namespaces: ${listed.code} ${listed.detail ?? ""}`);
    process.exit(1);
  }
  const namespaces: NamespaceEvidence[] = [];
  const failures: string[] = [];
  for (const namespace of [...listed.value].sort()) {
    const recalled = await port.recallNamespace(namespace, RECALL_LIMIT);
    if (!recalled.ok) {
      failures.push(`${namespace}: ${recalled.code}`);
      continue;
    }
    const found = aggregateNamespace(config.community.key, namespace, recalled.value.lines);
    namespaces.push(found);
    console.log(`  ${namespace} kind=${found.kind} memories=${found.memories} days=${found.activeDays.length} undecodable=${found.undecodable}`);
  }
  return { namespaces, failures };
}

const community = new MemwalAdapter(
  createMemwalClient({
    key: config.memwal.accountA.privateKey,
    accountId: config.memwal.accountA.accountId,
    serverUrl: config.memwal.serverUrl,
  }),
  new BudgetGovernor(systemClock),
);
const notes = createNotesMemory({ serverUrl: config.memwal.serverUrl, accountB: config.memwal.accountB, communityKey: config.community.key }, systemClock);

console.log(`evidence run=${runId} commit=${commit} date=${startedAt.toISOString()} prefix=${prefix}`);
console.log("account A (community memory):");
const accountA = await readAccount(community, "account A");
console.log("account B (manager notes):");
const accountB = await readAccount(notes.port, "account B");

const summary = summarise(accountA.namespaces);
const notesSummary = summarise(accountB.namespaces);
const members = summary.members;
const totalBlobsA = summary.blobs;
const totalBlobsB = notesSummary.blobs;

const provenance = {
  runId,
  commit,
  date: startedAt.toISOString(),
  environment: `node ${process.version} on ${process.platform}`,
  network: "walrus memory mainnet",
  serverUrl: config.memwal.serverUrl,
  communityKey: config.community.key,
  source: "real consented members only; no seeded or demo data",
};

const blobCount = {
  ...provenance,
  agentAccountId: config.memwal.accountA.accountId,
  notesAccountId: config.memwal.accountB.accountId,
  blobsOnAccountA: totalBlobsA,
  blobsOnAccountB: totalBlobsB,
  blobsTotal: totalBlobsA + totalBlobsB,
  namespacesOnAccountA: accountA.namespaces.length,
  namespacesOnAccountB: accountB.namespaces.length,
  namespacesUnreadable: [...accountA.failures, ...accountB.failures],
  byNamespace: accountA.namespaces.map((found) => ({ label: publicEvidence(found).label, kind: found.kind, blobs: found.blobIds.length })),
};

const users = {
  ...provenance,
  threshold: { minMembers: A06_MIN_MEMBERS, minMemoriesEach: A06_MIN_MEMORIES },
  membersWithAnyMemory: summary.membersWithAnyMemory,
  membersMeetingThreshold: summary.membersMeetingThreshold,
  distinctDaysAcross: summary.distinctDaysAcross,
  undecodableLines: summary.undecodable,
  met: summary.met,
  members: members.map(publicEvidence),
};

mkdirSync("evidence", { recursive: true });
writeFileSync("evidence/A05-blobcount.json", `${JSON.stringify(blobCount, null, 2)}\n`);
writeFileSync("evidence/A06-users.json", `${JSON.stringify(users, null, 2)}\n`);

console.log("");
console.log(`A05 blobs: account A ${totalBlobsA}, account B ${totalBlobsB}, total ${totalBlobsA + totalBlobsB}`);
console.log(`A06 members with >=${A06_MIN_MEMORIES} memories: ${summary.membersMeetingThreshold} of ${summary.membersWithAnyMemory} (need ${A06_MIN_MEMBERS}) -> ${summary.met ? "MET" : "NOT MET"}`);
for (const found of members) console.log(`  member ${found.memberCode}: ${found.memories} memories across ${found.activeDays.length} day(s) ${found.activeDays.join(",")}`);
console.log(`distinct days with activity: ${summary.distinctDaysAcross.join(",") || "none"}`);
if (accountA.failures.length + accountB.failures.length > 0) console.log(`namespaces that could not be read: ${[...accountA.failures, ...accountB.failures].join("; ")}`);
console.log("written: evidence/A05-blobcount.json, evidence/A06-users.json");
