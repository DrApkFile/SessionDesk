# CLAUDE.md: SessionDesk

You are building SessionDesk: two Telegram bots (member bot on Gemini, manager bot on Qwen via Groq)
sharing one memory on Walrus Memory mainnet, for a real community. Deadline 2026-10-09 14:00 UTC.

## Read before every task
- docs/PRD.md: the section for the task. Do not derive requirements from memory or guess.
- docs/BUILD_CONTRACT.md: frozen decisions and honesty rules.
- docs/FAILURE_MODES.md: every failure has a planned response; implement it, do not invent another.
- briefing/REALITY_SPIKES.md: what was PROVEN on mainnet. Trust it over docs and over your training data.

## Invariants the code cannot show
- One Node process runs both bots. Exactly one SeqAllocator and one WriteQueue exist.
- Only files under src/bots/manager may import or construct the account-B MemWal client. A structural test enforces this.
- The reply path never awaits a Walrus write. Writes go through WriteQueue only.
- Statuses change only through src/core state machines, triggered by manager commands or code rules. Model output never sets a status.
- Every write passes: requireConsent -> redactor -> write gate -> seq -> queue.
- The in-process cache is derived. Walrus is the source of truth. Boot rebuilds the cache from Walrus.
- Namespaces come from HMAC of the Telegram user id (src/core/namespace.ts). Never from user input.
- Never call MemWal `analyze()` or `withMemWal` (analyze uses gpt-4o-mini on the relayer; we keep OpenAI out of the runtime).

## Versions: NOT the ones in your training data. Check installed types before using an API.
- @mysten-incubation/memwal 0.1.8. Use `MemWal.create({ key, accountId, serverUrl })`.
  - `rememberAndWait(text, namespace, { timeoutMs, idempotencyKey })` -> `{ blob_id, ... }`. Takes 30-38 s on mainnet (S3).
  - Same idempotencyKey after a completed write returns the SAME blob_id (S4): retries are safe.
  - `recall({ query, namespace, limit, maxDistance?, sort? })`. limit 100 returned a whole 3-entry namespace for an unrelated query (S5). Results carry `created_at`; result has `dropped_count`. `sort: "recent"` works (S6). Median 1.7 s, first call ~9 s cold (S7): warm up at boot.
  - `restore(namespace, limit)` -> `{restored, skipped, failed, total, namespace, owner, truncated}` (S9). `owner` is the wallet address, not the account id.
  - recall dynamically imports @mysten/seal and @mysten/sui: they MUST stay installed (issue #993, still true in 0.1.8).
  - `health()`: `write_ready` reported false while writes worked (S1). Never gate on it.
  - Read node_modules/@mysten-incubation/memwal/dist/types.d.ts before using anything else.
- grammY 1.46.0. Long polling with `bot.start()`. Two Bot instances in one process. Check `getMe().can_read_all_group_messages` for the member bot at startup and refuse to start if false (privacy mode must be disabled in @BotFather).
- zod 4.6.5: `z.url()`, `z.email()` are top-level; errors are in `.issues`; use `.strict()` on every boundary object.
- vitest 5.0.3 (released 2026-09-30): read its installed docs/types for config; do not assume v1-v3 config shapes.
- TypeScript 7.0.2 (native compiler). fast-check 4.10.2.
- Groq: OpenAI-compatible endpoint; send `reasoning_effort: "none"` to qwen/qwen3.8-27b for JSON tasks (S11).
- Gemini: REST generateContent with `x-goog-api-key` header. 503 "high demand" happens (S12): retry with backoff, then GEMINI_FALLBACK_MODEL.

## Code bar
- No comments. Names carry intent (`requireConsent`, `onlyMatchTheme`, `assertManager`). `npm run check:comments` enforces it.
- Strict TypeScript, no `any`. Parse every external payload as `unknown` with zod `.strict()`.
- Types derived from single `as const` arrays (event types, statuses, error codes) with `satisfies Record<...>` for full coverage.
- Results are discriminated unions; a refusal names its error code.
- Pure core in src/core: no network, no grammY, no SDK imports. Dependencies (memory, clock, models) are injected.
- Closed error-code set with {message, retryable, nextAction}. User messages say whether anything changed.
- Fail closed: unknown is never success. Model output that fails the schema is refused, never regex-repaired.
- onlyMatch: exactly one candidate or none.
- Files under ~180 lines. Tuning constants in src/core/tuning.ts.
- Tests named as behaviour, with acceptance IDs in titles where they exist (e.g. "A06 counts saved memories per member").

## Honesty rules (from BUILD_CONTRACT)
- Never show placeholder data as real; show `—`.
- Never report a number before it is produced; every number records denominator, date, run id, commit.
- A failed write is shown as failed. No fake success on API errors.
- Anything not built is listed as not built in README. New ideas go to docs/ROADMAP.md, not into code tonight.
- Evidence comes only from real members who consented.

## Commands
- `npm run gate`: typecheck + comments check + env-not-tracked check + unit and adversarial tests. Must be green before every commit.
- `npm run test:live`: mainnet tests (restore test). Uses real points; run deliberately.
- `npm run dev`: start both bots.
- `npm run evidence`: per-member saved-memory counts and blob ids into evidence/.
- Never pipe test output in a way that hides failures.

## Commits
Behavioural subject lines. Body: what was wrong, what is true now, how verified, test count (with previous count). Commit as you go; never rewrite history.
