import { decode } from "../core/codec.js";
import type { ErrorCode } from "../core/errors.js";
import { memberHashFromNamespace } from "../core/namespace.js";
import { ok, type Result } from "../core/result.js";
import { seqAfterBoot } from "../core/seq.js";
import { RECALL_LIMIT } from "../core/tuning.js";
import { LedgerCache, type StoredLine } from "./cache.js";
import type { MemoryPort } from "./port.js";

export interface NamespaceFailure {
  readonly namespace: string;
  readonly code: ErrorCode;
}

export interface BootReport {
  readonly namespaces: number;
  readonly linesRead: number;
  readonly decoded: number;
  readonly undecodable: number;
  readonly dropped: number;
  readonly partialNamespaces: readonly string[];
  readonly atLimitNamespaces: readonly string[];
  readonly failures: readonly NamespaceFailure[];
  readonly maxSeq: number;
  readonly nextSeq: number;
  readonly complete: boolean;
}

export async function rebuildFromWalrus(
  memory: MemoryPort,
  communityKey: string,
  cache: LedgerCache,
  limit: number = RECALL_LIMIT,
): Promise<Result<BootReport>> {
  const prefix = `sd-${communityKey}-`;
  const listed = await memory.namespacesWithPrefix(prefix);
  if (!listed.ok) return listed;

  const lines: StoredLine[] = [];
  const partialNamespaces: string[] = [];
  const atLimitNamespaces: string[] = [];
  const failures: NamespaceFailure[] = [];
  let linesRead = 0;
  let undecodable = 0;
  let dropped = 0;

  for (const namespace of listed.value) {
    const recalled = await memory.recallNamespace(namespace, limit);
    if (!recalled.ok) {
      failures.push({ namespace, code: recalled.code });
      continue;
    }
    const memberH = memberHashFromNamespace(communityKey, namespace);
    dropped += recalled.value.droppedCount;
    if (recalled.value.droppedCount > 0) partialNamespaces.push(namespace);
    if (recalled.value.atLimit) atLimitNamespaces.push(namespace);
    for (const line of recalled.value.lines) {
      linesRead += 1;
      const event = decode(line.text);
      if (event === null) {
        undecodable += 1;
        continue;
      }
      lines.push({ seq: event.seq, namespace, memberH, event, state: "saved", blobId: line.blobId, code: null });
    }
  }

  cache.replaceAll(lines);
  const maxSeq = cache.state().maxSeq;
  return ok({
    namespaces: listed.value.length,
    linesRead,
    decoded: lines.length,
    undecodable,
    dropped,
    partialNamespaces,
    atLimitNamespaces,
    failures,
    maxSeq,
    nextSeq: seqAfterBoot(maxSeq),
    complete: failures.length === 0 && partialNamespaces.length === 0 && atLimitNamespaces.length === 0 && undecodable === 0,
  });
}

export function bootProblem(report: BootReport): ErrorCode | null {
  if (report.failures.length > 0) return "MEMORY_UNAVAILABLE";
  if (report.partialNamespaces.length > 0 || report.atLimitNamespaces.length > 0 || report.undecodable > 0) return "MEMORY_PARTIAL";
  return null;
}

export function describeBoot(report: BootReport): string {
  return [
    `namespaces=${report.namespaces}`,
    `lines=${report.linesRead}`,
    `decoded=${report.decoded}`,
    `undecodable=${report.undecodable}`,
    `dropped=${report.dropped}`,
    `partial=${report.partialNamespaces.length}`,
    `atLimit=${report.atLimitNamespaces.length}`,
    `failed=${report.failures.length}`,
    `maxSeq=${report.maxSeq}`,
    `nextSeq=${report.nextSeq}`,
  ].join(" ");
}
