import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { loadConfig } from "../src/config.js";
import { BudgetGovernor } from "../src/core/budget.js";
import { encode } from "../src/core/codec.js";
import type { LedgerEvent } from "../src/core/events.js";
import { keyFromMaterial } from "../src/core/idempotency.js";
import { systemClock } from "../src/core/ports.js";
import { storedLine } from "../src/core/searchableLine.js";
import { MemwalAdapter } from "../src/memory/memwalAdapter.js";
import { createMemwalClient } from "../src/memory/memwalClient.js";

const PAIRS = [
  {
    question: "how do I reset my password?",
    answer: "Open Settings, then Account, then Reset password. The email takes a minute to arrive.",
    paraphrases: ["I forgot my password, what do I do", "where is the password reset option", "cant log in need to change my password"],
  },
  {
    question: "does the app work offline?",
    answer: "Yes, you can read everything offline. Anything you write syncs the next time you have signal.",
    paraphrases: ["can I use it with no internet", "what happens when I lose signal", "is there an offline mode"],
  },
  {
    question: "how do I change the language?",
    answer: "Settings, then Language. We have English, French and Yoruba so far.",
    paraphrases: ["can I switch it to french", "where do I pick a different language", "is yoruba supported"],
  },
  {
    question: "why is my payment failing at checkout?",
    answer: "Cards issued outside Nigeria are declined at the moment. Use a transfer instead while we fix it.",
    paraphrases: ["my card keeps getting declined when I pay", "checkout wont accept my payment", "payment error at the end of the order"],
  },
  {
    question: "how do I invite someone to my team?",
    answer: "Team, then Invite, then paste their email. They get a link that lasts seven days.",
    paraphrases: ["how can I add a colleague", "where do I send a team invitation", "want to bring someone onto my workspace"],
  },
] as const;

const UNRELATED = ["what is the weather like today", "who won the match last night", "recommend a good restaurant nearby"] as const;

const loaded = loadConfig(process.env);
if (!loaded.ok) {
  console.error(`Config is not usable:\n${loaded.problems.join("\n")}`);
  process.exit(1);
}
const config = loaded.config;
const runId = randomBytes(4).toString("hex");
const startedAt = new Date();
const commit = execFileSync("git", ["rev-parse", "--short", "HEAD"], { encoding: "utf8" }).trim();

const ENCODED_NS = `sd-${config.community.key}meas-aenc-${runId}`;
const PLAIN_NS = `sd-${config.community.key}meas-aplain-${runId}`;

const adapter = new MemwalAdapter(
  createMemwalClient({ key: config.memwal.accountA.privateKey, accountId: config.memwal.accountA.accountId, serverUrl: config.memwal.serverUrl }),
  new BudgetGovernor(systemClock),
);

function answerEvent(index: number): LedgerEvent {
  const pair = PAIRS[index];
  if (pair === undefined) throw new Error("bad index");
  return {
    type: "ANSWER",
    answerId: `a-${runId}-${index}`,
    questionText: pair.question,
    answerText: pair.answer,
    answeredBy: "manager",
    themeId: `t-${runId}-${index}`,
    seq: index + 1,
    ts: new Date(startedAt.getTime() + index * 1000).toISOString(),
  };
}

console.log(`answer recall measurement run=${runId} commit=${commit} date=${startedAt.toISOString()}`);
console.log(`format A (encoded wire line only): ${ENCODED_NS}`);
console.log(`format B (natural language first): ${PLAIN_NS}`);
console.log(`writing ${PAIRS.length * 2} lines to mainnet at 30-38 s each`);

for (const [index] of PAIRS.entries()) {
  const event = answerEvent(index);
  const encoded = encode(event);
  const plain = storedLine(event);
  const wroteEncoded = await adapter.remember({ namespace: ENCODED_NS, text: encoded, idempotencyKey: keyFromMaterial(`${runId}|enc|${index}`) }, 60_000);
  const wrotePlain = await adapter.remember({ namespace: PLAIN_NS, text: plain, idempotencyKey: keyFromMaterial(`${runId}|plain|${index}`) }, 60_000);
  if (!wroteEncoded.ok || !wrotePlain.ok) {
    console.error(`write ${index} failed: ${wroteEncoded.ok ? "" : wroteEncoded.code} ${wrotePlain.ok ? "" : wrotePlain.code}`);
    process.exit(1);
  }
  console.log(`  pair ${index + 1} written to both formats`);
}

interface Probe {
  readonly label: string;
  readonly query: string;
  readonly wantIndex: number | null;
}

const probes: Probe[] = [];
PAIRS.forEach((pair, index) => {
  for (const paraphrase of pair.paraphrases) probes.push({ label: `paraphrase of Q${index + 1}`, query: paraphrase, wantIndex: index });
});
for (const unrelated of UNRELATED) probes.push({ label: "unrelated", query: unrelated, wantIndex: null });
probes.push({ label: "paraphrase of Q1 with a bot mention", query: "@sdmemberbot I forgot my password, what do I do", wantIndex: 0 });

