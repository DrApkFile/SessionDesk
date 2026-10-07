# BUILD_CONTRACT

## Frozen decisions (changes need a docs/DECISIONS.md entry)
- TypeScript, Node >= 22, ESM. grammY 1.46.0. @mysten-incubation/memwal 0.1.8 + @mysten/seal 1.4.19 + @mysten/sui 2.35.0. zod 4.6.5. vitest 5.0.3. fast-check 4.10.2.
- One Node process runs both bots (two grammY Bot instances). Reason: one sequence allocator and one write queue.
- Member bot model: Gemini (`GEMINI_MODEL`, fallback `GEMINI_FALLBACK_MODEL`). Manager bot model: Qwen on Groq (`GROQ_MODEL`). No OpenAI or Anthropic model anywhere at runtime; relayer `analyze()` is never called (it uses gpt-4o-mini).
- Account A = community memory. Account B = manager-only notes. Only manager modules hold the B client.
- Walrus Memory is the source of truth. The in-process cache is derived, wiped on restart, rebuilt from Walrus.
- Namespaces derived on the server with HMAC-SHA256(NAMESPACE_SECRET, telegramId); never from client input.

## Never fabricate
- No placeholder data shown as real. Show `—` until a real value exists.
- No fallback that returns fake success. A failed write is shown as failed.
- No test counts, latencies or metrics reported before they are produced.
- Demo or seed data is labelled as demo everywhere it appears. Evidence only from real members.

## No silent fallback
- Config validated at startup with zod; no `process.env.X || ''`.
- No empty `catch`. Every caught error maps to a code in src/core/errors.ts or is rethrown.

## Traceable numbers
Every number in README, JUDGING.md or the article records: denominator, run id, commit, date, environment, and real / simulated / provisional.

## Failures stay on record
Failed runs, false results and dropped claims stay in docs/DECISIONS.md.

## Protected critical path
src/core/**, src/memory/**, the consent guard, the redactor, the account-B boundary, scripts/evidence.ts, scripts/restore-test.ts.

## Code bar
briefing/../ skill code bar summarised in CLAUDE.md. Planning quality does not excuse code quality.

## Gate
`npm run gate` from a clean clone: typecheck, no-comments check, .env-not-tracked check, unit + adversarial tests. Live tests separate: `npm run test:live`.

## Proof priority (1 = most important)
1. Real members, real conversations across days, per-member blob counts (A06)
2. Status-correct recall across a restart (restore test)
3. Member bot cannot read manager notes (S8 + structural test)
4. Clean-clone setup works
5. Measured stale-status comparison (P1)
