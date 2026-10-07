# EVENT: Walrus Sessions 8 - Chatbots That Remember

Researched: 2026-10-07
Sources (fetched): https://thewalrussessions.wal.app/chatbots/index.html (official rules),
https://thewalrussessions.wal.app/index.html, user-pasted brief (SuiHub Lagos Notion version)

## At a glance
| Item | Detail |
|---|---|
| Build window | 2026-09-18 09:00 UTC -> 2026-10-09 14:00 UTC |
| Deadline (exact) | **2026-10-09 14:00 UTC = 15:00 WAT (Lagos)** |
| Results | 2026-10-16 |
| Pool | $2,500 (official rules: paid in WAL; pasted brief says "stablecoin" - see open Qs) |
| Registration | DeepSurge platform (mandatory) + Airtable form (once) |
| Organiser | Walrus Foundation; judged by panel it appoints |

## Prize tracks
| Track | Prizes | Stackable? |
|---|---|---|
| Best Chatbot | $500 / $250 / $150 | yes |
| Beyond the Big Two (primary LLM not Anthropic/OpenAI) | 2 x $150 | yes, with Best Chatbot |
| Best Article | 3 x $100 | judged on clarity, honesty, usefulness to a newcomer |
| Bug Bounty (GitHub issues on MystenLabs/MemWal, during window) | 5 x $100 | chosen separately by eng team |
| Promo (post outside Walrus/Sui ecosystem; X & r/sui excluded) | 5 x $100 | link goes in main form |

One strong submission can realistically hit: Best Chatbot + Beyond Big Two + Best Article + Bug Bounty + Promo.

## Scoring (no point weights published)
| Criterion | Full marks looks like | Our planned proof |
|---|---|---|
| 1. Does it actually remember? | Memory changes the answer at the right moment; not decorative | Side-by-side: same question, memory off vs on; a recall that mattered |
| 2. Real-world use | Real people, deployed, before/after convincing | >=3 named real users, screenshots/logs across days, blob IDs |
| 3. Build quality | Clean, documented, clone-and-run | README tested from clean clone, .env.example, tests |
| 4. Article | Newcomer can follow it and wants to build one | 500-800 words, own story, what broke, real convo |

Heaviest (judgment): #1 and #2 - the brief repeats "real use" and "memory doing real work" most.
Fatal gates: not on mainnet; <10 blobs; no deployed reachable channel; no public repo; no article.

## Eligibility gates (acceptance IDs)
| ID | Requirement | How we verify | Evidence file |
|---|---|---|---|
| A01 | Registered on DeepSurge (name, description, contact, GitHub) | screenshot | evidence/A01-deepsurge.png |
| A02 | Working chatbot integrating Walrus Memory store + recall across conversations | e2e test: fresh process recalls prior-session fact | evidence/A02-fresh-recall.log |
| A03 | Deployed, reachable by real users via >=1 channel | public link/bot handle | evidence/A03-channel.md |
| A04 | All memory stored on Walrus **Mainnet** | relayer URL check at startup; blob IDs on explorer | evidence/A04-mainnet.md |
| A05 | Agent wrote >=10 blobs on mainnet; agent ID + blob count in form | script counting blobs | evidence/A05-blobcount.json |
| A06 | >=3 different users, >=10 memories each (pasted brief) | per-namespace count script | evidence/A06-users.json |
| A07 | Public GitHub repo, open source, setup instructions | clean-clone run | evidence/A07-clean-clone.log |
| A08 | LLM + runtime stated | README + form | - |
| A09 | Dedicated Sessions wallet address | form | - |
| A10 | Article on Medium or Inkray: what/who/problem, integration, before/after, real-use evidence | checklist | article link |
| A11 | Article shared on X, tag @WalrusProtocol, under session announcement, #WalrusMemory | link | - |
| A12 | Feedback form: >=1 bug/friction + >=1 improvement idea (+ GitHub issues) | links | - |
| A13 | Joined Walrus Discord | - | - |
| A14 | (Beyond Big Two) model + runtime stated in article + integration friction documented | article section | - |
| A15 | (Promo) post in non-Walrus/Sui community, public at judging | link | - |

## Submission fields -> where our answer lives
LLM/runtime -> README "Stack"; GitHub repo -> repo URL; bug/friction/improvement -> FEEDBACK.md + issue links;
article link -> Medium/Inkray; X post link; agent ID + blob count -> evidence/A05; wallet; promo link.

## What judges read, likely order
Form -> article -> live link / screenshots -> repo README -> code. The article is "the heart".

## Rules on commits / prior work
- Existing bot may be retrofitted (allowed). One submission per person/team.
- No stated rule on commits after deadline: assume freeze at 14:00 UTC Oct 9.

## Past winners and calibration
See LANDSCAPE.md.

## Open questions for organisers (ask in Discord, record answers here)
1. Prizes: official page says WAL; SuiHub Lagos brief says stablecoin. Which applies to us?
2. Is the SuiHub Lagos edition the same pool/judging as the global Session 8, or separate?
3. "Used for a few days" - is a ~2-day window acceptable if evidence is real?
4. Official page lists the promo-only form with the same formId as the bug-bounty form
   (0x38a7...); pasted brief gives 0x09b0... for promo. Which is correct?
5. Does "10 blobs" mean per agent/account total, and does the 3 users x 10 memories rule
   (pasted brief only; not on official page) apply?
