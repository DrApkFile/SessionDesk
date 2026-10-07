# Reality spike: community memory bots

Proves every critical-path assumption against the LIVE systems before we build.
Costs roughly 45 Walrus Memory rate points (well under the 500/hour budget).

## What you need first
1. Two Sui wallets (A and B). For EACH: open https://memory.walrus.xyz, connect, create the
   account, create a delegate key. Copy account ID + delegate private key (shown once).
   A = member-side memory. B = manager-only notes.
2. Two bots from @BotFather on Telegram (member bot, manager bot). Copy both tokens.
3. Groq API key + Gemini API key, and the exact current model id for each from their consoles.

## Run
    npm ci
    cp .env.example .env   # fill in values; never commit .env
    npm run spike

Paste the console output (or spike-results.json) back into the chat. It contains no secrets.

## What each spike proves
| ID | Claim |
|---|---|
| S1 | Relayer healthy; versions recorded |
| S2a/b | Both delegate keys work on mainnet |
| S3 | Writes return blob receipts; write latency |
| S4 | Whether idempotencyKey dedupes a completed write (decides if we dedupe ourselves) |
| S5 | A recall with limit 100 returns a member's WHOLE ledger, even for an unrelated query |
| S6 | sort:"recent" returns the newest event |
| S7 | Recall latency |
| S8 | Account A cannot read account B's manager notes (the fog-of-war boundary) |
| S9 | restore() works on our namespace |
| S10 | Both Telegram tokens valid |
| S11/12 | Groq and Gemini reply and can return JSON |
