# JUDGING.md

SessionDesk: two Telegram bots that share one memory on Walrus Memory mainnet. A member bot that
answers with the **current** state of things, and a manager bot that changes that state and keeps
private notes on a second Walrus account the member bot cannot read.

Every number below records how it was produced. Anything not built is listed as not built.

## What it does

A member talks to the group or DMs the bot. Each message is classified, turned into an event with
a monotonic sequence number, and written to Walrus in the background. Replies are built from a
**code-made facts sheet**, so the model can describe what is on record but cannot invent a status.
A manager moves items through a state machine (`/ack`, `/fixed`, `/verify`, `/reopen`), promises
things with due dates, and writes notes to a separate account. The in-process cache is derived:
wiped on restart, rebuilt from Walrus at boot.

The claim worth testing: **ask the same question before and after a status change and the answer
changes, across a restart**. Not "the bot remembers you said hello".

## How to verify each claim

| Claim | How to check it yourself | Where the evidence is |
|---|---|---|
| Memory survives a restart, with the **current** status | `npm run test:live` writes 6 lines to mainnet, wipes the cache, rebuilds from Walrus, and compares resolved state | `evidence/restore-test-*.json`, `passed: true` |
| It is running and polling | `GET https://<service>/health` → 200, `status: ok`, both bots `polling: true` | live endpoint |
| A member never sees an internal format | `npm test` walks every reply the member bot can send without a model and asserts no facts-sheet header, item id, tier label, status code, seq number or namespace appears | `tests/unit/plainLanguage.test.ts` |
| A status is said in plain words | reported is "with the team", fixed is "fixed", and the reply guard maps those phrases back to statuses so a model cannot smuggle a wrong one through | `src/core/plainWords.ts` |
| A member can opt in without leaving the group | A manager runs `/optin`; the pinned notice has **I agree** and **I agree + DMs**. One tap records consent under that member's namespace hash, a second tap writes nothing | `tests/unit/groupOptin.test.ts` |
| An earlier answer is reused instead of re-answered | Ask a question the group already answered: the reply names who answered, the date and a Walruscan receipt, and asks "did this help?" | `tests/unit/answerReuse.test.ts`, `/answers` |
| A duplicate bug is linked, not opened twice | Report something already on record: the reply gives the existing item's current status and counts you as affected | `tests/unit/answerReuse.test.ts` |
| A promise follow-up survives a restart | `DM_ADDRESS` is restored from Walrus at boot, so a member who agreed to DMs is reachable without speaking again | `tests/unit/dmAddress.test.ts` |
| Blobs are on mainnet, with the agent id | `npm run evidence` → every blob id with a Walruscan link | `evidence/A05-blobcount.json` |
| Real members, counted per member | `npm run evidence` → per-member memory counts, first and last activity, distinct days | `evidence/A06-users.json` |
| The member bot cannot read manager notes | `npm test` runs the structure test: no account-B mention outside `src/bots/manager`, and the member cache never holds a note | `tests/adversarial/structure.test.ts` |
| A model cannot change a status | `npm test`: injection payloads produce no status event, and the write gate's draft type makes it a **compile error** | `tests/adversarial/injection.test.ts`, `src/core/authority.ts` |
| Secrets are never stored | `npm test`: property tests over generated keys, tokens, emails and phones, including glued into a sentence | `tests/unit/redactor.test.ts`, `tests/adversarial/secrets.test.ts` |
| Everything green from a clean clone | `npm ci && npm run gate` | typecheck, no-comments check, .env-not-tracked check, unit + adversarial tests |

## Proven facts, with their source

Everything here was measured on mainnet, not assumed. Spike details: `briefing/REALITY_SPIKES.md`.

| Fact | Value | Source |
|---|---|---|
| A Walrus write takes 30-38 s | 35.7 s per write average over 6 writes | restore test run `5c2ff4cb`, 2026-10-07 |
| `idempotencyKey` dedupes a completed write | same `blob_id` returned, 2.3 s | spike S4, run `05bb7bbb` |
| A limit-100 recall returns a whole small namespace | 3 of 3, including for an unrelated query | spike S5 (tested at 3 entries only) |
| Recall latency | median 1.7 s, first call ~9 s cold | spike S7 |
| Account A cannot read account B | B sees 1, A sees 0 | spike S8 |
| `restore()` works | `skipped 3, failed 0, truncated false` | spike S9 |
| Relayer `health.write_ready` says `false` while writes succeed | reproduced | spike S1. We never gate on it |
| Gemini returns 503 "high demand" | reproduced | spike S12. Hence the retry, the Groq fallback and the hold buffer |
| Boot rebuild after a restart on the deployed service | `namespaces=1 lines=1 maxSeq=1 nextSeq=2` | Render log, 2026-10-07 |

