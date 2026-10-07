import { encode } from "../../core/codec.js";
import { stamp, type LedgerEvent } from "../../core/events.js";
import { idempotencyKey, keyFromMaterial } from "../../core/idempotency.js";
import { resolveNamespace } from "../../core/namespace.js";
import type { SeqAllocator } from "../../core/seq.js";
import type { EventDraft } from "../../core/events.js";
import type { NamespaceRef } from "../../core/namespace.js";
import type { LedgerCache } from "../../memory/cache.js";
import type { WriteQueue } from "../../memory/writeQueue.js";

export interface CommittableWrite {
  readonly draft: EventDraft;
  readonly namespaces: readonly NamespaceRef[];
  readonly idempotency?: string;
}

export interface WriteOrigin {
  readonly chatId: number;
  readonly messageId: number;
}

export interface RecordedWrite {
  readonly event: LedgerEvent;
  readonly namespaces: readonly string[];
}

export type CacheFor = (namespace: string) => LedgerCache;

export class EventPipeline {
  readonly #seq: SeqAllocator;
  readonly #cacheFor: CacheFor;
  readonly #queue: WriteQueue;
  readonly #communityKey: string;

  constructor(seq: SeqAllocator, cacheFor: CacheFor, queue: WriteQueue, communityKey: string) {
    this.#seq = seq;
    this.#cacheFor = cacheFor;
    this.#queue = queue;
    this.#communityKey = communityKey;
  }

  commit(writes: readonly CommittableWrite[], origin: WriteOrigin, now: Date): readonly RecordedWrite[] {
    return writes.map((write, index) => {
      const event = stamp(write.draft, this.#seq.next(), now.toISOString());
      const text = encode(event);
      const namespaces = write.namespaces.map((ref, refIndex) => {
        const namespace = resolveNamespace(this.#communityKey, ref);
        this.#cacheFor(namespace).record({
          seq: event.seq,
          namespace,
          memberH: ref.kind === "member" ? ref.memberH : null,
          event,
          state: "saving",
          blobId: null,
          code: null,
        });
        this.#queue.enqueue({
          seq: event.seq,
          namespace,
          text,
          idempotencyKey:
            write.idempotency === undefined
              ? idempotencyKey({
                  communityKey: this.#communityKey,
                  chatId: origin.chatId,
                  messageId: origin.messageId,
                  eventType: event.type,
                  index: index * 10 + refIndex,
                })
              : keyFromMaterial(`${write.idempotency}|${refIndex}`),
        });
        return namespace;
      });
      return { event, namespaces };
    });
  }

  queueDepth(): number {
    return this.#queue.depth();
  }
}
