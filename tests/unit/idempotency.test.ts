import { describe, expect, it } from "vitest";
import { idempotencyKey } from "../../src/core/idempotency.js";

const origin = { communityKey: "c1", chatId: -100123, messageId: 55, eventType: "ITEM_OPENED", index: 0 } as const;

describe("F20 idempotency keys", () => {
  it("gives the same key for a redelivered message so a retry reuses the blob", () => {
    expect(idempotencyKey(origin)).toBe(idempotencyKey({ ...origin }));
  });

  it("separates the events produced from one message", () => {
    expect(idempotencyKey(origin)).not.toBe(idempotencyKey({ ...origin, index: 1 }));
    expect(idempotencyKey(origin)).not.toBe(idempotencyKey({ ...origin, eventType: "THEME_CREATED" }));
  });

  it("separates communities, chats and messages", () => {
    expect(idempotencyKey(origin)).not.toBe(idempotencyKey({ ...origin, communityKey: "c2" }));
    expect(idempotencyKey(origin)).not.toBe(idempotencyKey({ ...origin, chatId: -100124 }));
    expect(idempotencyKey(origin)).not.toBe(idempotencyKey({ ...origin, messageId: 56 }));
  });
});
