import { createInterface } from "node:readline/promises";
import { existsSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { MemWal } from "@mysten-incubation/memwal";
import { SETUP_CODE_CHARS } from "../src/core/governance.js";

const rl = createInterface({ input: process.stdin, output: process.stdout });
const answers = new Map<string, string>();

function say(text: string): void {
  console.log(text);
}

async function ask(question: string, where: string): Promise<string> {
  say("");
  say(question);
  say(`  Where to get it: ${where}`);
  const given = await rl.question("  > ");
  return given.trim();
}

async function askUntilValid(key: string, question: string, where: string, check: (value: string) => Promise<string | null>): Promise<void> {
  for (;;) {
    const value = await ask(question, where);
    if (value.length === 0) {
      say("  That cannot be empty.");
      continue;
    }
    say("  Checking it...");
    const problem = await check(value);
    if (problem === null) {
      say("  Looks good.");
      answers.set(key, value);
      return;
    }
    say(`  That did not work: ${problem}`);
  }
}

async function checkTelegramBot(token: string, needsPrivacyOff: boolean): Promise<string | null> {
  try {
    const response = await fetch(`https://api.telegram.org/bot${token}/getMe`);
    const payload = (await response.json()) as { ok?: boolean; description?: string; result?: { username?: string; can_read_all_group_messages?: boolean } };
    if (payload.ok !== true) return `Telegram said: ${payload.description ?? "the token was rejected"}. Check you copied the whole token from @BotFather.`;
    const bot = payload.result ?? {};
    if (needsPrivacyOff && bot.can_read_all_group_messages !== true) {
      return `@${bot.username ?? "the bot"} still has privacy mode on, so it cannot read group messages. In @BotFather send /setprivacy, pick this bot, choose Disable, then try again.`;
    }
    say(`  Found @${bot.username ?? "the bot"}.`);
    return null;
  } catch (error) {
    return `could not reach Telegram (${error instanceof Error ? error.message : String(error)}). Check your internet connection.`;
  }
}

async function checkWalrusAccount(serverUrl: string, accountId: string, key: string, label: string): Promise<string | null> {
  try {
    const client = MemWal.create({ key, accountId, serverUrl });
    const health = await client.health();
    if (health.status !== "ok") return `the Walrus relayer reports status ${health.status}. Try again in a minute.`;
    await client.recall({ query: "setup check", limit: 1, namespace: `sd-setup-check-${label}` });
    return null;
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    if (detail.includes("401") || detail.toLowerCase().includes("unauthor")) {
      return "Walrus rejected that key for that account id. Check the delegate key belongs to this account on the memory.walrus.xyz dashboard.";
    }
    return `Walrus would not answer (${detail}).`;
  }
}

async function checkGemini(apiKey: string, model: string): Promise<string | null> {
  try {
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": apiKey },
      body: JSON.stringify({ contents: [{ parts: [{ text: "Reply with the single word: ready" }] }] }),
    });
    if (response.status === 503) return "Gemini is overloaded right now, which is normal. The key itself may be fine; press enter to retry, or paste it again.";
    if (!response.ok) return `Google said HTTP ${response.status}. Check the key at aistudio.google.com/apikey.`;
    return null;
  } catch (error) {
    return `could not reach Google (${error instanceof Error ? error.message : String(error)}).`;
  }
}

async function checkGroq(apiKey: string, model: string): Promise<string | null> {
  try {
    const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ model, messages: [{ role: "user", content: "Reply with the single word: ready" }], max_tokens: 5, reasoning_effort: "none" }),
    });
    if (!response.ok) return `Groq said HTTP ${response.status}. Check the key at console.groq.com/keys and that the model name is right.`;
    return null;
  } catch (error) {
    return `could not reach Groq (${error instanceof Error ? error.message : String(error)}).`;
  }
}

say("SessionDesk setup");
say("I will ask for each thing you need, check it works as you paste it, and write a .env file.");
say("I never print a secret back to you.");

if (existsSync(".env")) {
  say("");
  say("There is already a .env file here. Overwriting it would lose the settings you are running on.");
  const confirmed = await rl.question("  Type overwrite to replace it, or anything else to stop: ");
  if (confirmed.trim() !== "overwrite") {
    say("Stopped. Nothing was changed.");
    rl.close();
    process.exit(0);
  }
}

answers.set("MEMWAL_SERVER_URL", "https://relayer.memory.walrus.xyz");
answers.set("GEMINI_MODEL", "gemini-3.8-flash");
answers.set("GEMINI_FALLBACK_MODEL", "gemini-3.5-flash");
answers.set("GROQ_MODEL", "qwen/qwen3.8-27b");
answers.set("TELEGRAM_ENABLED", "true");
answers.set("DISCORD_ENABLED", "false");
answers.set("SLACK_ENABLED", "false");

await askUntilValid(
  "COMMUNITY_KEY",
  "A short name for your community, lower case letters and digits only, up to 12 characters. It becomes part of where your memory is filed and must never change afterwards.",
  "you choose this, for example bmaxis",
  async (value) => (/^[a-z0-9]{1,12}$/.test(value) ? null : "use only lower case letters and digits, up to 12 characters."),
);

