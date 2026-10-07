import type { BudgetGovernor } from "../core/budget.js";
import type { ErrorCode } from "../core/errors.js";
import { maskSecrets } from "../core/redactor.js";
import { refuse, ok, type Refusal, type Result } from "../core/result.js";
import { LEDGER_RECALL_QUERY, NAMESPACE_PAGE_LIMIT } from "../core/tuning.js";
import { isRateLimited, relayerStatus, retryAfterMs } from "./relayerError.js";
import type { MemoryPort, MemoryWrite, NamespaceRecall, StoredMemory } from "./port.js";

export interface MemWalLike {
  rememberAndWait(
    text: string,
    namespace?: string,
    opts?: { pollIntervalMs?: number; timeoutMs?: number; idempotencyKey?: string },
  ): Promise<{ blob_id: string; namespace: string }>;
  recall(params: { query: string; limit?: number; namespace?: string; sort?: "relevance" | "recent"; maxDistance?: number }): Promise<{
    results: Array<{ blob_id: string; text: string; created_at?: string; distance?: number }>;
    total: number;
    dropped_count?: number;
  }>;
  listNamespaces(options?: { cursor?: string; limit?: number }): Promise<{
    namespaces: Array<{ name: string }>;
    next_cursor: string | null;
    has_more: boolean;
  }>;
}

export function describeFailure(error: unknown): string {
  const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  return maskSecrets(message).slice(0, 300);
}

function failed(code: ErrorCode, error: unknown): Refusal {
  if (isRateLimited(error)) {
    const wait = retryAfterMs(error);
    const detail = `relayer rate limit (429)${wait === null ? "" : `, retry after ${wait} ms`}: ${describeFailure(error)}`;
    return wait === null ? refuse("BUDGET_EXHAUSTED", detail) : refuse("BUDGET_EXHAUSTED", detail, wait);
  }
  return refuse(code, `status=${relayerStatus(error) ?? "none"} ${describeFailure(error)}`);
}

export class MemwalAdapter implements MemoryPort {
  readonly #client: MemWalLike;
  readonly #budget: BudgetGovernor;

  constructor(client: MemWalLike, budget: BudgetGovernor) {
    this.#client = client;
    this.#budget = budget;
  }

  async remember(write: MemoryWrite, timeoutMs: number): Promise<Result<StoredMemory>> {
    const charged = this.#budget.spend("remember");
    if (!charged.ok) return charged;
    try {
      const stored = await this.#client.rememberAndWait(write.text, write.namespace, {
        timeoutMs,
        idempotencyKey: write.idempotencyKey,
      });
      if (typeof stored.blob_id !== "string" || stored.blob_id.length === 0) {
        return refuse("WRITE_FAILED", "relayer returned no blob id");
      }
      return ok({ blobId: stored.blob_id, namespace: write.namespace });
    } catch (error) {
      return failed("WRITE_FAILED", error);
    }
  }

  async recallNamespace(namespace: string, limit: number): Promise<Result<NamespaceRecall>> {
    const charged = this.#budget.spend("recall");
    if (!charged.ok) return charged;
    try {
      const recalled = await this.#client.recall({ query: LEDGER_RECALL_QUERY, limit, namespace, sort: "recent" });
      const lines = recalled.results.map((result) => ({
        text: result.text,
        blobId: result.blob_id,
        createdAt: result.created_at ?? null,
        distance: result.distance ?? null,
      }));
      return ok({ namespace, lines, droppedCount: recalled.dropped_count ?? 0, atLimit: lines.length >= limit });
    } catch (error) {
      return failed("MEMORY_UNAVAILABLE", error);
    }
  }

  async search(namespace: string, query: string, limit: number, maxDistance: number): Promise<Result<NamespaceRecall>> {
    const charged = this.#budget.spend("recall");
    if (!charged.ok) return charged;
    try {
      const recalled = await this.#client.recall({ query, limit, namespace, maxDistance });
      const lines = recalled.results.map((result) => ({
        text: result.text,
        blobId: result.blob_id,
        createdAt: result.created_at ?? null,
        distance: result.distance ?? null,
      }));
      return ok({ namespace, lines, droppedCount: recalled.dropped_count ?? 0, atLimit: lines.length >= limit });
    } catch (error) {
      return failed("MEMORY_UNAVAILABLE", error);
    }
  }

  async namespacesWithPrefix(prefix: string): Promise<Result<readonly string[]>> {
    const found: string[] = [];
    let cursor: string | undefined;
    try {
      for (;;) {
        const charged = this.#budget.spend("recall");
        if (!charged.ok) return charged;
        const page = await this.#client.listNamespaces(cursor === undefined ? { limit: NAMESPACE_PAGE_LIMIT } : { cursor, limit: NAMESPACE_PAGE_LIMIT });
        for (const namespace of page.namespaces) {
          if (namespace.name.startsWith(prefix)) found.push(namespace.name);
        }
        if (!page.has_more || page.next_cursor === null) return ok(found);
        cursor = page.next_cursor;
      }
    } catch (error) {
      return failed("MEMORY_UNAVAILABLE", error);
    }
  }
}
