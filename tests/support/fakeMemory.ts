import { refuse, ok, type Result } from "../../src/core/result.js";
import type { MemoryPort, MemoryWrite, NamespaceRecall, StoredMemory } from "../../src/memory/port.js";
import type { ErrorCode } from "../../src/core/errors.js";

export interface FakeMemoryOptions {
  readonly writeDelayMs?: number;
  readonly failWritesBefore?: number;
  readonly writeFailureCode?: ErrorCode;
  readonly recallFailures?: ReadonlySet<string>;
  readonly droppedPerNamespace?: ReadonlyMap<string, number>;
  readonly listFails?: boolean;
}

export class FakeMemory implements MemoryPort {
  readonly stored = new Map<string, { text: string; blobId: string }[]>();
  readonly writeCalls: MemoryWrite[] = [];
  readonly blobsByKey = new Map<string, string>();
  #blobCounter = 0;
  #writeAttempts = 0;
  #options: FakeMemoryOptions;

  constructor(options: FakeMemoryOptions = {}) {
    this.#options = options;
  }

  configure(options: FakeMemoryOptions): void {
    this.#options = options;
  }

  async remember(write: MemoryWrite): Promise<Result<StoredMemory>> {
    this.writeCalls.push(write);
    this.#writeAttempts += 1;
    const delay = this.#options.writeDelayMs ?? 0;
    if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));
    if (this.#writeAttempts <= (this.#options.failWritesBefore ?? 0)) {
      return refuse(this.#options.writeFailureCode ?? "WRITE_FAILED", "fake relayer error");
    }
    const existing = this.blobsByKey.get(write.idempotencyKey);
    if (existing !== undefined) return ok({ blobId: existing, namespace: write.namespace });
    this.#blobCounter += 1;
    const blobId = `blob${this.#blobCounter}`;
    this.blobsByKey.set(write.idempotencyKey, blobId);
    const lines = this.stored.get(write.namespace) ?? [];
    lines.push({ text: write.text, blobId });
    this.stored.set(write.namespace, lines);
    return ok({ blobId, namespace: write.namespace });
  }

  async recallNamespace(namespace: string, limit: number): Promise<Result<NamespaceRecall>> {
    if (this.#options.recallFailures?.has(namespace) === true) return refuse("MEMORY_UNAVAILABLE", "fake recall error");
    const held = [...(this.stored.get(namespace) ?? [])].reverse().slice(0, limit);
    return ok({
      namespace,
      lines: held.map((line) => ({ text: line.text, blobId: line.blobId, createdAt: null })),
      droppedCount: this.#options.droppedPerNamespace?.get(namespace) ?? 0,
      atLimit: held.length >= limit,
    });
  }

  async namespacesWithPrefix(prefix: string): Promise<Result<readonly string[]>> {
    if (this.#options.listFails === true) return refuse("MEMORY_UNAVAILABLE", "fake list error");
    return ok([...this.stored.keys()].filter((namespace) => namespace.startsWith(prefix)));
  }

  seed(namespace: string, texts: readonly string[]): void {
    const lines = this.stored.get(namespace) ?? [];
    for (const text of texts) {
      this.#blobCounter += 1;
      lines.push({ text, blobId: `blob${this.#blobCounter}` });
    }
    this.stored.set(namespace, lines);
  }
}
