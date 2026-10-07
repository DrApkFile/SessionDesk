import type { Result } from "../core/result.js";

export interface MemoryWrite {
  readonly namespace: string;
  readonly text: string;
  readonly idempotencyKey: string;
}

export interface StoredMemory {
  readonly blobId: string;
  readonly namespace: string;
}

export interface RecalledLine {
  readonly text: string;
  readonly blobId: string;
  readonly createdAt: string | null;
}

export interface NamespaceRecall {
  readonly namespace: string;
  readonly lines: readonly RecalledLine[];
  readonly droppedCount: number;
  readonly atLimit: boolean;
}

export interface MemoryPort {
  remember(write: MemoryWrite, timeoutMs: number): Promise<Result<StoredMemory>>;
  recallNamespace(namespace: string, limit: number): Promise<Result<NamespaceRecall>>;
  namespacesWithPrefix(prefix: string): Promise<Result<readonly string[]>>;
}
