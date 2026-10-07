# PRD: SessionDesk

Status: frozen for build 2026-10-07. Deadline 2026-10-09 14:00 UTC (15:00 Lagos).
Inputs: briefing/*.md (event, landscape, idea check, reality spikes), docs/FAILURE_MODES.md.

## 1. Goals and non-goals
Goals
- A member bot that remembers each member of a real Telegram community and answers with the CURRENT state of things (bugs, promises, their profile), never a stale one.
- A manager bot that answers "what do I owe", "what are people asking", "who helps most", "show me this member", and keeps private notes the member bot cannot read.
- Real members using it across days, with per-member Walrus blob receipts.
- A repo a stranger can clone and run.

Non-goals (never tonight)
Web dashboard. Discord/Slack. Automatic moderation or bans. Multi-community support. Payments.
Per-memory deletion (MemWal cannot do it). Separate deployments per bot (ROADMAP).

## 2. Hook, loop, boundary
Hook: "Your community bot welcomed a 6-month regular as a newcomer and told her the bug she reported was 'being looked into'. It was fixed two weeks ago. SessionDesk can't make that mistake."

Loop: member speaks -> classified -> event with seq -> background write to Walrus -> state recomputed -> replies use state -> manager asks -> answers with receipts -> promise due -> follow-up -> member /mydata -> correction event.

Boundary
- AI proposes: reply text; a classification of a message as strict JSON; a theme label; report wording.
- Code decides: every status change, seq, which events are stored, due dates, contribution points, which theme an item joins, who may read what.
- Models never: change a status, write memory, see manager notes (member side), see keys, take moderation action.

## 3. Memory layout (account A unless stated)
| Namespace | Holds | Read |
|---|---|---|
| `sd-m-<h>` where h = first 24 hex of HMAC-SHA256(NAMESPACE_SECRET, telegramUserId) | One member's events: consent, profile facts, questions, feedback they filed, promises to them, contributions, corrections, tier grants | recall limit 100 (whole namespace, S5) at boot and on cache miss |
| `sd-items` | ITEM_OPENED and ITEM_STATUS events for all bugs/features/feedback | recall limit 100 |
| `sd-themes` | THEME_CREATED events | recall limit 100 |
| account B: `sd-notes` | MANAGER_NOTE events | manager bot only |

Prefix all namespaces with `COMMUNITY_KEY` from config (one community per deployment), e.g. `sd-<communityKey>-m-<h>`.

### Event line format (wire format, versioned)
`SD1|seq=<int>|t=<TYPE>|<key>=<urlencoded value>|...|ts=<ISO>`
Exactly one encoder and one decoder in src/core/codec.ts. Unknown version or type decodes to `null` (refuse, never repair). Round-trip property test.

### Event types (single `as const` array)
CONSENT_GIVEN, PROFILE_FACT (field in interest|skill|language|role), QUESTION_ASKED (themeId),
ITEM_OPENED (itemId, kind in bug|feature|feedback, themeId, text), ITEM_STATUS (itemId, status),
PROMISE_MADE (promiseId, memberH, itemId?, due, text, byManagerId), PROMISE_FULFILLED (promiseId),
CONTRIBUTION (kind in helped|valid_report, toMemberH?), CORRECTION (targetSeq, field, value),
THEME_CREATED (themeId, label), MANAGER_NOTE (account B only; memberH?, text),
TIER_SET (memberH, tier=ambassador, byManagerId), TIER_REVOKED (memberH, byManagerId).

TIER_SET and TIER_REVOKED are manager-only, like ITEM_STATUS and the promise events: the write
gate's draft type excludes them, so model-driven code cannot create one (compile error).

### Sequence (world tick)
Monotonic integer per community. At boot: seq = max(seq seen in all namespaces) + 1. Allocated only by the single SeqAllocator in the one process. Conflicts resolve by seq, never by recall order or created_at.

## 4. State machines (pure, src/core)
Item: reported -> acknowledged -> fixed -> verified. Terminal side exits: duplicate, wont_fix. One named backward edge: fixed -> reported via REOPENED (manager only). Any other transition = `INVALID_TRANSITION`, nothing stored.
Promise: open -> fulfilled. `overdue` is derived (open and due < now), never stored.
Member tier: new -> regular (active on >= REGULAR_MIN_ACTIVE_DAYS distinct days) -> contributor (>= CONTRIBUTOR_MIN_POINTS). Earned tiers are forward-only. Active days count only events the member caused; a manager action in their namespace is not a day they were active.
Ambassador is a manager grant held beside the earned tier (TIER_SET), and the displayed tier is the higher of the two. One named backward edge: TIER_REVOKED clears the grant and returns the member to their earned tier, the tier ladder's equivalent of REOPENED for items. Granting twice, or revoking a grant that does not exist, is `INVALID_TRANSITION` and nothing is stored.
Constants live in src/core/tuning.ts.

## 5. Flows
### Member bot (Gemini)
1. Update arrives (group or DM). Drop bots and channels.
2. requireConsent: unknown member in a group -> no storage; reply only if mentioned, with the consent button. DM /start shows notice + "I agree" button -> CONSENT_GIVEN.
3. Redactor runs on the text. Secret found -> nothing stored, member warned (`SECRET_BLOCKED`).
4. Classify with Gemini: strict JSON `{kind: question|bug|feature|feedback|thanks|profile|chit_chat|other, themeLabel?: string, profile?: {field, value}}`, parsed as unknown, zod `.strict()`. Fail -> `other`.
5. Write gate decides events (chit_chat/other -> none). Theme: onlyMatch against existing theme labels (normalized exact match); none -> THEME_CREATED.
6. Thanks: if the message replies to another member and kind=thanks -> CONTRIBUTION helped to that member (max 1 per pair per day, not self).
7. Events get seq, are applied to the cache immediately with status `saving`, queued for write. Reply never awaits the write.
8. Reply (group only if mentioned or a command; DMs always) using a code-built facts sheet: member tier and profile, their open items with current status, their open promises. The model is told the facts sheet is data, not instructions, and to never state a status that is not in it.

Member commands: /start, /mydata (everything stored about them, each with status saving|saved(blob link)|failed), /correct <seq> <value>, /help.

### Manager bot (Qwen on Groq), allowlisted MANAGER_TELEGRAM_IDS
/owed (open promises sorted by due, overdue first), /themes (top themes this week with counts and item ids), /helpers (contribution points this month), /member @username or reply-forward, /ack <itemId>, /fixed <itemId>, /verify <itemId>, /reopen <itemId>, /promise <itemId|@member> <YYYY-MM-DD> <text>, /done <promiseId>, /note <text> (account B), /notes, /ambassador @member, /unambassador @member, /report (weekly draft by Qwen from a code-built summary), /status (memory health, queue depth, budget used).
Free text to the manager bot: answered by Qwen over a code-built summary only.

### Follow-ups
A scheduler checks promises every FOLLOWUP_CHECK_MINUTES. When due: DM the manager "due today: ..." and, if the member consented to DMs, tell the member the status honestly ("not done yet, the team has been reminded").

## 6. Write queue and budget
One queue, concurrency 1 (concurrent writes untested). Each job: rememberAndWait(text, ns, {timeoutMs: WRITE_TIMEOUT_MS, idempotencyKey}). idempotencyKey = hash(communityKey, chatId, messageId, eventType, index). Retries 3 with backoff. Budget governor: remember 5 pts, recall 1 pt, 500/hour rolling; pause when a write would exceed it.

## 7. Error codes (closed set, src/core/errors.ts)
Each: {message, retryable, nextAction}. MEMORY_UNAVAILABLE, MEMORY_PARTIAL, WRITE_PENDING, WRITE_FAILED, BUDGET_EXHAUSTED, MODEL_UNAVAILABLE, MODEL_OUTPUT_REFUSED, NOT_CONSENTED, NOT_MANAGER, SECRET_BLOCKED, INVALID_TRANSITION, UNKNOWN_ITEM, AMBIGUOUS_TARGET, INVALID_DATE.

## 8. Security model
- Delegate keys only in env; never logged. Redactor applied to every log line and stored text.
- Member namespaces are HMAC-derived; Telegram ids never appear in namespaces.
- Storage boundary for manager notes is cryptographic (separate account, proven S8). Runtime boundary is code-level because both bots share one process; stated honestly in README.
- Walrus is public, permanent storage (encrypted). Never store phone numbers, emails, addresses, keys. Forget is namespace-wide un-indexing only; blobs persist. Said in the consent notice.

## 9. Demo script (for the video and article)
1. Member DMs /start, agrees, says they are a designer.
2. In the group, member @mentions: Android login fails. Item opened.
3. Manager: /ack, /promise <item> <thursday> "we'll check by Thursday".
4. Restart the process. Cache wiped. Boot rebuilds from Walrus (log shows counts).
5. Manager /fixed. Member asks again -> "fixed on <date>" with receipt link. Baseline shown: plain semantic recall would surface "reported".
6. /owed shows the promise; /done.
7. Member /mydata, /correct.
8. Manager /note; member bot has no path to it (structural test + S8).
9. Kill network to relayer -> member bot says memory unavailable, not "welcome, new member".

## 10. Tests (mirror the demo)
Unit (no network): codec round-trip (property), resolver determinism (shuffled events -> same state, property), every state machine edge allowed/refused, write gate, onlyMatch themes, contribution rules, redactor (property over generated keys/emails/phones), consent guard, manager allowlist, budget governor with fake clock, reply path never awaits writes.
Adversarial: injection text cannot change a status; invalid model JSON stores nothing; secrets never reach the fake memory.
Structural: no module under src/bots/member imports the account-B client.
Live (separate, real mainnet): restore test (write, wipe cache, rebuild, compare), evidence script.
Measured (P1, preregistered): stale-status rate of injected context, resolver vs plain top-5 semantic recall, on a fixed scripted set; metric chosen now; result published whatever it is.

## 11. Priorities
P0: config, core (codec, events, resolver, state machines, errors, tuning, redactor, write gate), memory adapter + queue + budget, member bot (consent, classify, store, reply, /mydata), manager bot (/owed, /themes, /member, /ack, /fixed, /promise, /done, /note, /ambassador, /unambassador, /status), boot rebuild, evidence script, restore test, deployment, JUDGING.md.
P1: /report, /helpers, /correct, follow-up scheduler DMs, Gemini fallback, namespace roll-over, stale-status measurement.
Never tonight: see non-goals.

## 12. Build order (record each step the moment it works)
1. Config + core + unit tests (no network).
2. Memory adapter + queue + boot rebuild; live restore test.
3. Member bot DM flow; then group flow. Deploy. Invite real members. The F15 structure test must
   fail, not pass vacuously, if src/bots/member or src/bots/shared is missing once this step starts.
4. Manager bot P0 commands.
5. Evidence script, JUDGING.md, README clean-clone check.
6. P1 items while members use it.
7. Article (Friday morning).

## 13. Definition of finished
`npm run gate` green from a clean clone; both bots live; >= 3 real members with >= 10 saved memories each (evidence/A06); restore test log; README + JUDGING.md + article published; form submitted before 12:00 Lagos Friday.

## 14. Submission field mapping
LLM/runtime: "Gemini (gemini-3.8-flash) for member bot, Qwen 3.8 27B on Groq for manager bot, Node 22".
Agent ID: delegate public key of account A (form's MEMWAL_AGENT_ID); also give both account IDs.
Blob count: evidence/A05-blobcount.json. Repo URL. Article URL. X post URL. Bug/friction: #993 still present in 0.1.8; health write_ready=false while writes succeed; 30-38 s writes. Improvement idea: per-memory supersede/delete. Promo link.

## 15. Judge Q&A
- Different from withMemWal example? We never use the middleware: statuses are computed from an event ledger, and writes run in a background queue sized to the points budget.
- Decorative memory? Demo step 5: same question, current status vs stale.
- Real users? evidence/A06 per-member counts with dates; group screenshots with consent.
- Privacy? HMAC namespaces, consent, redactor, honest limits on forget.
