import { BudgetGovernor } from "../../core/budget.js";
import type { Clock } from "../../core/ports.js";
import { resolveNamespace } from "../../core/namespace.js";
import { MemwalAdapter } from "../../memory/memwalAdapter.js";
import { createMemwalClient } from "../../memory/memwalClient.js";
import type { MemoryPort } from "../../memory/port.js";

export interface NotesSettings {
  readonly serverUrl: string;
  readonly accountB: { readonly accountId: string; readonly privateKey: string };
  readonly communityKey: string;
}

export interface NotesMemory {
  readonly port: MemoryPort;
  readonly namespace: string;
  readonly budget: BudgetGovernor;
}

export function createNotesMemory(settings: NotesSettings, clock: Clock): NotesMemory {
  const budget = new BudgetGovernor(clock);
  const port = new MemwalAdapter(
    createMemwalClient({
      key: settings.accountB.privateKey,
      accountId: settings.accountB.accountId,
      serverUrl: settings.serverUrl,
    }),
    budget,
  );
  return { port, namespace: resolveNamespace(settings.communityKey, { kind: "notes" }), budget };
}
