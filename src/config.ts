import { z } from "zod";
import { DEFAULT_PORT } from "./core/tuning.js";

const CONFIG_KEYS = [
  "MEMWAL_SERVER_URL",
  "MEMWAL_A_ACCOUNT_ID",
  "MEMWAL_A_PRIVATE_KEY",
  "MEMWAL_B_ACCOUNT_ID",
  "MEMWAL_B_PRIVATE_KEY",
  "TELEGRAM_MEMBER_BOT_TOKEN",
  "TELEGRAM_MANAGER_BOT_TOKEN",
  "MANAGER_TELEGRAM_IDS",
  "COMMUNITY_CHAT_ID",
  "COMMUNITY_KEY",
  "NAMESPACE_SECRET",
  "GEMINI_API_KEY",
  "GEMINI_MODEL",
  "GEMINI_FALLBACK_MODEL",
  "GROQ_API_KEY",
  "GROQ_MODEL",
  "PORT",
] as const;

const PLACEHOLDER_SECRET = "generate-with: openssl rand -hex 32";

const accountId = z.string().regex(/^0x[0-9a-fA-F]{40,}$/, "must be a 0x-prefixed hex account id");
const telegramToken = z.string().regex(/^\d{8,12}:[A-Za-z0-9_-]{30,}$/, "must be a Telegram bot token");

const EnvSchema = z
  .object({
    MEMWAL_SERVER_URL: z.url(),
    MEMWAL_A_ACCOUNT_ID: accountId,
    MEMWAL_A_PRIVATE_KEY: z.string().min(32),
    MEMWAL_B_ACCOUNT_ID: accountId,
    MEMWAL_B_PRIVATE_KEY: z.string().min(32),
    TELEGRAM_MEMBER_BOT_TOKEN: telegramToken,
    TELEGRAM_MANAGER_BOT_TOKEN: telegramToken,
    MANAGER_TELEGRAM_IDS: z
      .string()
      .regex(/^\d+(,\d+)*$/, "must be comma-separated numeric Telegram ids")
      .transform((raw) => raw.split(",").map(Number)),
    COMMUNITY_CHAT_ID: z.coerce.number().int(),
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
  })
  .strict();

export interface Config {
  readonly memwal: {
    readonly serverUrl: string;
    readonly accountA: { readonly accountId: string; readonly privateKey: string };
    readonly accountB: { readonly accountId: string; readonly privateKey: string };
  };
  readonly telegram: {
    readonly memberBotToken: string;
    readonly managerBotToken: string;
    readonly managerIds: readonly number[];
    readonly communityChatId: number;
  };
  readonly community: { readonly key: string; readonly namespaceSecret: string };
  readonly gemini: { readonly apiKey: string; readonly model: string; readonly fallbackModel: string };
  readonly groq: { readonly apiKey: string; readonly model: string };
  readonly port: number;
}

export type ConfigLoad = { readonly ok: true; readonly config: Config } | { readonly ok: false; readonly problems: readonly string[] };

export function loadConfig(env: Readonly<Record<string, string | undefined>>): ConfigLoad {
  const present: Record<string, string> = {};
  for (const key of CONFIG_KEYS) {
    const value = env[key];
    if (value !== undefined && value.trim().length > 0) present[key] = value.trim();
  }
  const parsed = EnvSchema.safeParse(present);
  if (!parsed.success) {
    return { ok: false, problems: parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`) };
  }
  const values = parsed.data;
  return {
    ok: true,
    config: {
      memwal: {
        serverUrl: values.MEMWAL_SERVER_URL,
        accountA: { accountId: values.MEMWAL_A_ACCOUNT_ID, privateKey: values.MEMWAL_A_PRIVATE_KEY },
        accountB: { accountId: values.MEMWAL_B_ACCOUNT_ID, privateKey: values.MEMWAL_B_PRIVATE_KEY },
      },
      telegram: {
        memberBotToken: values.TELEGRAM_MEMBER_BOT_TOKEN,
        managerBotToken: values.TELEGRAM_MANAGER_BOT_TOKEN,
        managerIds: values.MANAGER_TELEGRAM_IDS,
        communityChatId: values.COMMUNITY_CHAT_ID,
      },
      community: { key: values.COMMUNITY_KEY, namespaceSecret: values.NAMESPACE_SECRET },
      gemini: { apiKey: values.GEMINI_API_KEY, model: values.GEMINI_MODEL, fallbackModel: values.GEMINI_FALLBACK_MODEL },
      groq: { apiKey: values.GROQ_API_KEY, model: values.GROQ_MODEL },
      port: values.PORT,
    },
  };
}

export function shortAccountId(accountId: string): string {
  return accountId.length <= 20 ? accountId : `${accountId.slice(0, 10)}..${accountId.slice(-6)}`;
}

export function configSummary(config: Config): Record<string, string | number> {
  return {
    serverUrl: config.memwal.serverUrl,
    accountA: shortAccountId(config.memwal.accountA.accountId),
    accountB: shortAccountId(config.memwal.accountB.accountId),
    communityKey: config.community.key,
    communityChatId: config.telegram.communityChatId,
    managers: config.telegram.managerIds.length,
    geminiModel: config.gemini.model,
    geminiFallbackModel: config.gemini.fallbackModel,
    groqModel: config.groq.model,
    port: config.port,
  };
}
