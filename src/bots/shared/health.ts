import type { ErrorCode } from "../../core/errors.js";
import type { BootReport } from "../../memory/boot.js";

export class MemoryHealth {
  #unavailable = new Set<string>();
  #partial = new Set<string>();
  #bootedAt: string | null = null;

  applyBoot(report: BootReport, at: Date): void {
    this.#unavailable = new Set(report.failures.map((failure) => failure.namespace));
    this.#partial = new Set([...report.partialNamespaces, ...report.atLimitNamespaces]);
    this.#bootedAt = at.toISOString();
  }

  markUnavailable(namespace: string): void {
    this.#unavailable.add(namespace);
  }

  clear(namespace: string): void {
    this.#unavailable.delete(namespace);
    this.#partial.delete(namespace);
  }

  problemFor(namespaces: readonly string[]): ErrorCode | null {
    if (this.#bootedAt === null) return "MEMORY_UNAVAILABLE";
    if (namespaces.some((namespace) => this.#unavailable.has(namespace))) return "MEMORY_UNAVAILABLE";
    if (namespaces.some((namespace) => this.#partial.has(namespace))) return "MEMORY_PARTIAL";
    return null;
  }

  summary(): string {
    return `booted=${this.#bootedAt ?? "no"} unavailable=${this.#unavailable.size} partial=${this.#partial.size}`;
  }
}
