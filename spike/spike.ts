import { writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { MemWal } from "@mysten-incubation/memwal";

const EnvSchema = z.object({
  MEMWAL_A_ACCOUNT_ID: z.string().regex(/^0x[0-9a-fA-F]+$/),
  MEMWAL_A_PRIVATE_KEY: z.string().min(32),
  MEMWAL_B_ACCOUNT_ID: z.string().regex(/^0x[0-9a-fA-F]+$/),
  MEMWAL_B_PRIVATE_KEY: z.string().min(32),
  MEMWAL_SERVER_URL: z.url(),
  TELEGRAM_MEMBER_BOT_TOKEN: z.string().min(20),
  TELEGRAM_MANAGER_BOT_TOKEN: z.string().min(20),
  GROQ_API_KEY: z.string().min(10),
  GROQ_MODEL: z.string().min(1),
  GEMINI_API_KEY: z.string().min(10),
  GEMINI_MODEL: z.string().min(1),
});

type Outcome = "confirmed" | "wrong" | "ambiguous" | "error";

interface SpikeResult {
  id: string;
  claim: string;
  outcome: Outcome;
  detail: string;
  ms: number;
}

const results: SpikeResult[] = [];

function describeError(err: unknown): string {
  if (err instanceof Error) {
    const extra = err as Error & { status?: number; serverCode?: string };
    const parts = [err.name, err.message];
    if (extra.status !== undefined) parts.push(`status=${extra.status}`);
    if (extra.serverCode !== undefined) parts.push(`serverCode=${extra.serverCode}`);
    return parts.join(" | ");
  }
  return String(err);
}

async function spike(
  id: string,
  claim: string,
  run: () => Promise<{ outcome: Outcome; detail: string }>,
): Promise<void> {
  const started = performance.now();
  try {
    const { outcome, detail } = await run();
    results.push({ id, claim, outcome, detail, ms: Math.round(performance.now() - started) });
  } catch (err) {
    results.push({ id, claim, outcome: "error", detail: describeError(err), ms: Math.round(performance.now() - started) });
  }
  const last = results[results.length - 1]!;
  console.log(`[${last.id}] ${last.outcome.toUpperCase()} (${last.ms} ms) ${last.claim}\n      ${last.detail}`);
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
}

function isOkJson(text: string): boolean {
  const stripped = text.replace(/^```(json)?|```$/g, "").trim();
  try {
    return z.object({ ok: z.literal(true) }).safeParse(JSON.parse(stripped)).success;
  } catch {
    return false;
  }
}

async function main(): Promise<void> {
  const parsed = EnvSchema.safeParse(process.env);
  if (!parsed.success) {
    console.error("Config invalid. Fix .env (see .env.example):");
    for (const issue of parsed.error.issues) console.error(`  ${issue.path.join(".")}: ${issue.message}`);
    process.exit(1);
  }
  const env = parsed.data;
  if (env.MEMWAL_A_ACCOUNT_ID === env.MEMWAL_B_ACCOUNT_ID) {
    console.error("Accounts A and B must be different Walrus Memory accounts (different wallets).");
    process.exit(1);
  }

  const runId = randomUUID().slice(0, 8);
  const ledgerNs = `spike-${runId}-ledger`;
  const managerNs = `spike-${runId}-mgr`;
  console.log(`Run ${runId}. Namespaces: ${ledgerNs}, ${managerNs}\n`);

  const memberMemory = MemWal.create({ key: env.MEMWAL_A_PRIVATE_KEY, accountId: env.MEMWAL_A_ACCOUNT_ID, serverUrl: env.MEMWAL_SERVER_URL });
  const managerMemory = MemWal.create({ key: env.MEMWAL_B_PRIVATE_KEY, accountId: env.MEMWAL_B_ACCOUNT_ID, serverUrl: env.MEMWAL_SERVER_URL });

  let relayerInfo = "unknown";

  await spike("S1", "Relayer is healthy and reports versions", async () => {
    const health = await memberMemory.health();
    relayerInfo = `status=${health.status} version=${health.version} api=${health.apiVersion ?? "?"} write_ready=${String(health.write_ready)}`;
    return { outcome: health.status === "ok" ? "confirmed" : "ambiguous", detail: relayerInfo };
  });

  await spike("S2a", "Account A delegate key authenticates on mainnet (first signed call)", async () => {
    await memberMemory.recall({ query: "ping", namespace: `spike-${runId}-auth`, limit: 1 });
    return { outcome: "confirmed", detail: "signed recall accepted" };
  });

  await spike("S2b", "Account B delegate key authenticates on mainnet", async () => {
    await managerMemory.recall({ query: "ping", namespace: `spike-${runId}-auth`, limit: 1 });
    return { outcome: "confirmed", detail: "signed recall accepted" };
  });

  const ledgerEvents = [
    `CM1|seq=1|MEMBER_JOINED|member=spike-user|interest=design`,
    `CM1|seq=2|BUG_REPORTED|member=spike-user|bug=android-login-fails`,
    `CM1|seq=3|BUG_STATUS|bug=android-login-fails|status=fixed`,
  ];
  const firstIdempotencyKey = `${runId}-seq1`;
  const firstBlob: { id?: string } = {};
  const writeTimings: number[] = [];

  await spike("S3", "rememberAndWait returns a blob_id for each ledger event", async () => {
    const blobIds: string[] = [];
    for (const [index, text] of ledgerEvents.entries()) {
      const started = performance.now();
      const saved = await memberMemory.rememberAndWait(text, ledgerNs, {
        timeoutMs: 90_000,
        idempotencyKey: index === 0 ? firstIdempotencyKey : `${runId}-seq${index + 1}`,
      });
      writeTimings.push(Math.round(performance.now() - started));
      blobIds.push(saved.blob_id);
    }
    firstBlob.id = blobIds[0];
    const allPresent = blobIds.every((id) => id.length > 0);
    return {
      outcome: allPresent ? "confirmed" : "wrong",
      detail: `blob_ids=${blobIds.join(",")} write_ms=${writeTimings.join(",")}`,
    };
  });

  let expectedCount = ledgerEvents.length;

  await spike("S4", "Re-sending a completed write with the same idempotencyKey does NOT create a duplicate", async () => {
    const again = await memberMemory.rememberAndWait(ledgerEvents[0]!, ledgerNs, { timeoutMs: 90_000, idempotencyKey: firstIdempotencyKey });
    if (again.blob_id === firstBlob.id) return { outcome: "confirmed", detail: `same blob_id ${again.blob_id}` };
    expectedCount += 1;
    return { outcome: "wrong", detail: `new blob_id ${again.blob_id}; we must dedupe ourselves before writing` };
  });

  await spike("S5", "recall(limit 100) on a small namespace returns EVERY entry, with created_at", async () => {
    let found = 0;
    let withCreatedAt = 0;
    let dropped = 0;
    for (let attempt = 1; attempt <= 5; attempt++) {
      const result = await memberMemory.recall({ query: "community event status", namespace: ledgerNs, limit: 100 });
      found = result.results.length;
      withCreatedAt = result.results.filter((memory) => typeof memory.created_at === "string").length;
      dropped = result.dropped_count ?? 0;
      if (found >= expectedCount) break;
      await sleep(4_000);
    }
    const unrelated = await memberMemory.recall({ query: "banana bread recipe", namespace: ledgerNs, limit: 100 });
    const outcome: Outcome = found >= expectedCount && unrelated.results.length >= expectedCount ? "confirmed" : "wrong";
    return {
      outcome,
      detail: `expected=${expectedCount} found=${found} unrelated_query_found=${unrelated.results.length} with_created_at=${withCreatedAt} dropped=${dropped}`,
    };
  });

  await spike("S6", "sort:'recent' with limit 1 returns the newest event (seq=3)", async () => {
    const result = await memberMemory.recall({ query: "bug status", namespace: ledgerNs, limit: 1, sort: "recent" });
    const text = result.results[0]?.text ?? "";
    return { outcome: text.includes("seq=3") ? "confirmed" : "wrong", detail: `top=${text || "none"}` };
  });

  await spike("S7", "Recall latency on mainnet (3 runs)", async () => {
    const timings: number[] = [];
    for (let i = 0; i < 3; i++) {
      const started = performance.now();
      await memberMemory.recall({ query: "member history", namespace: ledgerNs, limit: 100 });
      timings.push(Math.round(performance.now() - started));
    }
    return { outcome: "confirmed", detail: `ms=${timings.join(",")} median=${median(timings)}` };
  });

  await spike("S8", "Account A cannot read a manager note written by account B (separate owners)", async () => {
    await managerMemory.rememberAndWait(`CM1|seq=1|MANAGER_NOTE|text=spike secret ${runId}`, managerNs, { timeoutMs: 90_000 });
    let managerSees = 0;
    for (let attempt = 1; attempt <= 5; attempt++) {
      managerSees = (await managerMemory.recall({ query: "manager note", namespace: managerNs, limit: 10 })).results.length;
      if (managerSees > 0) break;
      await sleep(4_000);
    }
    const memberSees = (await memberMemory.recall({ query: "manager note", namespace: managerNs, limit: 10 })).results.length;
    const outcome: Outcome = managerSees > 0 && memberSees === 0 ? "confirmed" : "wrong";
    return { outcome, detail: `account_B_sees=${managerSees} account_A_sees=${memberSees}` };
  });

  await spike("S9", "restore() re-reads the ledger namespace from Walrus", async () => {
    const restored = await memberMemory.restore(ledgerNs, 20);
    return { outcome: "confirmed", detail: JSON.stringify(restored) };
  });

  for (const [id, label, token] of [
    ["S10a", "member", env.TELEGRAM_MEMBER_BOT_TOKEN],
    ["S10b", "manager", env.TELEGRAM_MANAGER_BOT_TOKEN],
  ] as const) {
    await spike(id, `Telegram ${label} bot token is valid (getMe)`, async () => {
      const response = await fetch(`https://api.telegram.org/bot${token}/getMe`);
      const body = (await response.json()) as unknown;
      const parsedBody = z.object({ ok: z.boolean(), result: z.object({ username: z.string() }).optional() }).safeParse(body);
      if (!parsedBody.success || !parsedBody.data.ok) return { outcome: "wrong", detail: `http=${response.status}` };
      return { outcome: "confirmed", detail: `@${parsedBody.data.result?.username ?? "?"}` };
    });
  }

  const jsonPrompt = 'Reply with exactly this JSON and nothing else: {"ok":true}';

  await spike("S11", "Groq model answers and returns parseable JSON", async () => {
    const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${env.GROQ_API_KEY}` },
      body: JSON.stringify({ model: env.GROQ_MODEL, messages: [{ role: "user", content: jsonPrompt }], temperature: 0, reasoning_effort: "none" }),
    });
    const body = (await response.json()) as unknown;
    const content = z.object({ choices: z.array(z.object({ message: z.object({ content: z.string() }) })).min(1) }).safeParse(body);
    if (!content.success) return { outcome: "wrong", detail: `http=${response.status} body=${JSON.stringify(body).slice(0, 200)}` };
    const text = content.data.choices[0]!.message.content.trim();
    const isJson = isOkJson(text);
    return { outcome: isJson ? "confirmed" : "ambiguous", detail: `model=${env.GROQ_MODEL} reply=${text.slice(0, 80)}` };
  });

  await spike("S12", "Gemini model answers and returns parseable JSON", async () => {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(env.GEMINI_MODEL)}:generateContent`;
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": env.GEMINI_API_KEY },
      body: JSON.stringify({ contents: [{ parts: [{ text: jsonPrompt }] }], generationConfig: { temperature: 0 } }),
    });
    const body = (await response.json()) as unknown;
    const content = z
      .object({ candidates: z.array(z.object({ content: z.object({ parts: z.array(z.object({ text: z.string() })).min(1) }) })).min(1) })
      .safeParse(body);
    if (!content.success) return { outcome: "wrong", detail: `http=${response.status} body=${JSON.stringify(body).slice(0, 200)}` };
    const text = content.data.candidates[0]!.content.parts[0]!.text.trim();
    const isJson = isOkJson(text);
    return { outcome: isJson ? "confirmed" : "ambiguous", detail: `model=${env.GEMINI_MODEL} reply=${text.slice(0, 80)}` };
  });

  const summary = {
    runId,
    ranAt: new Date().toISOString(),
    sdk: "@mysten-incubation/memwal@0.1.8",
    relayer: relayerInfo,
    namespaces: { ledgerNs, managerNs },
    results,
  };
  await writeFile("spike-results.json", JSON.stringify(summary, null, 2));
  const counts = results.reduce<Record<string, number>>((acc, r) => ({ ...acc, [r.outcome]: (acc[r.outcome] ?? 0) + 1 }), {});
  console.log(`\nDone. ${JSON.stringify(counts)}. Full results in spike-results.json (no secrets are written to it).`);
}

main().catch((err: unknown) => {
  console.error(`Spike crashed: ${describeError(err)}`);
  process.exit(1);
});
