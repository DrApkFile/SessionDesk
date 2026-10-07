# LANDSCAPE + past winners

Researched: 2026-10-07
Note: winner lists are mostly posted on X (not fetchable). Only placements seen in a
fetched/indexed source are marked confirmed. Treat the rest as entrants, not winners.

## The Walrus Sessions series (9 sessions so far)
1 Walgo Site Builder (Apr) - 2 Tools Builder (May) - 3 BellySeal (Jun) - 4 Memory World Cup (Jun)
- 5 Memory Prompt Jam (Jun-Jul) - 6 Memory Story (Jul-Aug) - 7 Prompt Evolution (Aug)
- **8 Chatbots That Remember (now)** - 9 RedSentinel Unbreakable Agents (Oct 5-20, overlaps!)

## Past winners / spotlights
| Session | Project | Status | What it did | Lesson for us |
|---|---|---|---|---|
| 2 Tools Builder | WalForm (@UyLeQuoc), walform.wal.app | CONFIRMED 1st ($500 WAL) | Network-native form platform | Walrus now runs its own bounty forms on it. Build something the organisers would actually use. |
| 2 Tools Builder | Walrus Forms | CONFIRMED 2nd ($300) | Form platform | - |
| 7 Prompt Evolution | Aetheris World Engine (@MrRobotJi) | CONFIRMED "one of our Session 7 winners" (Walrus X) | AI Dungeon Master that never forgets canon (dead villain stays dead): immutable game state on mainnet, SEAL-encrypted secret notes, world timeline | Winning pitch = a painful, relatable "it forgot" moment + memory that enforces truth, not just recalls. |
| 5 Prompt Jam | Continuity Keeper (@yukitran03) | SPOTLIGHT (favourite), placement unconfirmed | Portable agent continuity | Walrus spotlights projects publicly - good article/repo = marketing for them. |
| 5 Prompt Jam | Continuum (Anand-0037) | entrant | Coding-agent memory: logs decisions/REJECTED ideas/GOTCHAs; cross-tool recall (Cursor -> Claude Code) with blob count proof | Typed memory (decision/rejection/gotcha) + cross-tool demo. |
| 7 Prompt Evolution | D&D Campaign Memory v2 (Makabeez) | entrant | Boot-from-memory, contradiction guard, write gate, supersede chain (npc v1->v2->v3) verified on mainnet | "Supersede" handling of stale facts is the house differentiator. |
| 4 World Cup | WalCup 26 | entrant | Predictions + agent detects your biases and roasts you | Memory -> personality that evolves; fun. |
| 4 World Cup | Walrus Memory World Cup 3D | entrant | 3D searchable moment sphere, watch blob IDs stream | Make storage *visible*. |
| 4 World Cup | Mr. Toxic Special One | entrant | Streaming chat on Vercel + MemWal; filed issue #277 (serverless latency guide) | Turning friction into a well-written GitHub issue = feedback/bounty points. |
| Haulout (bigger Walrus hackathon, 2025) | Spectra 1st AI&Data; Infinite Heroes 2nd; TradeArena 3rd | CONFIRMED | Private moderation in TEE; selfie comics; AI trading with every decision on Walrus | Walrus judges reward verifiability + every decision on Walrus. |

World Cup (closest precedent) judged: memory depth (day 1 vs day 4 before/after), creativity
("projects that look the same score lower"), technical execution ("focused working MVP beats ambitious broken").
Expect the same taste in Session 8.

## House style (what strong Walrus Memory entries share)
1. A single relatable "it forgot" pain stated in one line.
2. Memory that *enforces* or *changes* behaviour: contradiction guards, supersede/update chains, typed facts.
3. Receipts: blob IDs, Walruscan links, mainnet blob counts shown in UI or README.
4. Restore-from-Walrus proof (delete local cache, rebuild from Walrus).
5. Honest docs + friction filed as GitHub issues.

## Session 8 neighbours (public repos/posts found)
| Project | What it does | LLM / runtime | Positioning line for us |
|---|---|---|---|
| Recall (ParaDevs) | Group-chat bot logging decisions/commitments; state resolved in code; Walruscan receipts; SQLite cache rebuildable from Walrus | - | Strongest design seen; but "early skeleton" status. Group memory is their lane. |
| Toneme (Omnira Labs) | Live App Store iOS reply coach; remembers who people are to you | gpt-oss-120b | Has real users already - hardest to beat on "real-world use". |
| WalCoach (EdCryptoFi) | Coaching bot, web + Telegram, dual recall (message + core profile) | Qwen 3.8 27B on Groq | Beyond-Big-Two competitor. |
| Walrus Brain (maxence81) | Telegram learning coach, extractor model decides durable facts | Kimi K3 via NVIDIA NIM + GLM | Beyond-Big-Two competitor. |
| WalPen (Olympusxvn) | Journal companion; user *approves* which excerpts become memory | Ollama (local) | Consent-first memory; Beyond-Big-Two. |
| VitaRecall (Tolex081) | Care companion, fictional data pilot | Gemini | Health-adjacent, fictional users (weak on real use). |
| cilokesteh support bot | Support/onboarding bot, memory context boundary vs prompt injection | DeepSeek-V3 / Gemini | Support lane; evidence table of 3 users x 10+ memories. |
| quanghuyaz909 partner bot | Remembers your partner's birthday, likes, promises | Qwen on Groq | Claims 5 real users with 10+ memories each. |
| memorable (Vinayak) | CLI chatbot, per-user namespaces | - | Generic. |
| duchu | "Added long-term memory to my bot" | - | Generic. |

## The gap
Almost every entry is the same loop: recall -> inject -> extract facts -> remember().
Few demo:
- **Correction**: user says "actually I moved / that order was cancelled" and old memory is superseded, not duplicated.
- **Forget / consent**: user asks the bot what it knows and deletes something (WalPen touches this).
- **Cross-user memory that matters**: memory about a shared thing (a shop's orders, a team's decisions) used by several people, not just per-user profiles.
- **A real local audience**: real users in a real setting (Lagos community, a real business), not test accounts.

## Prepared judge questions
- Q: How is this different from the official chatbot example (withMemWal)? A: (fill in phase 3 - must be more than middleware)
- Q: Is the memory decorative? A: show the before/after transcript where the answer changes.
- Q: Are these real users? A: names/handles (with consent), timestamps across days, per-user blob counts.

## Update 2026-10-07 (afternoon)
| Project | What it does | Note |
|---|---|---|
| hippo (UyLeQuoc, Session 2 WINNER of WalForm) | Personal chatbot across web, Telegram, Discord, Slack, CLI; memory lives in the USER's own Walrus Memory account, revocable delegate | Strongest competitor seen. Personal, not community. Raises the bar on evidence and polish |
| WalLearn-bot (opeyemi406) | Telegram study assistant, mistake ledgers, JUDGING.md | Telegram + JUDGING.md pattern; we should also ship a JUDGING.md |
| StackTrace Memory (jeffierw) | DeepSeek debugging bot; HMAC-derived namespaces from invite codes | Same namespace-derivation idea as ours |
| Name check | "SessionDesk": no Walrus/Sui/GitHub project uses it; established studio-furniture brand Sessiondesk exists (sessiondesk.com) | Kept for the hackathon; findability comes from the article title |
