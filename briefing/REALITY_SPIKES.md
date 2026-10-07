# REALITY_SPIKES

Researched: 2026-10-07. Script: spike/spike.ts. Live results: pending (user runs with real creds).

## Static spikes (done here, from the installed package @mysten-incubation/memwal@0.1.8)
| # | Claim (docs) | Spike | Result | Decision |
|---|---|---|---|---|
| P1 | Default client needs only the SDK | read dist/memwal.js | WRONG: recall dynamically imports @mysten/seal and @mysten/sui (issue #993 still true in 0.1.8) | Pin @mysten/seal 1.4.19 + @mysten/sui 2.35.0. Friction note #1 for feedback form |
| P2 | remember has no dedupe | read types | PARTIAL: rememberAndWait accepts `idempotencyKey`; SDK comment says it collapses retries after a transport timeout. Dedupe of COMPLETED writes unknown | Live spike S4 |
| P3 | Recall has no recency info | read types | WRONG (improved): RecallMemory has `created_at`; `sort: "recent"` exists | Use our own `seq` as primary order, created_at as tie-break |
| P4 | Empty recall indistinguishable from failures (#1036) | read types | IMPROVED: RecallResult has `dropped_count` | Treat dropped_count > 0 as "partial", show it, never as "no memory" |
| P5 | Request timeout | read types | `requestTimeoutMs` config, default 30 s | Keep default; recall budget handled by our UI |

## Live spikes (run 05bb7bbb, 2026-10-07T12:23Z, SDK 0.1.8, relayer 0.1.0 / api 1.0.0, user's Linux machine)
| # | Claim | Result | Decision |
|---|---|---|---|
| S1 | Relayer healthy | CONFIRMED status=ok, BUT write_ready=false while writes succeeded (S3) | Never gate writes on write_ready. Candidate bug report: health field disagrees with reality |
| S2a/b | Both keys auth on mainnet | CONFIRMED (first call 9.0 s cold, then 1.6 s) | Warm up with one recall at boot |
| S3 | Writes return blob_ids | CONFIRMED, but 30.0 / 33.0 / 37.8 s per write | Never await writes in the reply path. Background write queue; /mydata shows "saving" until blob_id arrives |
| S4 | idempotencyKey dedupes a completed write | CONFIRMED (same blob_id back, 2.3 s) | Deterministic idempotency key per event (community + seq + type). Retries are safe |
| S5 | limit-100 recall returns whole small namespace | CONFIRMED 3/3, also for an unrelated query, created_at on all, dropped=0 | Ledger read design holds. Tested at 3 entries only: warn when results == limit |
| S6 | sort recent returns newest | CONFIRMED (seq=3) | Use for "latest status" lookups; seq still decides conflicts |
| S7 | Recall latency | CONFIRMED median 1.7 s (2.5 / 1.7 / 1.7) | Far better than the guide's 8.6 s. Recall per message is affordable |
| S8 | A cannot read B's notes | CONFIRMED (B sees 1, A sees 0) | Fog-of-war claim stands: manager notes on account B |
| S9 | restore works | CONFIRMED (skipped 3, failed 0, truncated false). owner = wallet address 0xa9d3..., not the account ID | Restore test is viable |
| S10a/b | Telegram tokens | CONFIRMED @sdmemberbot, @sdmanagerkingghidorahbot | — |
| S11 | Groq qwen/qwen3.8-27b JSON | CONFIRMED in 5.9 s (reasoning_effort none) | Manager bot model fixed |
| S12 | Gemini gemini-3.8-flash JSON | WRONG: HTTP 503 "high demand" (model exists; capacity issue, not key/model) | Retry with backoff; GEMINI_FALLBACK_MODEL=gemini-3.5-flash; re-run S12 before build |

## Not yet tested
- Concurrent writes (can several rememberAndWait calls run at once without errors or rate limits?)
- recall at >100 entries per namespace
- Gemini fallback model
