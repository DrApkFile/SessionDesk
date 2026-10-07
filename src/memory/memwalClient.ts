import { MemWal } from "@mysten-incubation/memwal";
import type { MemWalLike } from "./memwalAdapter.js";

export interface MemwalClientSettings {
  readonly key: string;
  readonly accountId: string;
  readonly serverUrl: string;
}

export function createMemwalClient(settings: MemwalClientSettings): MemWalLike {
  return MemWal.create({ key: settings.key, accountId: settings.accountId, serverUrl: settings.serverUrl });
}
