import { decode } from "../core/codec.js";
import { memberHashFromNamespace, namespaceKindOf, type NamespaceKind } from "../core/namespace.js";
import type { RecalledLine } from "../memory/port.js";

export const A06_MIN_MEMBERS = 3;
export const A06_MIN_MEMORIES = 10;
export const MEMBER_CODE_CHARS = 8;

export interface NamespaceEvidence {
  readonly namespace: string;
  readonly kind: NamespaceKind;
  readonly memberCode: string | null;
  readonly memories: number;
  readonly undecodable: number;
  readonly activeDays: readonly string[];
  readonly firstSeen: string | null;
  readonly lastSeen: string | null;
  readonly eventTypes: Readonly<Record<string, number>>;
  readonly blobIds: readonly string[];
}

export interface PublicEvidence {
  readonly label: string;
  readonly kind: NamespaceKind;
  readonly memberCode: string | null;
  readonly memories: number;
  readonly undecodable: number;
  readonly activeDays: readonly string[];
  readonly firstSeen: string | null;
  readonly lastSeen: string | null;
  readonly eventTypes: Readonly<Record<string, number>>;
  readonly blobIds: readonly string[];
}

export function labelOf(found: NamespaceEvidence): string {
  return found.memberCode === null ? found.namespace : `member:${found.memberCode}`;
}

export function publicEvidence(found: NamespaceEvidence): PublicEvidence {
  return {
    label: labelOf(found),
    kind: found.kind,
    memberCode: found.memberCode,
    memories: found.memories,
    undecodable: found.undecodable,
    activeDays: found.activeDays,
    firstSeen: found.firstSeen,
    lastSeen: found.lastSeen,
    eventTypes: found.eventTypes,
    blobIds: found.blobIds,
  };
}

export interface MemberEvidence extends NamespaceEvidence {
  readonly memberCode: string;
}

export interface EvidenceSummary {
  readonly members: readonly MemberEvidence[];
  readonly membersWithAnyMemory: number;
  readonly membersMeetingThreshold: number;
  readonly met: boolean;
  readonly distinctDaysAcross: readonly string[];
  readonly blobs: number;
  readonly undecodable: number;
}

export function aggregateNamespace(communityKey: string, namespace: string, lines: readonly RecalledLine[]): NamespaceEvidence {
  const memberH = memberHashFromNamespace(communityKey, namespace);
  const days = new Set<string>();
  const eventTypes: Record<string, number> = {};
  const blobIds: string[] = [];
  let undecodable = 0;
  let firstSeen: string | null = null;
  let lastSeen: string | null = null;

  for (const line of lines) {
    const event = decode(line.text);
    if (event === null) {
      undecodable += 1;
      continue;
    }
    blobIds.push(line.blobId);
    eventTypes[event.type] = (eventTypes[event.type] ?? 0) + 1;
    days.add(event.ts.slice(0, 10));
    if (firstSeen === null || event.ts < firstSeen) firstSeen = event.ts;
    if (lastSeen === null || event.ts > lastSeen) lastSeen = event.ts;
  }

  return {
    namespace,
    kind: namespaceKindOf(namespace),
    memberCode: memberH === null ? null : memberH.slice(0, MEMBER_CODE_CHARS),
    memories: blobIds.length,
    undecodable,
    activeDays: [...days].sort(),
    firstSeen,
    lastSeen,
    eventTypes,
    blobIds,
  };
}

export function summarise(
  namespaces: readonly NamespaceEvidence[],
  minMembers: number = A06_MIN_MEMBERS,
  minMemories: number = A06_MIN_MEMORIES,
): EvidenceSummary {
  const members = namespaces
    .filter((found): found is MemberEvidence => found.memberCode !== null)
    .sort((left, right) => right.memories - left.memories || left.memberCode.localeCompare(right.memberCode));
  const qualifying = members.filter((found) => found.memories >= minMemories);
  return {
    members,
    membersWithAnyMemory: members.filter((found) => found.memories > 0).length,
    membersMeetingThreshold: qualifying.length,
    met: qualifying.length >= minMembers,
    distinctDaysAcross: [...new Set(namespaces.flatMap((found) => [...found.activeDays]))].sort(),
    blobs: namespaces.reduce((total, found) => total + found.blobIds.length, 0),
    undecodable: namespaces.reduce((total, found) => total + found.undecodable, 0),
  };
}