## The measured claim: stale status in the model's context

Pre-registered in `docs/DECISIONS.md` **before** the run, and published as it came out.

Run `8fe64583` · commit `8999c27` · 2026-10-07T21:40Z · Walrus Memory mainnet, namespace
`sd-c1meas-*` · N = **5** scripted scenarios, each an item taken reported → acknowledged → fixed,
then one member question asked about it. Both arms read their lines back from Walrus; the resolver
arm folded 20 recalled lines by `seq`. Tokens estimated with the SDK's own `estimateTokens`.

| Arm | Context contained a stale status | Mean context tokens |
|---|---|---|
| Plain top-5 semantic recall | **40%** (2 of 5) | 160 |
| Our resolver → facts sheet | **0%** (0 of 5) | 165 |

In both failing cases the plain recall returned the `acknowledged` line for an item that was
already `fixed`, so a model answering from that context could truthfully say "acknowledged" about
a fixed bug. The resolver's context named only `fixed`, which was the current status in all five.

Read this honestly:
- **N is 5.** 40% is two cases out of five, not a population estimate. Rerun it with more
  scenarios and the number will move.
- **The resolver is not cheaper.** 165 tokens against 160 — slightly *larger*, and flat across
  scenarios because the facts sheet is a fixed shape. The gain here is correctness, not size.
- Every scenario is the same shape: one item, two status changes, a direct "is X fixed?" question.
  That is the shape this design exists for, so it is a favourable test, not an adversarial one.
- Reproduce it: `MEASURE_SKIP_WRITES=1 MEASURE_RUN_ID=8fe64583 npx tsx --env-file=.env scripts/measure-stale.ts`
  reads the same mainnet lines back and recomputes both arms without writing anything.

## Honest limits

- **Forgetting is partial.** Walrus storage is permanent. "Forget" means the namespace stops being
  indexed; blobs already written stay on Walrus and nobody can delete them. The consent notice says
  this before a member agrees.
- **One process, two bots.** The storage boundary between community memory and manager notes is
  cryptographic (separate accounts, proven S8). The runtime boundary is code-level: a structure test
  plus separate caches. Separate deployments are on the roadmap, not built.
- **While Gemini and Groq are both down**, a message is held in memory and not stored. The member is
  told so at the time, and a restart loses the buffer, which the shutdown log reports as
  `unclassified_lost count=N stored=false`.
- **`@username` resolution** only covers members the bot has seen since it started. Usernames are
  never written to Walrus. Reply to a member's message or use their 8-character member code instead.
- **Recall above 100 entries per namespace is untested.** Roll-over at 90 entries is designed and
  flagged in code, not built.
- **A group tap of "I agree + DMs" cannot turn DMs on by itself.** Telegram refuses to let a bot
  message anyone who has never pressed Start, so the tap records storage consent and the alert
  asks for one more tap on the deep link. Only `/start dm` in a direct message turns DMs on.
- **A member's Telegram id is stored** when, and only when, they choose "I agree + DMs", as a
  `DM_ADDRESS` line in their own namespace so promise follow-ups survive a restart. It is encrypted
  like every other line, and never appears in a namespace name, a log line, `/status` or any
  evidence file. Turning DMs off stops it being used; the line itself stays on Walrus, and
  `/mydata` says so.
- **A reply is tried against three models before the template.** Gemini, then
  `GEMINI_FALLBACK_MODEL`, then Qwen on Groq. Every answer must pass the reply guard and a leak
  check; one that fails falls through to the next model. Only when all three are gone does the
  member get the plain template, and it says so.
- **Answer reuse needs exactly one clear match.** Two answers within the distance threshold means
  none is reused, by design. Thresholds are in `src/core/tuning.ts`.
- **An answer recorded from a thanked member reply has no question text**, because Telegram does
  not give us the message that prompted it. `/answers` prints "(question not on record)" rather
  than inventing one.

## Not built

`/report` weekly draft and the follow-up scheduler are P1 — see the README for the current state.
No web dashboard, no Discord or Slack, no automatic moderation, no multi-community support, no
per-memory deletion (Walrus Memory cannot do it). Full list: `docs/ROADMAP.md`.

## Where to look in the code

- `src/core/` the pure core: codec, event authority, resolver, state machines, redactor, facts sheet
- `src/memory/` Walrus adapter, background write queue, derived cache, boot rebuild
- `src/bots/member/`, `src/bots/manager/` the two bots
- `docs/PRD.md` the frozen plan, `docs/DECISIONS.md` every decision and every correction
