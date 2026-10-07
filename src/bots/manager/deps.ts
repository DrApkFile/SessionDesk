import type { Clock, IdSource } from "../../core/ports.js";
import type { IncomingMessage } from "../shared/incoming.js";
import type { LedgerCache } from "../../memory/cache.js";
import type { TextModel } from "../../models/textModel.js";
import type { MemberDirectory } from "../shared/directory.js";
import type { MemoryHealth } from "../shared/health.js";
import type { Log } from "../shared/log.js";
import type { EventPipeline } from "../shared/pipeline.js";

export interface StatusProbe {
  snapshot(): Record<string, string | number>;
}

export interface ManagerDeps {
  readonly communityKey: string;
  readonly managerIds: readonly number[];
  readonly cache: LedgerCache;
  readonly notesCache: LedgerCache;
  readonly pipeline: EventPipeline;
  readonly health: MemoryHealth;
  readonly model: TextModel;
  readonly clock: Clock;
  readonly log: Log;
  readonly ids: IdSource;
  readonly directory: MemberDirectory;
  readonly status: StatusProbe;
}

export interface ManagerContext {
  readonly message: IncomingMessage;
  readonly managerId: number;
  readonly replyToMemberH: string | null;
}
