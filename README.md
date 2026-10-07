# SessionDesk

Two Telegram bots that remember a community on Walrus Memory: a member bot (Gemini) that answers
with the current state of things, and a manager bot (Qwen on Groq) for follow-ups, themes and
private notes. Built for Walrus Sessions 8, "Chatbots That Remember".

## Status
Build steps 1-5 of 7 done (PRD §12), plus the P1 items that matter for a real community: config,
the pure core, the Walrus memory layer, the member bot, the manager bot, deployment, the evidence
script, JUDGING.md, /report and the follow-up scheduler. Deployed on Render.
`npm run gate` is green: typecheck, no-comments check, .env-not-tracked check, and 431 unit and
adversarial tests (no network), run 2026-10-07 on Node 24.19.0 / Linux.
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
- Opt-in from the group: a manager runs /optin, the bot posts and pins a notice with I agree and
  I agree + DMs. A tap records consent under the tapper's own namespace hash and answers them
  privately with show_alert. A second tap writes nothing. Taps from any other chat are ignored.
  A group tap for DMs records storage consent and points at t.me/<bot>?start=dm, because Telegram
  will not let a bot message someone who has never pressed Start
- `src/models/classifier.ts` holds a message in memory and retries when no model can read it,
  falling back to Qwen on Groq after GEMINI_RETRY_WINDOW_MINUTES; nothing is stored until a
  valid classification exists, and the buffer is lost on restart, which it says out loud
- `src/bots/manager/` /owed, /themes, /helpers, /member, /ack, /fixed, /verify, /reopen,
  /duplicate, /wontfix, /promise, /done, /note, /notes, /ambassador, /unambassador, /report,
  /status, and free text answered by Qwen over a code-built summary only. Manager notes are
  written to account B, which only this directory can construct, into its own cache
- Follow-up scheduler: when a promise comes due it DMs every manager, and DMs the member only if
  they agreed to DMs, saying honestly that it is still open and the team has been reminded. A
  DM_ADDRESS line in the member's own namespace keeps them reachable across restarts
- Community answers: when a manager answers a member's question, or a member's reply is thanked,
  the answer becomes community memory. The next person to ask gets the earlier answer, who gave
  it, the date and a Walruscan receipt, but only when exactly one answer is close enough.
  /answers lists them, /retire stops one being reused
- Known issues: a bug report that clearly matches an open item is linked to it (+1 affected)
  instead of opening a duplicate, and the reporter is told the current status
- A relayer 429 is treated as a budget problem: the queue pauses for exactly the backoff the
  relayer asked for and the write stays pending, never failed

### Not built yet
- Namespace roll-over at 90 entries per namespace (designed, flagged in code, not built)
- Nothing from the measured comparison is outstanding: it was pre-registered and run on mainnet
  (run 8fe64583, N=5): plain top-5 semantic recall carried a stale status in 40% of cases, the
  resolver in 0%, at 160 against 165 mean context tokens. Read the caveats in JUDGING.md
- Everything in docs/ROADMAP.md: web dashboard, Discord and Slack, multi-community, separate
  deployments per bot, per-member Walrus accounts
- While Gemini is down, a member is answered from the facts sheet but their message is not
  classified or stored (docs/DECISIONS.md)
- No event type can set the `ambassador` tier: the frozen event list has none, so that tier is
  unreachable tonight (docs/DECISIONS.md)
- The "reply path never awaits a write" test arrives with the write queue in step 2
- No mainnet numbers are claimed here yet. Proven facts: briefing/REALITY_SPIKES.md

## Setup from a clean clone
1. **Node 22 or newer.** `npm ci`
2. **Two Telegram bots** from @BotFather: one member bot, one manager bot. For the member bot run
   `/setprivacy` and choose **Disable**, or it cannot see group messages and this app refuses to
   start. Add the member bot to your group.
3. **Make the member bot an admin of the group** if you want `/optin` to pin its notice. Without
   pin rights it still posts the notice and logs `optin_pin_failed`.
4. **Two Walrus Memory accounts** (account A for community memory, account B for manager notes
   only). You need each account's object id and its delegate key.
5. **Model keys:** a Gemini API key and a Groq API key.
6. **Your own ids:** your numeric Telegram id from @userinfobot for `MANAGER_TELEGRAM_IDS`, and the
   group's chat id. The member bot logs the chat id it sees at startup, and refuses to run if it
   does not match `COMMUNITY_CHAT_ID`.
7. `cp .env.example .env` and fill every value. `NAMESPACE_SECRET` must be a long random string:
   `openssl rand -hex 32`. **Never change it after members join** - it is the key that maps a
   Telegram id to a namespace, so changing it orphans every memory already written.
8. `npm run gate` - typecheck, no-comments check, .env-not-tracked check, and the full unit and
   adversarial suite. No network, no keys needed.
9. `npm run dev` starts both bots and the health server on port 3000.

### What you should see
```
sessiondesk config accountA=0x… communityKey=c1 communityChatId=-100… port=3000
sessiondesk boot_done summary=namespaces=N lines=N decoded=N … maxSeq=N nextSeq=N complete=true
sessiondesk notes_boot_done … account=B namespace=sd-<key>-notes
sessiondesk.member identity username=… canReadAllGroupMessages=true
sessiondesk group configured=-100… seen=-100… type=supergroup title=…
sessiondesk ready bots=member+manager seqNext=N queue=0 managers=1
sessiondesk polling bot=manager …
sessiondesk polling bot=member …
```
If `canReadAllGroupMessages` is false, privacy mode is still on. If `group` does not appear, the
bot is not in the group or `COMMUNITY_CHAT_ID` is wrong; both refuse to start rather than run half
working.

### Other commands
- `npm run evidence` per-member memory counts, blob ids with Walruscan links, and the agent id
  into `evidence/`. Reads mainnet, costs a few points.
- `npm run test:live` the restore test: writes to mainnet, wipes the cache, rebuilds, compares.
  **Spends real points** - run it deliberately.
- `npm test` unit and adversarial only, no network.

See `JUDGING.md` for what each claim means and how to check it.

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
