# IDEA_CHECK: Community memory assistant (working title)

Date: 2026-10-07. Supersedes the earlier trader draft (kept as fallback in chat history).
Inputs: EVENT.md, LANDSCAPE.md, MEMWAL_STUDY_GUIDE.md, Walrus's own posts about Session 7 winner Aetheris.

## Hook
"Your community bot welcomed a 6-month regular as a newcomer and told her the bug she reported
was 'being looked into'. It was fixed two weeks ago. Ours can't make that mistake."

## Who, the job, where it fails
Community managers of Telegram groups (startups, projects, creators, clubs). Weekly they answer
repeat questions, lose track of who reported what, who was promised a reply, who keeps helping.
Members repeat themselves. Existing bots (moderation/XP) do not remember people.

## Product: two Telegram bots, shared memory, two models
Member bot (group + DM): remembers each member (interests, language, skill, past questions),
logs feedback/bug reports/feature requests, records promises made to members and follows up,
records contributions, `/mydata` shows what is stored with receipts and allows corrections.
Manager bot (private, different model): top themes this week, follow-ups owed, top helpers,
member history before replying, weekly report draft, manager-only notes.

## What Walrus praised in Aetheris -> how we apply it
| Aetheris (Walrus's words) | Ours |
|---|---|
| Ledger instead of fuzzy similarity | Statuses computed by code from typed events; semantic recall only finds WHAT a message is about |
| Dead NPCs stay dead | Forward-only state machines: member (new -> regular -> contributor -> ambassador; warned), bug (reported -> acknowledged -> fixed -> verified), promise (open -> fulfilled / overdue). No regression without an explicit event |
| World-tick timeline | Per-community monotonic `seq` on every event; conflicts resolved by seq, never by recall order |
| SEAL fog-of-war | Manager notes in a SEPARATE Walrus Memory account (B); member bot holds only account A's key, so it cannot decrypt them (spike S8) |
| Measured numbers | Test suite reports real counts (stale-status errors, prompt-size reduction). Only measured numbers published |

## Hard core
State machines + seq ordering, event resolver over append-only memory, feedback theme matching
(exactly one existing theme or a new one; never two), promise scheduler, contribution rules,
write gate + dedupe + 500 pts/hour governor, secret redactor, two-account boundary.

## Thin-wrapper test
Delete the LLMs: statuses, follow-ups, themes (keyword fallback), contribution counts, /mydata
and manager queries via commands all still work. Passes.

## Sponsor deletion test
Delete Walrus Memory: bots forget everyone on restart, no receipts, no manager-note boundary.
Local cache must be wipeable and rebuilt from Walrus (restore test) or Walrus is decorative.

## Boundary
AI proposes: replies, classification of a message (question/feedback/bug/promise/thanks) as
strict JSON, theme suggestion, report wording.
Code decides: every status change, seq, which events are stored, follow-up dates, points,
which theme an item joins, what each bot may read.
Models never: change a status directly, write memory, see manager notes (member side), see keys,
take moderation action (suggestions to a human only).

## The loop
member speaks -> classify -> event (seq) -> status recomputed -> reply uses status ->
manager asks -> answers with receipts -> promise due -> follow-up -> member /mydata -> correction event.

## Privacy and consent
Opt-in notice in the group; store only community-relevant facts; never phone numbers, emails,
addresses, keys (redactor). Honest limit: MemWal cannot delete a single memory; forget only
un-indexes a namespace and blobs persist. Said plainly in /mydata and the article.

## What we deliberately do not claim
No auto-moderation. Not a CRM. Privacy between members on the member side is enforced by our code
(one account); only manager notes have a cryptographic boundary.

## Rubric -> proof map
| Criterion | Answer | Proof |
|---|---|---|
| Does it remember? | Status-correct replies across days | before/after transcripts; stale-status test counts |
| Real-world use | Live Telegram group | >=3 real members x >=10 memories, timestamps, per-member blob counts |
| Build quality | Pure core + tests + restore test | npm test, clean-clone README |
| Article | The "6-month regular" story | Medium post with real logs |

## Open dependency
A real Telegram community where the user is admin or has the admin's permission. BLOCKING for real use.

## Verdict
GO, conditional on spike S5 and S8 and the real community.
