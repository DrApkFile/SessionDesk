import type { Result } from "../core/result.js";
import type { MemoryPort, MemoryWrite, NamespaceRecall, StoredMemory } from "./port.js";

export class NamespaceRouter implements MemoryPort {
  readonly #community: MemoryPort;
  readonly #separate: ReadonlyMap<string, MemoryPort>;

  constructor(community: MemoryPort, separate: ReadonlyMap<string, MemoryPort>) {
    this.#community = community;
    this.#separate = separate;
  }

  portFor(namespace: string): MemoryPort {
    return this.#separate.get(namespace) ?? this.#community;
  }

  async remember(write: MemoryWrite, timeoutMs: number): Promise<Result<StoredMemory>> {
    return this.portFor(write.namespace).remember(write, timeoutMs);
  }

  async recallNamespace(namespace: string, limit: number): Promise<Result<NamespaceRecall>> {
    return this.portFor(namespace).recallNamespace(namespace, limit);
  }

  async search(namespace: string, query: string, limit: number, maxDistance: number): Promise<Result<NamespaceRecall>> {
    return this.portFor(namespace).search(namespace, query, limit, maxDistance);
  }

  async namespacesWithPrefix(prefix: string): Promise<Result<readonly string[]>> {
    return this.#community.namespacesWithPrefix(prefix);
  }
}
