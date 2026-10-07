import type { NamespaceKind } from "../core/namespace.js";
import type { WriteCounts } from "../memory/writeQueue.js";
import type { PollingState } from "../bots/shared/polling.js";

export interface BotHealth {
  readonly name: string;
  readonly polling: boolean;
  readonly state: PollingState;
  readonly conflicts: number;
  readonly pollingSince: string | null;
}

export interface LastWrite {
  readonly at: string;
  readonly state: "saved" | "failed";
  readonly namespaceKind: NamespaceKind;
  readonly code: string | null;
}

export interface HealthInputs {
  readonly bootOk: boolean;
  readonly bootComplete: boolean;
  readonly bootedAt: string | null;
  readonly bootSummary: string;
  readonly bots: readonly BotHealth[];
  readonly queue: WriteCounts & { readonly depth: number; readonly paused: boolean; readonly closed: boolean };
  readonly lastWrite: LastWrite | null;
  readonly unclassifiedHeld: number;
  readonly unclassifiedDropped: number;
  readonly memory: string;
  readonly now: Date;
}

export interface HealthResponse {
  readonly httpStatus: number;
  readonly body: Record<string, unknown>;
}

export function buildHealthResponse(inputs: HealthInputs): HealthResponse {
  const allPolling = inputs.bots.length > 0 && inputs.bots.every((bot) => bot.polling);
  const status = !inputs.bootOk ? "boot_failed" : allPolling && !inputs.queue.closed ? "ok" : "degraded";
  return {
    httpStatus: inputs.bootOk ? 200 : 503,
    body: {
      status,
      bootOk: inputs.bootOk,
      bootComplete: inputs.bootComplete,
      bootedAt: inputs.bootedAt,
      bootSummary: inputs.bootSummary,
      uptimeSeconds: inputs.bootedAt === null ? 0 : Math.round((inputs.now.getTime() - new Date(inputs.bootedAt).getTime()) / 1000),
      bots: inputs.bots.map((bot) => ({
        name: bot.name,
        polling: bot.polling,
        state: bot.state,
        conflicts: bot.conflicts,
        pollingSince: bot.pollingSince,
      })),
      queue: {
        depth: inputs.queue.depth,
        pending: inputs.queue.pending,
        saved: inputs.queue.saved,
        failed: inputs.queue.failed,
        paused: inputs.queue.paused,
        acceptingWrites: !inputs.queue.closed,
      },
      lastWrite: inputs.lastWrite,
      unclassifiedHeld: inputs.unclassifiedHeld,
      unclassifiedDropped: inputs.unclassifiedDropped,
      memory: inputs.memory,
      checkedAt: inputs.now.toISOString(),
    },
  };
}
