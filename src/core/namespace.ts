import { createHmac } from "node:crypto";
import { userKey, type PlatformId } from "../platform/platform.js";

export const MEMBER_HASH_HEX_CHARS = 24;

export const NAMESPACE_KINDS = ["member", "items", "themes", "notes", "answers", "config", "other"] as const;
export type NamespaceKind = (typeof NAMESPACE_KINDS)[number];

export type NamespaceRef =
  | { readonly kind: "member"; readonly memberH: string }
  | { readonly kind: "items" }
  | { readonly kind: "themes" }
  | { readonly kind: "notes" }
  | { readonly kind: "answers" }
  | { readonly kind: "config" };

export function memberHash(namespaceSecret: string, identity: PlatformId | number): string {
  const material = typeof identity === "number" ? String(identity) : userKey(identity.platform, identity.id);
  return createHmac("sha256", namespaceSecret).update(material).digest("hex").slice(0, MEMBER_HASH_HEX_CHARS);
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

export function namespaceKindOf(namespace: string): NamespaceKind {
  if (namespace.includes("-m-")) return "member";
  for (const kind of ["items", "themes", "notes", "answers", "config"] as const) {
    if (namespace.endsWith(`-${kind}`)) return kind;
  }
  return "other";
}
