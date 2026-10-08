import { z } from "zod";
import { DEFAULT_PORT } from "./core/tuning.js";
import { PLATFORMS, type Platform } from "./platform/platform.js";

const SHARED_KEYS = [
  "MEMWAL_SERVER_URL",
  "MEMWAL_A_ACCOUNT_ID",
  "MEMWAL_A_PRIVATE_KEY",
  "MEMWAL_B_ACCOUNT_ID",
  "MEMWAL_B_PRIVATE_KEY",
  "COMMUNITY_KEY",
  "NAMESPACE_SECRET",
  "GEMINI_API_KEY",
  "GEMINI_MODEL",
  "GEMINI_FALLBACK_MODEL",
  "GROQ_API_KEY",
  "GROQ_MODEL",
  "PORT",
  "TELEGRAM_ENABLED",
  "DISCORD_ENABLED",
  "SLACK_ENABLED",
  "SETUP_CODE",
] as const;

const TELEGRAM_KEYS = ["TELEGRAM_MEMBER_BOT_TOKEN", "TELEGRAM_MANAGER_BOT_TOKEN", "MANAGER_TELEGRAM_IDS", "COMMUNITY_CHAT_ID"] as const;
const DISCORD_KEYS = ["DISCORD_BOT_TOKEN", "DISCORD_CHANNEL_ID", "DISCORD_MANAGER_IDS"] as const;
const SLACK_KEYS = ["SLACK_BOT_TOKEN", "SLACK_APP_TOKEN", "SLACK_CHANNEL_ID", "SLACK_MANAGER_IDS"] as const;

const PLACEHOLDER_SECRET = "generate-with: openssl rand -hex 32";

const accountId = z.string().regex(/^0x[0-9a-fA-F]{40,}$/, "must be a 0x-prefixed hex account id");
const telegramToken = z.string().regex(/^\d{8,12}:[A-Za-z0-9_-]{30,}$/, "must be a Telegram bot token");
const idList = (what: string) =>
  z
    .string()
    .regex(/^[A-Za-z0-9_.-]+(,[A-Za-z0-9_.-]+)*$/, `must be comma-separated ${what} with no spaces`)
    .transform((raw) => raw.split(","));
const flag = (fallback: "true" | "false") =>
  z
    .enum(["true", "false"])
    .default(fallback)
    .transform((raw) => raw === "true");

const SharedSchema = z
  .object({
    MEMWAL_SERVER_URL: z.url(),
    MEMWAL_A_ACCOUNT_ID: accountId,
    MEMWAL_A_PRIVATE_KEY: z.string().min(32),
    MEMWAL_B_ACCOUNT_ID: accountId,
    MEMWAL_B_PRIVATE_KEY: z.string().min(32),
    COMMUNITY_KEY: z.string().regex(/^[a-z0-9]{1,12}$/, "must be 1-12 lowercase letters or digits"),
    NAMESPACE_SECRET: z
      .string()
      .min(32)
      .refine((value) => value !== PLACEHOLDER_SECRET, "must be replaced with a real random secret"),
    GEMINI_API_KEY: z.string().min(10),
    GEMINI_MODEL: z.string().min(1),
    GEMINI_FALLBACK_MODEL: z.string().min(1),
    GROQ_API_KEY: z.string().min(10),
    GROQ_MODEL: z.string().min(1),
    PORT: z.coerce.number().int().min(1).max(65_535).default(DEFAULT_PORT),
    TELEGRAM_ENABLED: flag("true"),
    DISCORD_ENABLED: flag("false"),
    SLACK_ENABLED: flag("false"),
    SETUP_CODE: z.string().min(8).max(64).optional(),
  })
  .strict();

const TelegramSchema = z
  .object({
    TELEGRAM_MEMBER_BOT_TOKEN: telegramToken,
    TELEGRAM_MANAGER_BOT_TOKEN: telegramToken,
    MANAGER_TELEGRAM_IDS: idList("numeric Telegram ids"),
    COMMUNITY_CHAT_ID: z.coerce.number().int(),
  })
  .strict();

const DiscordSchema = z
  .object({
    DISCORD_BOT_TOKEN: z.string().min(40),
    DISCORD_CHANNEL_ID: z.string().regex(/^\d{17,20}$/, "must be a Discord channel id"),
    DISCORD_MANAGER_IDS: idList("Discord user ids"),
  })
  .strict();

const SlackSchema = z
  .object({
    SLACK_BOT_TOKEN: z.string().regex(/^xoxb-/, "must be a Slack bot token starting xoxb-"),
    SLACK_APP_TOKEN: z.string().regex(/^xapp-/, "must be a Slack app-level token starting xapp- for Socket Mode"),
    SLACK_CHANNEL_ID: z.string().regex(/^[CG][A-Z0-9]{6,}$/, "must be a Slack channel id"),
    SLACK_MANAGER_IDS: idList("Slack user ids"),
  })
  .strict();

export interface TelegramSettings {
  readonly memberBotToken: string;
  readonly managerBotToken: string;
  readonly managerIds: readonly string[];
  readonly communityChatId: number;
}

export interface DiscordSettings {
  readonly botToken: string;
  readonly channelId: string;
  readonly managerIds: readonly string[];
}

export interface SlackSettings {
  readonly botToken: string;
  readonly appToken: string;
  readonly channelId: string;
  readonly managerIds: readonly string[];
}

