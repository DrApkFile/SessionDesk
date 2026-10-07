# SessionDesk

Two Telegram bots that remember a community on Walrus Memory: a member bot (Gemini) that answers
with the current state of things, and a manager bot (Qwen on Groq) for follow-ups, themes and
private notes. Built for Walrus Sessions 8, "Chatbots That Remember".

## Status
Build steps 1-4 of 7 done (PRD §12): config, the pure core, the Walrus memory layer, the member
bot and the manager bot. `npm run gate` is green: typecheck, no-comments check, .env-not-tracked
check, and 306 unit and adversarial tests (no network), run 2026-10-07 on Node 24.19.0 / Linux.
The restore test has been run once against Walrus mainnet: evidence/restore-test-5c2ff4cb.json
(6 blobs written, 35.7 s per write, cache wiped and rebuilt, status still correct).

### Built
- `src/config.ts` strict zod validation of all 16 environment variables; no blank fallbacks
- `src/core/` codec (versioned wire format, refuses what it cannot parse), event vocabulary and
  payload schemas, event authority (the write gate cannot emit a status event, enforced by the
  compiler), resolver (folds by `seq`, not by recall order), item and promise state machines,
  member tier ladder, redactor, consent and manager guards, theme onlyMatch, contribution rules,
  sequence allocator, points budget governor, idempotency keys, HMAC namespaces, facts sheet and
  reply guard
- `src/memory/` MemWal adapter, background write queue with retries and budget pauses, derived
  cache, boot rebuild from Walrus
- `src/models/gemini.ts` 503 retry then `GEMINI_FALLBACK_MODEL`, then an honest template reply
- `src/bots/member/` consent flow, classification, write gate, replies built only from the
  code-made facts sheet, /mydata with a Walrus receipt per line, /correct, /help
- `src/models/classifier.ts` holds a message in memory and retries when no model can read it,
  falling back to Qwen on Groq after GEMINI_RETRY_WINDOW_MINUTES; nothing is stored until a
  valid classification exists, and the buffer is lost on restart, which it says out loud
- `src/bots/manager/` /owed, /themes, /helpers, /member, /ack, /fixed, /verify, /reopen,
  /duplicate, /wontfix, /promise, /done, /note, /notes, /ambassador, /unambassador, /status,
  and free text answered by Qwen over a code-built summary only. Manager notes are written to
  account B, which only this directory can construct, into its own cache

### Not built yet
- Evidence script, JUDGING.md (step 5); everything in PRD §11 P1, including /report, the
  follow-up scheduler that DMs about due promises, namespace roll-over, and the measured
  stale-status comparison
- While Gemini is down, a member is answered from the facts sheet but their message is not
  classified or stored (docs/DECISIONS.md)
- No event type can set the `ambassador` tier: the frozen event list has none, so that tier is
  unreachable tonight (docs/DECISIONS.md)
- The "reply path never awaits a write" test arrives with the write queue in step 2
- No mainnet numbers are claimed here yet. Proven facts: briefing/REALITY_SPIKES.md

## Setup (once code exists)
1. Node 22+. `npm ci`
2. `cp .env.example .env` and fill it (see comments in the file).
3. @BotFather: `/setprivacy` -> member bot -> Disable. Add the member bot to the group as admin.
4. `npm run gate`, then `npm run dev`.

## Layout
- `briefing/` research: event rules, landscape, idea check, reality spikes
- `docs/` PRD, build contract, failure modes, decisions, roadmap
- `spike/` the mainnet reality spike
- `src/`, `tests/`, `scripts/`, `evidence/` the build (empty until built)