interface Reading {
  readonly label: string;
  readonly query: string;
  readonly wantIndex: number | null;
  readonly topDistance: number | null;
  readonly topIsWanted: boolean;
  readonly wantedDistance: number | null;
}

async function probeNamespace(namespace: string, probe: Probe): Promise<Reading> {
  const found = await adapter.search(namespace, probe.query, 5, 2);
  if (!found.ok) return { label: probe.label, query: probe.query, wantIndex: probe.wantIndex, topDistance: null, topIsWanted: false, wantedDistance: null };
  const hits = found.value.lines.map((line) => ({ distance: line.distance ?? 2, text: line.text }));
  const top = hits[0];
  const wantedId = probe.wantIndex === null ? null : `a-${runId}-${probe.wantIndex}`;
  const wanted = wantedId === null ? undefined : hits.find((hit) => hit.text.includes(wantedId));
  return {
    label: probe.label,
    query: probe.query,
    wantIndex: probe.wantIndex,
    topDistance: top?.distance ?? null,
    topIsWanted: wantedId !== null && top !== undefined && top.text.includes(wantedId),
    wantedDistance: wanted?.distance ?? null,
  };
}

const encodedReadings: Reading[] = [];
const plainReadings: Reading[] = [];
for (const probe of probes) {
  encodedReadings.push(await probeNamespace(ENCODED_NS, probe));
  plainReadings.push(await probeNamespace(PLAIN_NS, probe));
  console.log(`  probed: ${probe.label}`);
}

function summarise(readings: readonly Reading[]) {
  const matches = readings.filter((reading) => reading.wantIndex !== null && reading.label !== "paraphrase of Q1 with a bot mention");
  const misses = readings.filter((reading) => reading.wantIndex === null);
  const matched = matches.filter((reading) => reading.wantedDistance !== null).map((reading) => reading.wantedDistance ?? 2);
  const wrong = misses.map((reading) => reading.topDistance ?? 2);
  const correctTop = matches.filter((reading) => reading.topIsWanted).length;
  return {
    paraphrasesTried: matches.length,
    rightAnswerWasTopHit: correctTop,
    rightAnswerReturnedAtAll: matched.length,
    bestMatchDistance: matched.length === 0 ? null : Math.min(...matched),
    worstMatchDistance: matched.length === 0 ? null : Math.max(...matched),
    meanMatchDistance: matched.length === 0 ? null : Math.round((matched.reduce((total, value) => total + value, 0) / matched.length) * 1000) / 1000,
    bestUnrelatedDistance: wrong.length === 0 ? null : Math.round(Math.min(...wrong) * 1000) / 1000,
  };
}

const encoded = summarise(encodedReadings);
const plain = summarise(plainReadings);
const mentionEncoded = encodedReadings.find((reading) => reading.label.includes("bot mention"));
const mentionPlain = plainReadings.find((reading) => reading.label.includes("bot mention"));

const result = {
  runId,
  commit,
  date: startedAt.toISOString(),
  environment: `node ${process.version} on ${process.platform}`,
  network: "walrus memory mainnet",
  pairs: PAIRS.length,
  paraphrasesPerPair: 3,
  unrelatedQueries: UNRELATED.length,
  namespaces: { encoded: ENCODED_NS, plain: PLAIN_NS },
  formats: {
    encodedWireLineOnly: { ...encoded, readings: encodedReadings },
    naturalLanguageFirst: { ...plain, readings: plainReadings },
  },
  botMentionEffect: { encoded: mentionEncoded?.wantedDistance ?? null, plain: mentionPlain?.wantedDistance ?? null },
};

mkdirSync("evidence", { recursive: true });
const path = `evidence/answer-recall-${runId}.json`;
writeFileSync(path, `${JSON.stringify(result, null, 2)}\n`);

console.log("");
console.log("format                        | right answer top hit | returned at all | best match | worst match | nearest unrelated");
console.log(`encoded wire line only        | ${encoded.rightAnswerWasTopHit}/${encoded.paraphrasesTried}                 | ${encoded.rightAnswerReturnedAtAll}/${encoded.paraphrasesTried}            | ${encoded.bestMatchDistance ?? "none"}      | ${encoded.worstMatchDistance ?? "none"}       | ${encoded.bestUnrelatedDistance ?? "none"}`);
console.log(`natural language first        | ${plain.rightAnswerWasTopHit}/${plain.paraphrasesTried}                 | ${plain.rightAnswerReturnedAtAll}/${plain.paraphrasesTried}            | ${plain.bestMatchDistance ?? "none"}      | ${plain.worstMatchDistance ?? "none"}       | ${plain.bestUnrelatedDistance ?? "none"}`);
console.log("");
console.log(`a query carrying "@sdmemberbot": encoded ${mentionEncoded?.wantedDistance ?? "no match"}, plain ${mentionPlain?.wantedDistance ?? "no match"}`);
console.log(`written to ${path}`);
