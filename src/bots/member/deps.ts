import type { ButtonChoice } from "../../platform/platform.js";
import type { Clock, IdSource } from "../../core/ports.js";
import type { LedgerCache } from "../../memory/cache.js";
import type { MemoryPort } from "../../memory/port.js";
import type { Classifier } from "../../models/classifier.js";
import type { ReplyChain } from "../../models/replyChain.js";
import type { MemberDirectory } from "../shared/directory.js";
import type { MemoryHealth } from "../shared/health.js";
import type { Log } from "../shared/log.js";
import type { PendingClassifications } from "../shared/pending.js";
import type { EventPipeline } from "../shared/pipeline.js";
import type { BotHandle, CommunityChat } from "../shared/startup.js";

export interface MemberDeps {
  readonly communityKey: string;
  readonly namespaceSecret: string;
  readonly cache: LedgerCache;
  readonly pipeline: EventPipeline;
  readonly health: MemoryHealth;
  readonly classifier: Classifier;
  readonly replies: ReplyChain;
  readonly pending: PendingClassifications;
  readonly clock: Clock;
  readonly log: Log;
  readonly chat: CommunityChat;
  readonly ids: IdSource;
  readonly directory: MemberDirectory;
  readonly memory: MemoryPort;
  readonly managerIds: readonly string[];
  readonly self: BotHandle;
  readonly directMessagesNeedOptIn: boolean;
  readonly notifyManagers: ManagerNotice;
}

export interface ManagerNoticeDelivery {
  readonly delivered: number;
  readonly failed: number;
}

export type ManagerNotice = (notice: {
  readonly text: string;
  readonly answerIds: readonly string[];
  readonly choices: readonly ButtonChoice[];
}) => Promise<ManagerNoticeDelivery>;
