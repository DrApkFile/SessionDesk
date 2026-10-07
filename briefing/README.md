# Briefing: Walrus Sessions 8 "Chatbots That Remember"

Researched: 2026-10-07
Skill: research-and-coding-skill-guide (phases 0-2 done; 3+ pending)

## Status
| Phase | File | State |
|---|---|---|
| 0 Scope | this file | done |
| 1 Event | EVENT.md | done |
| 2 Landscape + past winners | LANDSCAPE.md | done |
| 3 Idea check | IDEA_CHECK.md | done: community memory assistant (GO, conditional) |
| 4 Knowledge | memwal-sdk.md | pending |
| 5 Reality spikes | REALITY_SPIKES.md + ../spike/ | done: 13/14 confirmed; Gemini 503 to re-run |
| 6-10 | | pending |

## TIME WARNING
Deadline is 2026-10-09 14:00 UTC (15:00 Lagos/WAT). At research time that is ~2.5 days.
Rules want the bot "used for a few days" by real people before writing. Every hour
before real users touch the bot is lost evidence. Deploy first, polish later.

## Research queue (from the brief)
- Walrus Memory / MemWal SDK (TS `@mysten-incubation/memwal`, Python `memwal`) - mainnet relayer
- `withMemWal` Vercel AI SDK middleware (official chatbot example)
- Walrus Memory dashboard (account ID + delegate key)
- DeepSurge registration (mandatory)
- Airtable submission form, Walform bug-bounty form, promo form
- Medium / Inkray (article), X (#WalrusMemory, @WalrusProtocol)
- Chosen LLM + runtime (decide in phase 3; non-OpenAI/Anthropic unlocks extra track)
- Deployment channel (Telegram / WhatsApp / web widget / Discord)
