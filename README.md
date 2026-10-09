# SessionDesk

Two Telegram bots that remember a community on Walrus Memory: a member bot (Gemini) that answers
with the current state of things, and a manager bot (Qwen on Groq) for follow-ups, themes and
private notes. Built for Walrus Sessions 8, "Chatbots That Remember".

## Status
Build steps 1-5 of 7 done (PRD §12), plus the P1 items that matter for a real community: config,
the pure core, the Walrus memory layer, the member bot, the manager bot, deployment, the evidence
script, JUDGING.md, /report and the follow-up scheduler. Deployed on Render.
`npm run gate` is green: typecheck, no-comments check, .env-not-tracked check, and 598 unit and
adversarial tests (no network), run 2026-10-08 on Node 24.19.0 / Linux.
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
- `src/models/gemini.ts` and `replyChain.ts`: a reply is tried on Gemini, then
  GEMINI_FALLBACK_MODEL, then Qwen on Groq, and only then falls back to a plain template. Every
  model's answer must pass the reply guard and a leak check, and the log says who answered
- Everything a member reads is plain language: no ids, no tier labels, no status codes, no
  sequence numbers. A status is "with the team", "the team is on it", "fixed", "fixed and
  confirmed", "already known" or "won't be changed". /mydata numbers its lines and /correct takes
  that number. A test walks every member-facing reply and fails if an internal format appears
- Answer feedback: replying yes or no to a reused answer records it and opens nothing, and
  /answers shows the counts so a manager can /retire an answer that is voted down
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
  the answer becomes community memory as unconfirmed. Nothing is posted in the group: the manager
  bot DMs every manager the question and the answer with Keep and Discard buttons, and the answer
  is reusable only after a Keep (or /confirm). If no manager can be DMed it waits in /answers.
- Long replies: any reply over the chat app's limit is split at line boundaries and sent as several
  messages. A send that still fails logs the reason and tells the manager in plain words, never
  silence. /themes shows the busiest THEMES_SHOWN themes then "and N more"
- Key-term agreement: a semantic match is reused only when both questions name the same
  distinctive things - tickers, networks, devices, versions, and any word the common-word list in
  src/core/tuning.ts does not hold. "testnet SUI" and "testnet SOL" are not the same question, so
  the bot asks which one you mean and shows nothing until you say yes. The same check stops an ios
  bug report being merged into an android item The next person to ask gets the
  confirmed answer, who gave it, the date and a Walruscan receipt, but only when exactly one
  answer is close enough and the question carries at least two words of its own.
  /answers lists them with whether each is confirmed, /retire stops one being reused
- When two confirmed answers are both close enough, the member is told the team has been asked to
  confirm and is shown neither; the managers get both answers with Keep and Retire buttons
- Known issues: a bug report that clearly matches an open item is linked to it (+1 affected)
  instead of opening a duplicate, and the reporter is told the current status
- Community knowledge: a member asking about something the community raised gets its current
  status even if they never filed it. Reported in the group means public; reported in a direct
  message means private, visible only to the reporter and the managers. A question about another
  person is refused in code: "I don't share details about other members."
- A relayer 429 is treated as a budget problem: the queue pauses for exactly the backoff the
  relayer asked for and the write stays pending, never failed

### Self-setup
A new community needs no ids in its settings. `SETUP_CODE` is generated and printed once at
startup; the first person to DM the manager bot `/claim <code>` becomes the owner, recorded as an
`OWNER_SET` event in a config namespace on Walrus. The owner adds and removes managers with
`/addmanager` and `/removemanager`, and a manager names the community with `/setup` in the group.
Owner, managers and community are rebuilt from those events at boot, so they survive a restart.
Governance events store the **HMAC of a person's platform user key**, never a raw id, so claiming
ownership does not put anybody's account id on permanent public storage.

`MANAGER_TELEGRAM_IDS` and `COMMUNITY_CHAT_ID` still work exactly as before, so an existing
deployment runs unchanged. **If both are present, the environment wins**: env-listed managers can
never be removed by an event, and `COMMUNITY_CHAT_ID` overrides whatever `/setup` recorded.

### Platform support
Telegram is the platform this was demoed and run on. The codebase runs every platform through one
neutral port (`src/platform/platform.ts`): a message carries a platform, string ids, a chat kind,
a mention flag and a reply-to, and an action is a reply with optional buttons and an optional pin.
All member and manager logic sits behind that port, so an adapter only translates.

