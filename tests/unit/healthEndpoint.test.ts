import { describe, expect, it } from "vitest";
import { namespaceKindOf } from "../../src/core/namespace.js";
import { buildHealthResponse, type HealthInputs } from "../../src/server/healthReport.js";
import { healthBody } from "../../src/server/httpServer.js";

const bootedAt = "2026-10-08T09:00:00.000Z";
const now = new Date("2026-10-08T09:05:00.000Z");

function inputs(overrides: Partial<HealthInputs> = {}): HealthInputs {
  return {
    bootOk: true,
    bootComplete: true,
    bootedAt,
    bootSummary: "namespaces=3 lines=7 decoded=7 maxSeq=7 nextSeq=8",
    bots: [
      { name: "member", polling: true, state: "polling", conflicts: 0, pollingSince: bootedAt },
      { name: "manager", polling: true, state: "polling", conflicts: 0, pollingSince: bootedAt },
    ],
    queue: { depth: 0, pending: 0, saved: 7, failed: 0, paused: false, closed: false, pauses: 0 },
    lastWrite: { at: bootedAt, state: "saved", namespaceKind: "member", code: null },
    unclassifiedHeld: 0,
    unclassifiedDropped: 0,
    memory: "booted=2026-10-08T09:00:00.000Z unavailable=0 partial=0",
    now,
    ...overrides,
  };
}

describe("GET /health", () => {
  it("returns 200 and ok when both bots poll and boot succeeded", () => {
    const response = buildHealthResponse(inputs());
    expect(response.httpStatus).toBe(200);
    expect(response.body.status).toBe("ok");
    expect(response.body.uptimeSeconds).toBe(300);
  });

  it("reports the polling state of both bots", () => {
    const response = buildHealthResponse(inputs());
    expect(response.body.bots).toEqual([
      { name: "member", polling: true, state: "polling", conflicts: 0, pollingSince: bootedAt },
      { name: "manager", polling: true, state: "polling", conflicts: 0, pollingSince: bootedAt },
    ]);
  });

  it("reports the queue depth and the last write result", () => {
    const response = buildHealthResponse(inputs({ queue: { depth: 3, pending: 4, saved: 11, failed: 1, paused: true, closed: false, pauses: 2 } }));
    expect(response.body.queue).toEqual({ depth: 3, pending: 4, saved: 11, failed: 1, paused: true, rateLimitPauses: 2, acceptingWrites: true });
    expect(response.body.lastWrite).toEqual({ at: bootedAt, state: "saved", namespaceKind: "member", code: null });
  });

  it("returns 503 when the boot rebuild failed", () => {
    const response = buildHealthResponse(inputs({ bootOk: false }));
    expect(response.httpStatus).toBe(503);
    expect(response.body.status).toBe("boot_failed");
  });

  it("says degraded while a bot is not polling, but still answers 200", () => {
    const response = buildHealthResponse(
      inputs({ bots: [{ name: "member", polling: false, state: "conflict_backoff", conflicts: 2, pollingSince: null }] }),
    );
    expect(response.httpStatus).toBe(200);
    expect(response.body.status).toBe("degraded");
  });

  it("says degraded once the queue has stopped accepting writes", () => {
    const response = buildHealthResponse(inputs({ queue: { depth: 0, pending: 2, saved: 7, failed: 0, paused: false, closed: true, pauses: 0 } }));
    expect(response.body.status).toBe("degraded");
    expect(response.body.queue).toMatchObject({ acceptingWrites: false });
  });

  it("carries no secret, no token, no member hash and no namespace", () => {
    const serialised = healthBody(() =>
      inputs({ lastWrite: { at: bootedAt, state: "saved", namespaceKind: namespaceKindOf("sd-c1-m-0d4ff88c1234567890abcdef"), code: null } }),
    ).payload;
    for (const secret of ["suiprivkey1", "AIza", "gsk_", "0d4ff88c", "sd-c1-m-", "NAMESPACE_SECRET"]) {
      expect(serialised).not.toContain(secret);
    }
    expect(serialised).toContain('"namespaceKind": "member"');
  });

  it("tells the caller the http status and a json body", () => {
    const { status, payload } = healthBody(() => inputs());
    expect(status).toBe(200);
    expect(JSON.parse(payload)).toMatchObject({ status: "ok" });
  });

  it("names the kind of namespace without revealing which one", () => {
    expect(namespaceKindOf("sd-c1-m-aaaaaaaaaaaaaaaaaaaaaaaa")).toBe("member");
    expect(namespaceKindOf("sd-c1-items")).toBe("items");
    expect(namespaceKindOf("sd-c1-themes")).toBe("themes");
    expect(namespaceKindOf("sd-c1-notes")).toBe("notes");
  });
});
