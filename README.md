# SessionDesk

Two Telegram bots that remember a community on Walrus Memory.

Communities answer the same question every week, lose track of which bugs were reported and which
promises were made, and nobody can tell a new member what the team already knows. Most chatbots
make that worse: they forget everyone the moment the chat window closes, so every conversation
starts from nothing.

SessionDesk keeps one shared memory for a whole community on [Walrus Memory](https://www.walrus.xyz/)
mainnet. A member bot answers from what is actually on record, and a manager bot changes that
record. Nothing is in a database: the ledger is the blobs on Walrus, and a restart rebuilds from
them.

- **Try the member bot:** [t.me/sdmemberbot](https://t.me/sdmemberbot)
- **How it was built, and what broke:** [the write-up on Medium](https://medium.com/@aghaken25/a-community-chatbot-that-remembers-its-members-between-sessions-what-i-built-and-what-broke-2b42f6e75598)
- **Full command reference:** [GUIDE.md](GUIDE.md)

Built for Walrus Sessions 8, "Chatbots That Remember".

## What it does

**The member bot** (Gemini) talks to the community. A member opts in by tapping a button on a
pinned message, and from then on the bot remembers what they report, what they ask and what they
say about themselves. Ask it something the group already answered and it gives you that answer
with the date and a receipt, instead of asking the team again. Report a bug somebody already
reported and it links you to that one and tells you its current status. Every member can run
`/mydata` to read back everything it holds about them, with a Walrus receipt per line, and
`/correct` to fix any of it.

**The manager bot** (Qwen 3.8 27B on Groq) is private, for the people who run the community.
`/themes` shows what people are raising, newest work first, with each report, its status in plain
words and buttons to move it on. `/owed` lists promises that are due. `/answers` curates the
answers the community reuses: nothing is reused until a manager taps Keep. `/note` writes a
manager-only note to a **separate Walrus account** the member bot cannot read.

## How Walrus Memory is used

Every event is one line on Walrus, in a versioned format
(`SD1|seq=12|t=ITEM_STATUS|itemId=i-ab12cd|status=fixed|ts=...`), written to a namespace derived
from an HMAC of the member's user id, never from anything a member types. Consent, reports, status
changes, promises, answers and profile facts are all events. A line that cannot be parsed is
refused, never repaired.

Recall is semantic: when a member asks something, the bot searches the community's answers and
public items for near matches. But **the model never decides a status.** Code folds the events by
sequence number into the current state, builds a facts sheet from that state, and the model is
only allowed to phrase what the sheet already says. A reply that states a status not in the sheet
is thrown away and the next model is tried. That difference is measured, not asserted: reading
state from the resolver gave **0% stale statuses**, against **40%** for plain semantic recall over
the same data ([measurement](evidence/measurement-stale-status-8fe64583.json)).

The in-process cache is derived, not authoritative. On boot it is wiped and rebuilt from Walrus,
which is [proven on mainnet](evidence/restore-test-5c2ff4cb.json). Manager notes live on a second
Walrus account, and a structural test fails the build if any file outside `src/bots/manager`
imports that client.

## Real usage

Run `f426cda8`, commit `7bb017f`, 2026-10-09, Walrus Memory mainnet. Real consented members only,
no seeded or demo data.

| | | |
|---|---|---|
| Members with memories | 5 | [A06-users.json](evidence/A06-users.json) |
| Members over the A06 bar (10+ memories each) | 4 of 5 — 36, 23, 15, 10 | [A06-users.json](evidence/A06-users.json) |
| Blobs written | 212 across 8 namespaces | [A05-blobcount.json](evidence/A05-blobcount.json) |
| Days of real activity | 3 (7–9 Oct 2026) | [A06-users.json](evidence/A06-users.json) |

`A05-blobcount.json` lists every blob id with its Walruscan link, so each one can be opened and
checked. The manager-notes account shows 0 blobs in that run because no manager note had been
written yet — the account and the separation are real, the notes are not there to count.

## Set up for your community

**You need:** Node 22 or newer, two Telegram bots from [@BotFather](https://t.me/BotFather) (one
member, one manager, with privacy mode **disabled** on the member bot), a Walrus Memory account,
and API keys for Gemini and Groq.

**The guided path:**

```bash
git clone <this repo> && cd sessiondesk
npm install
npm run setup     # asks for each value and checks it against the live API as you type
npm run dev       # starts both bots
```

`npm run setup` is worth using even if you are comfortable with env files: it calls Telegram
`getMe` and checks the privacy flag, signs a real recall against Walrus for both accounts, and
makes one short Gemini and Groq call, so a wrong value is caught where the error still makes sense.

**Or deploy it:**

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy)

One service runs both bots. `render.yaml` is in the repo, and `GET /health` returns the boot and
queue state (503 if the boot rebuild failed), with no secrets in the response.

**Then claim it, in Telegram:**

1. The startup log prints a setup code once. DM your **manager** bot: `/claim <that code>`
2. Add your **member** bot to your group, as an admin.
3. In the group, send `/setup` to the manager bot to name that group as the community.
4. In the group, send `/optin` — the member bot posts and pins the notice members tap to join.

Setting the values by hand instead is fine: every variable is documented in
[docs/ENV_VARS.md](docs/ENV_VARS.md), and `src/config.ts` validates all of them at startup with no
blank fallbacks.

## Using it

Members mention the bot in the group, or DM it. Managers send commands to the manager bot in a
direct message. `/help` works in both.

**[GUIDE.md](GUIDE.md) explains every command in plain language**, for members and managers, with
what you type and what you get back.

## For judges

| File | What it shows |
|---|---|
| [JUDGING.md](JUDGING.md) | What to test by hand, what each claim rests on, and the limits |
| [evidence/A05-blobcount.json](evidence/A05-blobcount.json) | 212 blobs on mainnet, every id with a Walruscan link |
| [evidence/A06-users.json](evidence/A06-users.json) | Saved memories per member: 4 of 5 members over the 10-memory bar |
| [evidence/measurement-stale-status-8fe64583.json](evidence/measurement-stale-status-8fe64583.json) | Resolver 0% stale statuses against 40% for plain recall, pre-registered, n=5 |
| [evidence/answer-recall-4bd0e04c.json](evidence/answer-recall-4bd0e04c.json) | Answer recall on mainnet: right answer top hit 15/15, and where the distance thresholds come from |
| [evidence/restore-test-5c2ff4cb.json](evidence/restore-test-5c2ff4cb.json) | Cache wiped, rebuilt from Walrus, status still correct |
| [docs/DECISIONS.md](docs/DECISIONS.md) | Every decision with its reason, including the bugs found in production and reversed decisions |
| [docs/FAILURE_MODES.md](docs/FAILURE_MODES.md) | Each failure mode F01–F21 and the planned response |
| [docs/PRD.md](docs/PRD.md) | What was specified before any code was written |
| [docs/BUILD_CONTRACT.md](docs/BUILD_CONTRACT.md) | The frozen decisions and the honesty rules this repo is held to |
| [briefing/REALITY_SPIKES.md](briefing/REALITY_SPIKES.md) | What was proven against mainnet before building on it (S1–S12) |
| [docs/ENV_VARS.md](docs/ENV_VARS.md) | Every environment variable and what happens if it is wrong |

Regenerating them, each against mainnet and each spending real points:

| Command | Writes |
|---|---|
| `npm run evidence` | `evidence/A05-blobcount.json`, `evidence/A06-users.json` |
| `npm run test:live` | `evidence/restore-test-<run>.json` |
| `npm run measure:answers` | `evidence/answer-recall-<run>.json` |
| `npx tsx --env-file=.env scripts/measure-stale.ts` | `evidence/measurement-stale-status-<run>.json` |

## Honest status and limits

- **Telegram is live** and is the demo platform. **Discord and Slack adapters are built and
  unit-tested but have never run against a real gateway** — treat them as untested in production.
- **Writes are slow and rate-limited.** One save takes 30–38 seconds on mainnet. The budget
  governor allows 500 points an hour per account, and a save costs 5 against a recall's 1, so a
  community gets about **100 saves an hour**, shared with its reads
  (`BUDGET_POINTS_PER_WINDOW` in `src/core/tuning.ts`). Nothing in the reply path waits for a
  write: replies are immediate and writes go through a background queue, so a member sees "saving"
  and the receipt arrives a minute later.
- **A single memory cannot be deleted.** Walrus is permanent. `/correct` appends a correction that
  supersedes the old line, and the old line stays on Walrus. Members are told this before they opt
  in.
- **Self-hosted for now.** Each community needs its own Walrus account and its own API keys,
  because the write budget and the keys are per-account. One shared instance would mean one shared
  rate limit and one operator holding everyone's data.
- **A manager must confirm an answer before it is ever reused**, so a fresh install reuses nothing
  until somebody vouches for it.

## Tech stack

Node 22+ (runs are on 24.19), TypeScript 7 with no `any`, [grammY](https://grammy.dev) 1.46 for
Telegram, `@mysten-incubation/memwal` 0.1.8 for Walrus Memory, zod 4 at every boundary, vitest and
fast-check for tests, Render for hosting. Models: Gemini 3.8 Flash for member replies with a
Gemini 3.5 Flash fallback, and Qwen 3.8 27B on Groq for the manager bot and as a classifier
fallback. No OpenAI anywhere in the runtime.

## Tests

```bash
npm run gate     # typecheck, no-comments check, .env-not-tracked check, then the tests
```

Green as of 2026-10-09 on Node 24.19.0 / Linux: **711 tests in 56 files**, no network. That
includes an adversarial suite for prompt injection, secret handling and structure — for instance a
test that fails the build if a core module imports the Walrus client, if a member-facing reply can
contain an id or a status code, or if any reply asks for a Telegram parse mode.

`npm run test:live` runs the mainnet restore test. It spends real points, so run it deliberately.