**Discord and Slack are built and unit-tested, not live-verified.** Their message shapes, chat
kinds, mention handling, button callbacks, scope and intent checks all have tests, and the shared
behaviour suite runs the same member expectations against all three platforms through fakes. No
live run against a real Discord guild or Slack workspace has happened yet, so nothing here claims
one. Telegram's identity is pinned by a test so existing member namespaces cannot move; Discord
and Slack ids are hashed as `discord:<id>` and `slack:<id>`, which cannot collide with a Telegram
id or with each other.

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

## Set up SessionDesk for your community in 15 minutes

You do not need to be a developer. You need a Telegram account, a web browser, and about fifteen
minutes. Nothing here asks you to find your own user id or your group's id.

### 1. Make two Telegram bots (4 minutes)
In Telegram, message **@BotFather**.
- Send `/newbot`, give it a name and a username ending in `bot`. Copy the long token it gives you.
  This is your **member bot**, the one your community talks to.
- Send `/setprivacy`, pick that bot, choose **Disable**. Without this it cannot read group messages.
- Send `/newbot` again for a second bot. This is your **manager bot**, for you only.

### 2. Make two Walrus Memory accounts (4 minutes)
Go to **memory.walrus.xyz**, sign in, and create **two** accounts. For each one copy the account id
(starts `0x`) and a delegate key. The second account exists so your private manager notes sit
somewhere the member bot cannot read, which is a promise this project can actually keep.

### 3. Get two model keys (3 minutes)
- **aistudio.google.com/apikey** → Create API key. Free tier is fine.
- **console.groq.com/keys** → Create API Key.

### 4. Start it (2 minutes)

**Either** on your own machine:
```
npm ci
npm run setup
```
The wizard asks for each value in plain language, tells you where to find it, and **checks each one
works as you paste it** — it will tell you if privacy mode is still on, if a Walrus key does not
match its account, or if a model key is wrong, and what to do about it. It then writes `.env`,
generates the two secrets for you, and prints your **setup code** once.

**Or** deploy it with one click:

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy)

Render reads `render.yaml`, asks you for the values above, and generates `NAMESPACE_SECRET` and
`SETUP_CODE` itself. Every setting is explained in [docs/ENV_VARS.md](docs/ENV_VARS.md). Then open
the service's **Logs** and look for the block that says `YOUR SETUP CODE`. It is printed **once**,
never again, and never appears in `/health`, `/status` or any evidence file.

### 5. Claim it and point it at your group (2 minutes)
1. Message your **manager bot** and send `/claim <the setup code>`. You are now the owner. Nobody
   else can claim it.
2. Add your **member bot** to your group, and make it an admin so it can pin a message.
3. In that group send `/setup`. The bot confirms which group it will serve.
4. In that group send `/optin`. The bot posts a notice and pins it. Anyone who taps **I agree** is in.

That is it. To let someone else run manager commands, reply to one of their messages with
`/addmanager`. Use `/removemanager` to take it back. You cannot remove yourself.

### If something goes wrong
| What you see | What it means |
|---|---|
| The bot ignores everything in the group | Privacy mode is still on. @BotFather → `/setprivacy` → pick the member bot → Disable → remove and re-add it to the group. |
| `/optin` posts but does not pin | The member bot is not an admin. Make it one; it still works, just unpinned. |
| "Nobody has claimed this assistant yet" | Send `/claim <code>` to the **manager** bot in a direct message, not the member bot and not the group. |
| "that setup code is wrong" | Check the log block again. If you lost it, delete `SETUP_CODE` from your settings and restart: a fresh one is printed once. |
| "no community chat is set yet" | Send `/setup` in the group you want it to serve. |
| Replies say "my AI is overloaded" | Gemini is busy. It retries, then tries a second Gemini model, then Groq, and only then gives you plain facts. Nothing is lost. |
| `/mydata` shows "still saving" | A Walrus write takes 30 to 38 seconds. Check again in a minute and it will show a receipt link. |
| It stops answering after a while on Render's free plan | Free services sleep when idle. Point a pinger at `/health` every 5 to 10 minutes (see Deploy below). |

## Setup by hand (if you would rather not use the wizard)

1. **Node 22 or newer.** `npm ci`
2. **Two Walrus Memory accounts** (account A for community memory, account B for manager notes
   only). You need each account's object id and its delegate key.
