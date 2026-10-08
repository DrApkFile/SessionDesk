# Every setting, in plain language

Render prompts for everything marked **you provide** when you click Deploy. Everything marked
**generated** is created for you and you never need to see it. Everything else already has a
sensible value.

| Setting | What it is | Where it comes from |
|---|---|---|
| `COMMUNITY_KEY` | A short name for your community, lower case letters and digits, up to 12. It becomes part of where your memory is filed. **Never change it after members join.** | you provide |
| `NAMESPACE_SECRET` | The key that turns a person's account id into the private name their memory is filed under. **Never change it after members join**, or every memory already written becomes unreachable. | generated |
| `SETUP_CODE` | A one-time code. Whoever sends `/claim <code>` to the manager bot first becomes the owner. | generated |
| `MEMWAL_A_ACCOUNT_ID`, `MEMWAL_A_PRIVATE_KEY` | Your Walrus Memory account for community memory, from the dashboard at memory.walrus.xyz. | you provide |
| `MEMWAL_B_ACCOUNT_ID`, `MEMWAL_B_PRIVATE_KEY` | A **second** Walrus account, used only for manager-only notes. Having a separate account is what makes it impossible for the member bot to read them. | you provide |
| `TELEGRAM_MEMBER_BOT_TOKEN` | The bot your members talk to. Privacy mode must be **disabled** in @BotFather or it cannot read group messages. | you provide |
| `TELEGRAM_MANAGER_BOT_TOKEN` | A second bot, for you and your managers only. | you provide |
| `GEMINI_API_KEY` | Reads what members write and drafts replies. Free tier is enough to start. | you provide, from aistudio.google.com/apikey |
| `GROQ_API_KEY` | Powers the manager side, and is the backup when Gemini is busy. | you provide, from console.groq.com/keys |
| `MEMWAL_SERVER_URL` | The Walrus Memory relayer. | already set |
| `GEMINI_MODEL`, `GEMINI_FALLBACK_MODEL`, `GROQ_MODEL` | Which models to use. | already set |
| `TELEGRAM_ENABLED` | Whether to run on Telegram. | already set to true |
| `DISCORD_ENABLED`, `DISCORD_BOT_TOKEN`, `DISCORD_CHANNEL_ID`, `DISCORD_MANAGER_IDS` | Turn on Discord and tell it which channel to serve. Only needed if `DISCORD_ENABLED=true`. | already set to false |
| `SLACK_ENABLED`, `SLACK_BOT_TOKEN`, `SLACK_APP_TOKEN`, `SLACK_CHANNEL_ID`, `SLACK_MANAGER_IDS` | Turn on Slack in Socket Mode. Only needed if `SLACK_ENABLED=true`. | already set to false |
| `MANAGER_TELEGRAM_IDS`, `COMMUNITY_CHAT_ID` | The older way to name your managers and your group, by id. **Optional now** — `/claim` and `/setup` do the same thing without ids. If you do set them, they win over anything `/setup` records. | optional |
| `PORT` | Set by the host. Defaults to 3000 locally. | already handled |
