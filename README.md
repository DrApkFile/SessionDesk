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
4. `npm run gate`, then `npm run dev`. For a deployed instance see Deploy below.

## Deploy (Render free web service, one service runs both bots)

One service, one process: both bots, one sequence allocator, one write queue. Do not scale it
past one instance. Telegram allows a single poller per bot token, so a second instance makes both
flap with 409 Conflict.

### Setup
1. Push this repo to GitHub.
2. In Render: **New > Blueprint**, point it at the repo, and `render.yaml` creates the service
   (`plan: free`, `healthCheckPath: /health`, `NODE_VERSION=22`, build `npm ci --include=dev`,
   start `npm start`). Or create a Web Service by hand with those four settings.
3. Set the environment variables below in the dashboard. `render.yaml` marks every secret
   `sync: false`, so Render asks for them and never stores them in the repo.
4. Deploy. Watch the log for `boot_done`, `notes_boot_done`, `group`, `ready`, then
   `polling bot=manager` and `polling bot=member`.
5. Check `https://<service>.onrender.com/health` returns 200.

`PORT` is provided by Render; the server binds to it and nothing else needs to change. Locally
`npm run dev` reads `.env` and defaults to port 3000.

### Environment variables to set in the dashboard
| Variable | Notes |
|---|---|
| `MEMWAL_A_ACCOUNT_ID`, `MEMWAL_A_PRIVATE_KEY` | account A, the community memory |
| `MEMWAL_B_ACCOUNT_ID`, `MEMWAL_B_PRIVATE_KEY` | account B, manager notes only |
| `TELEGRAM_MEMBER_BOT_TOKEN`, `TELEGRAM_MANAGER_BOT_TOKEN` | privacy mode must be disabled for the member bot |
| `MANAGER_TELEGRAM_IDS` | comma-separated numeric ids |
| `COMMUNITY_CHAT_ID` | the group id, negative; startup refuses to run if it does not match |
| `COMMUNITY_KEY` | namespace prefix, 1-12 lowercase letters or digits. Never change it after members join |
| `NAMESPACE_SECRET` | 32+ random characters. Changing it orphans every member namespace |
| `GEMINI_API_KEY`, `GROQ_API_KEY` | model keys |

`MEMWAL_SERVER_URL`, `GEMINI_MODEL`, `GEMINI_FALLBACK_MODEL` and `GROQ_MODEL` already have values
in `render.yaml`; override them in the dashboard only if you need to.

### Keep it awake
A Render free web service spins down after about 15 minutes without HTTP traffic, and a spun-down
service is not polling Telegram. Point an external pinger at `GET /health` every **5 to 10
minutes** (cron-job.org, UptimeRobot, Better Stack, or a cron job anywhere you already run one).

What a spin-down actually costs, stated plainly: Telegram keeps undelivered updates for about 24
hours, so messages sent while the service is asleep arrive once it wakes, not instantly. Anything
still in the in-memory classification buffer is lost on a restart and the log says so
(`unclassified_lost count=N stored=false`). The derived cache is rebuilt from Walrus at every
boot, so nothing already written is lost.

### /health
```json
{
  "status": "ok",
  "bootOk": true,
  "bootSummary": "namespaces=3 lines=7 decoded=7 ... maxSeq=7 nextSeq=8",
  "bots": [{ "name": "member", "polling": true, "state": "polling", "conflicts": 0 }],
  "queue": { "depth": 0, "pending": 0, "saved": 7, "failed": 0, "paused": false, "acceptingWrites": true },
  "lastWrite": { "at": "...", "state": "saved", "namespaceKind": "member", "code": null }
}
```
200 when the boot rebuild worked, **503 when it did not**, so Render takes a broken instance out
of service instead of leaving a bot running that cannot read its own memory. `status` is
`degraded` when a bot is not polling. The response carries no key, no token, no member hash and
no namespace: a write is reported by namespace *kind* only.

### Shutdown
On `SIGTERM` (every Render deploy and restart) the service stops polling, stops accepting new
writes, drains the queue for up to `SHUTDOWN_DRAIN_SECONDS`, then logs exactly what happened:
`drained saved=N failed=N stillPending=N refusedAfterClose=N`. A write that was queued but not
confirmed by the relayer is logged as `writes_lost ... stored=false`, never as saved.

### A 409 Conflict is survivable
If another instance is polling the same token (an overlapping deploy, or a local `npm run dev`
left running), the supervisor logs `polling_conflict`, backs off 5s, 15s, 30s, then 60s, and
keeps retrying. The process never exits on it, and `/health` reports `state: conflict_backoff`
with `polling: false` while it waits. A 401 is treated differently: the token is wrong, so it
stops retrying and says so.

## Layout
- `briefing/` research: event rules, landscape, idea check, reality spikes
- `docs/` PRD, build contract, failure modes, decisions, roadmap
- `spike/` the mainnet reality spike
- `src/`, `tests/`, `scripts/`, `evidence/` the build (empty until built)