3. **Model keys:** a Gemini API key and a Groq API key.
4. `cp .env.example .env` and fill the shared values. `NAMESPACE_SECRET` must be a long random
   string: `openssl rand -hex 32`. **Never change it after members join** - it is the key that
   maps a platform user id to a namespace, so changing it orphans every memory already written.
5. Either run `npm run setup`, or fill `.env` yourself. Turn on at least one platform below. `TELEGRAM_ENABLED` defaults to `true`;
   `DISCORD_ENABLED` and `SLACK_ENABLED` default to `false`. A platform's settings are only
   required when it is enabled, and a platform that is off is never constructed.
6. `npm run gate` - typecheck, no-comments check, .env-not-tracked check, and the full unit and
   adversarial suite. No network, no keys needed.
7. `npm run dev` starts every enabled platform and the health server on port 3000.

One process serves every platform, with **one** sequence allocator and **one** write queue shared
across them. Do not run two instances against the same tokens.

### Telegram (the platform this was demoed on)
1. Two bots from @BotFather: one member bot, one manager bot.
2. For the member bot run `/setprivacy` and choose **Disable**, or it cannot read group messages
   and this app refuses to start.
3. Add the member bot to your group, and make it an admin if you want `/optin` to pin its notice.
4. Get your numeric id from @userinfobot for `MANAGER_TELEGRAM_IDS`, and the group's chat id. The
   bot logs the chat id it sees at startup and refuses to run if it does not match
   `COMMUNITY_CHAT_ID`.

### Discord
1. Create an application at <https://discord.com/developers/applications>, open **Bot**, and copy
   the token into `DISCORD_BOT_TOKEN`.
2. Under **Privileged Gateway Intents**, turn on **Message Content Intent**. Without it the bot
   cannot read what members write, and the adapter refuses to start with that exact instruction.
3. Invite the bot with the `bot` scope and the permissions: View Channels, Send Messages,
   Read Message History, and Manage Messages (only needed to pin the opt-in notice).
4. Put the channel it should serve in `DISCORD_CHANNEL_ID` (right-click the channel, Copy
   Channel ID, with Developer Mode on) and your own user id in `DISCORD_MANAGER_IDS`.

### Slack
1. Create an app at <https://api.slack.com/apps> from scratch.
2. **OAuth & Permissions** → Bot Token Scopes: `app_mentions:read`, `channels:history`,
   `chat:write`, `im:history`, `im:write`, `pins:write`, `users:read`. Install to the workspace
   and copy the `xoxb-` token into `SLACK_BOT_TOKEN`.
3. **Socket Mode** → enable it, generate an app-level token with `connections:write`, and copy the
   `xapp-` token into `SLACK_APP_TOKEN`. Socket Mode means **no public URL is needed**.
4. **Event Subscriptions** → subscribe to `message.channels`, `message.im` and `app_mention`.
5. Invite the bot to the channel, put that channel id in `SLACK_CHANNEL_ID` and your own member
   id in `SLACK_MANAGER_IDS`.

### What you should see
```
sessiondesk config accountA=0x… communityKey=c1 platforms=telegram … port=3000
sessiondesk boot_done summary=namespaces=N lines=N decoded=N … maxSeq=N nextSeq=N complete=true
sessiondesk notes_boot_done … account=B namespace=sd-<key>-notes
sessiondesk.member identity username=… canReadAllGroupMessages=true
sessiondesk group configured=-100… seen=-100… type=supergroup title=…
sessiondesk platform_not_started platform=discord enabled=false configured=false
sessiondesk platforms enabled=telegram started=telegram
sessiondesk ready platforms=telegram seqNext=N queue=0 managers=1 port=3000
sessiondesk polling bot=member …
```
If `canReadAllGroupMessages` is false, Telegram privacy mode is still on. If `group` does not
appear, the bot is not in the group or `COMMUNITY_CHAT_ID` is wrong; both refuse to start rather
than run half working.

### Other commands
- `npm run setup` the guided wizard: asks for each value, checks it live, writes `.env`.
- `npm run measure:answers` writes five question-and-answer pairs to a throwaway namespace in both
  the old and new formats and prints how far each paraphrase lands from each. Use it to set
  ANSWER_MAX_DISTANCE and KNOWN_ISSUE_MAX_DISTANCE. **Spends real points.**
- `npm run resave:answers` rewrites existing answers in the searchable format so older answers
  become findable. **Spends real points.**
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