await askUntilValid(
  "TELEGRAM_MEMBER_BOT_TOKEN",
  "The token for the bot your members will talk to.",
  "open Telegram, message @BotFather, send /newbot, then copy the token. After that send /setprivacy, pick this bot, and choose Disable.",
  async (value) => checkTelegramBot(value, true),
);

await askUntilValid(
  "TELEGRAM_MANAGER_BOT_TOKEN",
  "The token for a second bot, which only you and your managers will use.",
  "@BotFather again, /newbot, a different name. Privacy mode does not matter for this one.",
  async (value) => checkTelegramBot(value, false),
);

await askUntilValid(
  "MEMWAL_A_ACCOUNT_ID",
  "The account id for your community memory.",
  "the dashboard at memory.walrus.xyz, under your account. It starts 0x.",
  async (value) => (/^0x[0-9a-fA-F]{40,}$/.test(value) ? null : "that does not look like an account id. It starts 0x and is long."),
);

await askUntilValid(
  "MEMWAL_A_PRIVATE_KEY",
  "The delegate key for that same account.",
  "the same dashboard, under delegate keys. Treat it like a password.",
  async (value) => checkWalrusAccount(answers.get("MEMWAL_SERVER_URL") ?? "", answers.get("MEMWAL_A_ACCOUNT_ID") ?? "", value, "a"),
);

await askUntilValid(
  "MEMWAL_B_ACCOUNT_ID",
  "A SECOND account id, used only for manager-only notes. Keeping notes on a separate account is what stops the member bot being able to read them.",
  "the same dashboard: create a second account.",
  async (value) => (/^0x[0-9a-fA-F]{40,}$/.test(value) ? null : "that does not look like an account id."),
);

await askUntilValid(
  "MEMWAL_B_PRIVATE_KEY",
  "The delegate key for that second account.",
  "the same dashboard, under delegate keys for the second account.",
  async (value) => checkWalrusAccount(answers.get("MEMWAL_SERVER_URL") ?? "", answers.get("MEMWAL_B_ACCOUNT_ID") ?? "", value, "b"),
);

await askUntilValid(
  "GEMINI_API_KEY",
  "A Gemini API key, used to read what members write and to draft replies.",
  "aistudio.google.com/apikey, then Create API key. The free tier is enough to start.",
  async (value) => checkGemini(value, answers.get("GEMINI_MODEL") ?? ""),
);

await askUntilValid(
  "GROQ_API_KEY",
  "A Groq API key, used for the manager side and as a backup when Gemini is busy.",
  "console.groq.com/keys, then Create API Key.",
  async (value) => checkGroq(value, answers.get("GROQ_MODEL") ?? ""),
);

const namespaceSecret = randomBytes(32).toString("hex");
const setupCode = randomBytes(6).toString("base64url").slice(0, SETUP_CODE_CHARS);
answers.set("NAMESPACE_SECRET", namespaceSecret);
answers.set("SETUP_CODE", setupCode);
answers.set("PORT", "3000");

const order = [
  "MEMWAL_SERVER_URL",
  "MEMWAL_A_ACCOUNT_ID",
  "MEMWAL_A_PRIVATE_KEY",
  "MEMWAL_B_ACCOUNT_ID",
  "MEMWAL_B_PRIVATE_KEY",
  "COMMUNITY_KEY",
  "NAMESPACE_SECRET",
  "SETUP_CODE",
  "GEMINI_API_KEY",
  "GEMINI_MODEL",
  "GEMINI_FALLBACK_MODEL",
  "GROQ_API_KEY",
  "GROQ_MODEL",
  "TELEGRAM_ENABLED",
  "TELEGRAM_MEMBER_BOT_TOKEN",
  "TELEGRAM_MANAGER_BOT_TOKEN",
  "DISCORD_ENABLED",
  "SLACK_ENABLED",
  "PORT",
];
writeFileSync(".env", `${order.map((key) => `${key}=${answers.get(key) ?? ""}`).join("\n")}\n`, { mode: 0o600 });

say("");
say("Written .env, readable only by you. I generated two secrets you never have to see again:");
say("  NAMESPACE_SECRET - the key that files each member's memory. Never change it once members join.");
say("  SETUP_CODE       - how you claim ownership. It is below, once.");
say("");
say(`    YOUR SETUP CODE: ${setupCode}`);
say("");
say("Next steps:");
say("  1. Start it: npm run dev   (or deploy it, see the README)");
say(`  2. Message your MANAGER bot and send: /claim ${setupCode}`);
say("  3. Add your MEMBER bot to your group, and make it an admin so it can pin.");
say("  4. In that group send: /setup");
say("  5. Then send: /optin   and I will post the notice people tap to join.");
say("");
say("If you lose the setup code, delete SETUP_CODE from .env and restart: a new one is printed once at startup.");
rl.close();
