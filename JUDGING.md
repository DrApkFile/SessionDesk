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
| A member learns what the community knows | Ask about a bug somebody else reported in the group: the reply gives its current status. Ask about one reported in a DM: it is invisible | `tests/unit/communityKnowledge.test.ts` |
| Nothing about another member is shared | A question naming a person and a personal topic is refused in code before any model sees it, and another member's profile, promises, notes and points never enter the model's context | `src/core/aboutOthers.ts`, `tests/unit/communityKnowledge.test.ts` |
| A member never sees an internal format | `npm test` walks every reply the member bot can send without a model and asserts no facts-sheet header, item id, tier label, status code, seq number or namespace appears | `tests/unit/plainLanguage.test.ts` |
| A status is said in plain words | reported is "with the team", fixed is "fixed", and the reply guard maps those phrases back to statuses so a model cannot smuggle a wrong one through | `src/core/plainWords.ts` |
| Another community can run this without editing code | `npm run setup` checks every value live and writes `.env`; or click Deploy to Render. Then `/claim`, `/setup`, `/optin`. No personal ids in settings | `tests/unit/selfSetup.test.ts`, `docs/ENV_VARS.md` |
| Ownership cannot be taken | A second `OWNER_SET`, a manager change not signed by the owner, and a `COMMUNITY_SET` from a non-manager are all rejected by the resolver, not just by the command layer | `tests/unit/selfSetup.test.ts` |
| A member can opt in without leaving the group | A manager runs `/optin`; the pinned notice has **I agree** and **I agree + DMs**. One tap records consent under that member's namespace hash, a second tap writes nothing | `tests/unit/groupOptin.test.ts` |
| An earlier answer is reused instead of re-answered | `/confirm` the answer in the manager bot first, then ask the question again: the reply names who answered, the date and a Walruscan receipt, and asks "did this help?" | `tests/unit/answerReuse.test.ts`, `/answers` |
| An unconfirmed answer is never reused | Ask something matching one of the six legacy answers: you get a normal reply, and `/answers` shows it as NOT CONFIRMED with Keep and Discard buttons | `tests/unit/answerReuse.test.ts` |
| Capture is never announced in the group | Reply to a member's question as a manager: the group sees nothing about it, and each manager gets a DM with the question, the answer and Keep / Discard | `tests/unit/answerReuse.test.ts` |
| Two questions differing by one term are not the same question | Ask about a token, network, device or version the stored answer does not name: the bot asks which you mean and shows nothing until you say yes | `tests/unit/keyTerms.test.ts`, `tests/unit/answerReuse.test.ts` |
| A long reply arrives, in parts | Run `/themes` or `/answers` on a busy community: a reply over 4096 characters arrives as several messages split at line boundaries, never as silence | `tests/unit/longReplies.test.ts` |
| A vague question is not matched at all | Mention the bot with "what's <someone> fixed?": the log says `reuse_skipped` with the content-word count, and no search runs | `tests/unit/reuseQuery.test.ts` |
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

## The measured claim: answer reuse distances

Run `4bd0e04c` · commit `892370b` · 2026-10-08T22:23Z · mainnet · 5 question-and-answer pairs,
3 paraphrases each, plus 3 unrelated queries.

| Format | Right answer top hit | True paraphrases | Closest unrelated | Gap |
|---|---|---|---|---|
| Encoded wire line only | 15/15 | 0.386 – 0.713 | 0.847 | 0.134 |
| Natural language first | 15/15 | 0.365 – 0.672 | 0.865 | **0.193** |

The 15 true paraphrase distances, natural-language format, in order: 0.365, 0.404, 0.434, 0.444,
0.446, 0.47, 0.479, 0.502, 0.509, 0.52, 0.522, 0.545, 0.547, 0.554, 0.672.

`ANSWER_MAX_DISTANCE` is **0.56**: the lowest round value that keeps 14 of those 15. It drops only
the 0.672 outlier and turns the margin to the closest unrelated query (0.865) from 0.145 into
**0.305**. The cost is stated rather than hidden: one paraphrase in fifteen is re-answered instead
of reused. `KNOWN_ISSUE_MAX_DISTANCE` is **0.5**, kept below the answer threshold on purpose.
Both are pinned by `tests/unit/searchableLine.test.ts`, so changing either without re-measuring
fails the gate.

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

## Platforms

Telegram is the platform this was demoed on and the only one with a live run behind it.

| Platform | State |
|---|---|
| Telegram | **Live**, used by real members, every claim above measured on it |
| Discord | **Built and unit-tested, not live-verified** |
| Slack | **Built and unit-tested, not live-verified** |

All logic sits behind one neutral port, so an adapter only translates a platform's message shape
into `PlatformMessage` and an action back out. The shared behaviour suite
(`tests/unit/crossPlatform.test.ts`) runs the same member expectations - consent under the right
hash, nothing stored without consent, an item opened, thanks credited, plain-language `/mydata`,
manager-only `/optin`, taps from other chats ignored - against all three platforms through fakes.

