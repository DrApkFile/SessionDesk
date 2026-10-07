import { createHmac } from "node:crypto";

export const MEMBER_HASH_HEX_CHARS = 24;

export type NamespaceRef =
  | { readonly kind: "member"; readonly memberH: string }
  | { readonly kind: "items" }
  | { readonly kind: "themes" }
  | { readonly kind: "notes" };

export function memberHash(namespaceSecret: string, telegramUserId: number): string {
  return createHmac("sha256", namespaceSecret).update(String(telegramUserId)).digest("hex").slice(0, MEMBER_HASH_HEX_CHARS);
}

export function resolveNamespace(communityKey: string, ref: NamespaceRef): string {
  if (ref.kind === "member") return `sd-${communityKey}-m-${ref.memberH}`;
  return `sd-${communityKey}-${ref.kind}`;
}

export function isMemberNamespace(communityKey: string, namespace: string): boolean {
  return namespace.startsWith(`sd-${communityKey}-m-`);
}

export function memberHashFromNamespace(communityKey: string, namespace: string): string | null {
  const prefix = `sd-${communityKey}-m-`;
  if (!namespace.startsWith(prefix)) return null;
  const rest = namespace.slice(prefix.length);
  return /^[0-9a-f]{24}$/.test(rest) ? rest : null;
}
