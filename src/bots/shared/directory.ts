import { onlyMatch } from "../../core/onlyMatch.js";
import type { Match } from "../../core/onlyMatch.js";
import type { Platform } from "../../platform/platform.js";

export interface KnownMember {
  readonly platform: Platform;
  readonly userId: string;
  readonly memberH: string;
  readonly userName: string | null;
  seenAt: string;
}

export class MemberDirectory {
  readonly #byMemberH = new Map<string, KnownMember>();

  remember(member: Omit<KnownMember, "seenAt">, at: Date): void {
    this.#byMemberH.set(member.memberH, { ...member, seenAt: at.toISOString() });
  }

  size(): number {
    return this.#byMemberH.size;
  }

  byMemberH(memberH: string): KnownMember | null {
    return this.#byMemberH.get(memberH) ?? null;
  }

  byUserName(userName: string): Match<KnownMember> {
    const wanted = userName.replace(/^@/, "").toLowerCase();
    return onlyMatch([...this.#byMemberH.values()], (member) => member.userName?.toLowerCase() === wanted);
  }

  byCode(code: string): Match<KnownMember> {
    const wanted = code.toLowerCase();
    return onlyMatch([...this.#byMemberH.values()], (member) => member.memberH.startsWith(wanted));
  }

  label(memberH: string): string {
    const known = this.#byMemberH.get(memberH);
    if (known === null || known === undefined) return shortCode(memberH);
    return known.userName === null ? shortCode(memberH) : `@${known.userName} (${shortCode(memberH)})`;
  }
}

export function shortCode(memberH: string): string {
  return memberH.slice(0, 8);
}