Identity cannot cross platforms: a Telegram id hashes exactly as it always did, so no existing
namespace moves (pinned by `tests/unit/identity.test.ts`), while Discord and Slack ids hash as
`discord:<id>` and `slack:<id>`. A manager on one platform is not a manager on another.

## Setting it up somewhere else

Nothing in the settings names a person. `SETUP_CODE` is generated and printed once; whoever sends
`/claim <code>` to the manager bot first becomes the owner. Governance events store the HMAC of a
platform user key, never a raw id. `MANAGER_TELEGRAM_IDS` and `COMMUNITY_CHAT_ID` keep working, and
when both env and events exist **env wins** — tested both ways.

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
- **The setup wizard has been run against the real APIs only by its author.** Its checks call
  Telegram `getMe`, the Walrus relayer's `health` plus a signed recall per account, and one short
  Gemini and Groq call. A Gemini 503 is reported as "overloaded, the key may be fine" rather than
  as a bad key, because that is what S12 showed happening.
- **Discord and Slack have never run live.** Their adapters are written against the installed
  types (discord.js 14.23.2, @slack/bolt 4.4.0) and unit-tested, but no message has gone through
  a real gateway or Socket Mode connection. Treat them as untested in production until a live run
  is recorded here.
- **Answer reuse never fired until 2026-10-08 because the distance threshold was set below any
  real match.** Measured on mainnet (run `4bd0e04c`): true paraphrases land at 0.365 to 0.672 and
  the closest unrelated query at 0.865, while `ANSWER_MAX_DISTANCE` was 0.32. It was then set to
  0.72, which produced a false match in the group within a day, and is now 0.56 — the value that
  keeps 14 of the 15 measured paraphrases. `KNOWN_ISSUE_MAX_DISTANCE` is 0.5, deliberately
  stricter and extrapolated rather than measured, because a wrong known-issue link silently
  swallows a real report while a wrong answer reuse is recoverable.
- **The storage format change is an improvement, not the fix.** Both formats ranked the right
  answer first in 15 of 15 paraphrases; natural language widened the gap from 0.134 to 0.193.
- **Confirmation happens in a manager DM, never in the group.** Until 2026-10-09 the member bot
  asked "Should I reuse that answer?" in the community chat, which quoted a member's question and a
  manager's reply back to everyone. There is no group fallback now: if no manager can be DMed, the
  answer stays unconfirmed in `/answers` and nothing is posted.
- **Nothing on mainnet is reusable today.** An answer is reused only in state `active`, and an
  `ANSWER` line without the `confirmed` flag — which is every line written before 2026-10-09 —
  decodes as `pending`. The six junk answers already there ("she no call me o", a question that was
  literally "?") are therefore inert without rewriting history. A manager promotes an answer with
  `/confirm <answerId>` or the Keep button, and `/answers` names the pending ids.
- **Distance alone cannot tell two named things apart.** "how do I get testnet SUI?" and "how do
  I get testnet SOL?" were reused as the same question on 2026-10-09, because the sentences differ
  by one ticker and sit far inside any usable threshold. A semantic match must now also pass a
  key-term check in code, and a mismatch produces a question to the member rather than a guess.
  Measured against run `4bd0e04c`, all 15 paraphrases still pass the check, and that is pinned by
  a test. A capitalised or `$`-prefixed short token counts as distinctive even when the word is
  ordinary, because NEAR and LINK are both ordinary words and would otherwise have agreed.
  **Residual risk, stated**: a lower-case ticker that is also an ordinary word and is not in the
  eight-entry `TICKER_WORDS` list ("one", "time", "key", "gas") is not distinctive on its own.
- **The distance threshold is not the lever for this.** It stays at 0.56: SUI and SOL differ by
  three letters, so no threshold that keeps real paraphrases can separate them. Tightening it
  would drop measured paraphrases and still reuse the wrong answer.
- **A false match reached the group once**, on 2026-10-09 with the threshold at 0.72: "what's
  Kenne fixed?" drew the conflict reply, which then quoted two members' off-topic remarks back to
  the group. Four defences now stand between that message and a reply, each sufficient alone:
  legacy answers are pending; a question must carry 2 words of its own after handles and known
  names are stripped (that one leaves "fixed"); the threshold is 0.56; and the conflict reply
  quotes nothing. **Its own distance was never read from the live log**, so 0.56 comes from run
  `4bd0e04c` and not from that message.
- **Public means "reported in the community chat".** An item reported in a direct message is
  private: only its reporter and the managers ever see it. Items written before the field existed
  default to public, because the group chat is where they came from — but their origin was never
  recorded, so a legacy direct-message report would be exposed. On this deployment all seven
  legacy items are visibly group messages.
- **The community section is capped**: at most three matched items and three themes, within
  `KNOWN_ISSUE_MAX_DISTANCE` (0.5), stricter than the answer threshold.
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
