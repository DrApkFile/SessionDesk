import { refuse, ok, type Result } from "./result.js";

export const SECRET_KINDS = [
  "email",
  "hex_secret",
  "sui_private_key",
  "google_api_key",
  "groq_api_key",
  "openai_api_key",
  "telegram_bot_token",
  "jwt",
  "phone_international",
  "phone_local",
] as const;

export type SecretKind = (typeof SECRET_KINDS)[number];

export const SPECIFICITIES = ["high", "low"] as const;
export type Specificity = (typeof SPECIFICITIES)[number];

export interface SecretPattern {
  readonly source: string;
  readonly specificity: Specificity;
}

export const SECRET_PATTERNS = {
  hex_secret: { source: "(?:0x)?[0-9a-fA-F]{64,}", specificity: "high" },
  sui_private_key: { source: "suiprivkey1[a-z0-9]{40,}", specificity: "high" },
  google_api_key: { source: "AIza[0-9A-Za-z_-]{30,}", specificity: "high" },
  groq_api_key: { source: "gsk_[A-Za-z0-9]{20,}", specificity: "high" },
  openai_api_key: { source: "sk-[A-Za-z0-9_-]{20,}", specificity: "high" },
  telegram_bot_token: { source: "\\d{8,12}:[A-Za-z0-9_-]{30,}", specificity: "high" },
  jwt: { source: "eyJ[A-Za-z0-9_-]{8,}\\.[A-Za-z0-9_-]{8,}\\.[A-Za-z0-9_-]{8,}", specificity: "high" },
  email: { source: "[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+\\.[A-Za-z]{2,}", specificity: "low" },
  phone_international: { source: "\\+\\d[\\d\\s().-]{7,}\\d", specificity: "low" },
  phone_local: { source: "\\b0\\d{9,13}\\b", specificity: "low" },
} satisfies Record<SecretKind, SecretPattern>;

export function kindsBySpecificity(specificity: Specificity): readonly SecretKind[] {
  return SECRET_KINDS.filter((kind) => SECRET_PATTERNS[kind].specificity === specificity);
}

function matcher(kind: SecretKind, global: boolean): RegExp {
  return new RegExp(SECRET_PATTERNS[kind].source, global ? "g" : "");
}

export function findSecrets(text: string): readonly SecretKind[] {
  return SECRET_KINDS.filter((kind) => matcher(kind, false).test(text));
}

export function maskSecrets(text: string): string {
  let masked = text;
  for (const kind of SECRET_KINDS) {
    masked = masked.replace(matcher(kind, true), `[redacted:${kind}]`);
  }
  return masked;
}

export function guardStoredText(text: string): Result<string> {
  const found = findSecrets(text);
  if (found.length > 0) return refuse("SECRET_BLOCKED", found.join(","));
  return ok(text);
}