export interface Config {
  readonly memwal: {
    readonly serverUrl: string;
    readonly accountA: { readonly accountId: string; readonly privateKey: string };
    readonly accountB: { readonly accountId: string; readonly privateKey: string };
  };
  readonly community: { readonly key: string; readonly namespaceSecret: string };
  readonly gemini: { readonly apiKey: string; readonly model: string; readonly fallbackModel: string };
  readonly groq: { readonly apiKey: string; readonly model: string };
  readonly port: number;
  readonly setupCode: string | null;
  readonly enabled: Readonly<Record<Platform, boolean>>;
  readonly telegram: TelegramSettings | null;
  readonly discord: DiscordSettings | null;
  readonly slack: SlackSettings | null;
}

export type ConfigLoad = { readonly ok: true; readonly config: Config } | { readonly ok: false; readonly problems: readonly string[] };

function present(env: Readonly<Record<string, string | undefined>>, keys: readonly string[]): Record<string, string> {
  const found: Record<string, string> = {};
  for (const key of keys) {
    const value = env[key];
    if (value !== undefined && value.trim().length > 0) found[key] = value.trim();
  }
  return found;
}

function problemsOf(issues: readonly { path: readonly PropertyKey[]; message: string }[]): readonly string[] {
  return issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`);
}

export function loadConfig(env: Readonly<Record<string, string | undefined>>): ConfigLoad {
  const shared = SharedSchema.safeParse(present(env, SHARED_KEYS));
  if (!shared.success) return { ok: false, problems: problemsOf(shared.error.issues) };
  const base = shared.data;

  const enabled = { telegram: base.TELEGRAM_ENABLED, discord: base.DISCORD_ENABLED, slack: base.SLACK_ENABLED } satisfies Record<Platform, boolean>;
  if (!PLATFORMS.some((platform) => enabled[platform])) {
    return { ok: false, problems: ["platforms: every platform is disabled, so there is nothing to run"] };
  }

  const problems: string[] = [];
  let telegram: TelegramSettings | null = null;
  let discord: DiscordSettings | null = null;
  let slack: SlackSettings | null = null;

  if (enabled.telegram) {
    const parsed = TelegramSchema.safeParse(present(env, TELEGRAM_KEYS));
    if (!parsed.success) problems.push(...problemsOf(parsed.error.issues));
    else {
      telegram = {
        memberBotToken: parsed.data.TELEGRAM_MEMBER_BOT_TOKEN,
        managerBotToken: parsed.data.TELEGRAM_MANAGER_BOT_TOKEN,
        managerIds: parsed.data.MANAGER_TELEGRAM_IDS,
        communityChatId: parsed.data.COMMUNITY_CHAT_ID,
      };
    }
  }
  if (enabled.discord) {
    const parsed = DiscordSchema.safeParse(present(env, DISCORD_KEYS));
    if (!parsed.success) problems.push(...problemsOf(parsed.error.issues));
    else discord = { botToken: parsed.data.DISCORD_BOT_TOKEN, channelId: parsed.data.DISCORD_CHANNEL_ID, managerIds: parsed.data.DISCORD_MANAGER_IDS };
  }
  if (enabled.slack) {
    const parsed = SlackSchema.safeParse(present(env, SLACK_KEYS));
    if (!parsed.success) problems.push(...problemsOf(parsed.error.issues));
    else {
      slack = {
        botToken: parsed.data.SLACK_BOT_TOKEN,
        appToken: parsed.data.SLACK_APP_TOKEN,
        channelId: parsed.data.SLACK_CHANNEL_ID,
        managerIds: parsed.data.SLACK_MANAGER_IDS,
      };
    }
  }
  if (problems.length > 0) return { ok: false, problems };

  return {
    ok: true,
    config: {
      memwal: {
        serverUrl: base.MEMWAL_SERVER_URL,
        accountA: { accountId: base.MEMWAL_A_ACCOUNT_ID, privateKey: base.MEMWAL_A_PRIVATE_KEY },
        accountB: { accountId: base.MEMWAL_B_ACCOUNT_ID, privateKey: base.MEMWAL_B_PRIVATE_KEY },
      },
      community: { key: base.COMMUNITY_KEY, namespaceSecret: base.NAMESPACE_SECRET },
      gemini: { apiKey: base.GEMINI_API_KEY, model: base.GEMINI_MODEL, fallbackModel: base.GEMINI_FALLBACK_MODEL },
      groq: { apiKey: base.GROQ_API_KEY, model: base.GROQ_MODEL },
      port: base.PORT,
      setupCode: base.SETUP_CODE ?? null,
      enabled,
      telegram,
      discord,
      slack,
    },
  };
}

export function shortAccountId(accountId: string): string {
  return accountId.length <= 20 ? accountId : `${accountId.slice(0, 10)}..${accountId.slice(-6)}`;
}

export function enabledPlatforms(config: Config): readonly Platform[] {
  return PLATFORMS.filter((platform) => config.enabled[platform]);
}

export function configSummary(config: Config): Record<string, string | number> {
  return {
    serverUrl: config.memwal.serverUrl,
    accountA: shortAccountId(config.memwal.accountA.accountId),
    accountB: shortAccountId(config.memwal.accountB.accountId),
    communityKey: config.community.key,
    platforms: enabledPlatforms(config).join(",") || "none",
    telegramChatId: config.telegram === null ? "—" : config.telegram.communityChatId,
    telegramManagers: config.telegram === null ? 0 : config.telegram.managerIds.length,
    discordChannel: config.discord === null ? "—" : config.discord.channelId,
    discordManagers: config.discord === null ? 0 : config.discord.managerIds.length,
    slackChannel: config.slack === null ? "—" : config.slack.channelId,
    slackManagers: config.slack === null ? 0 : config.slack.managerIds.length,
    geminiModel: config.gemini.model,
    geminiFallbackModel: config.gemini.fallbackModel,
    groqModel: config.groq.model,
    port: config.port,
  };
}
