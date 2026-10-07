import { describe, expect, it } from "vitest";
import { BudgetGovernor } from "../../src/core/budget.js";
import type { Clock } from "../../src/core/ports.js";
import { BUDGET_WINDOW_MS, LEDGER_RECALL_QUERY, POINTS_PER_REMEMBER } from "../../src/core/tuning.js";
import { MemwalAdapter, describeFailure, type MemWalLike } from "../../src/memory/memwalAdapter.js";

const clock: Clock = { now: () => new Date("2026-10-07T09:00:00.000Z") };

function adapterOver(client: Partial<MemWalLike>, limit = 500): MemwalAdapter {
  const full = {
    rememberAndWait: async () => ({ blob_id: "blob1", namespace: "sd-c1-items" }),
    recall: async () => ({ results: [], total: 0 }),
    listNamespaces: async () => ({ namespaces: [], next_cursor: null, has_more: false }),
    ...client,
  } satisfies MemWalLike;
  return new MemwalAdapter(full, new BudgetGovernor(clock, limit, BUDGET_WINDOW_MS));
}

describe("the memwal adapter", () => {
  it("passes the idempotency key and timeout the queue chose", async () => {
    const seen: unknown[] = [];
    const adapter = adapterOver({
      rememberAndWait: async (text, namespace, opts) => {
        seen.push({ text, namespace, opts });
        return { blob_id: "blob9", namespace: namespace ?? "" };
      },
    });
    const written = await adapter.remember({ namespace: "sd-c1-items", text: "SD1|...", idempotencyKey: "abc" }, 45_000);
    expect(written).toEqual({ ok: true, value: { blobId: "blob9", namespace: "sd-c1-items" } });
    expect(seen[0]).toEqual({ text: "SD1|...", namespace: "sd-c1-items", opts: { timeoutMs: 45_000, idempotencyKey: "abc" } });
  });

  it("F02 reports a thrown write as WRITE_FAILED and never as success", async () => {
    const adapter = adapterOver({
      rememberAndWait: async () => {
        throw new Error("relayer 503");
      },
    });
    const written = await adapter.remember({ namespace: "sd-c1-items", text: "x", idempotencyKey: "k" }, 1000);
    expect(written.ok).toBe(false);
    if (!written.ok) expect(written.code).toBe("WRITE_FAILED");
  });

  it("refuses a write that came back without a blob id", async () => {
    const adapter = adapterOver({ rememberAndWait: async () => ({ blob_id: "", namespace: "sd-c1-items" }) });
    const written = await adapter.remember({ namespace: "sd-c1-items", text: "x", idempotencyKey: "k" }, 1000);
    expect(written.ok).toBe(false);
    if (!written.ok) expect(written.code).toBe("WRITE_FAILED");
  });

  it("reads a whole namespace newest first and reports what was dropped", async () => {
    const adapter = adapterOver({
      recall: async (params) => {
        expect(params).toEqual({ query: LEDGER_RECALL_QUERY, limit: 100, namespace: "sd-c1-items", sort: "recent" });
        return { results: [{ blob_id: "b1", text: "SD1|a", created_at: "2026-10-07T09:00:00Z" }], total: 1, dropped_count: 3 };
      },
    });
    const recalled = await adapter.recallNamespace("sd-c1-items", 100);
    expect(recalled.ok && recalled.value.droppedCount).toBe(3);
    expect(recalled.ok && recalled.value.lines[0]).toEqual({ text: "SD1|a", blobId: "b1", createdAt: "2026-10-07T09:00:00Z" });
    expect(recalled.ok && recalled.value.atLimit).toBe(false);
  });

  it("F05 says when a namespace filled the recall limit", async () => {
    const adapter = adapterOver({
      recall: async () => ({ results: [{ blob_id: "b1", text: "a" }, { blob_id: "b2", text: "b" }], total: 2 }),
    });
    const recalled = await adapter.recallNamespace("sd-c1-items", 2);
    expect(recalled.ok && recalled.value.atLimit).toBe(true);
  });

  it("F03 reports a failed recall as MEMORY_UNAVAILABLE", async () => {
    const adapter = adapterOver({
      recall: async () => {
        throw new Error("network down");
      },
    });
    const recalled = await adapter.recallNamespace("sd-c1-items", 100);
    expect(recalled.ok).toBe(false);
    if (!recalled.ok) expect(recalled.code).toBe("MEMORY_UNAVAILABLE");
  });

  it("walks every page of namespaces and keeps only this community's", async () => {
    let page = 0;
    const adapter = adapterOver({
      listNamespaces: async () => {
        page += 1;
        return page === 1
          ? { namespaces: [{ name: "sd-c1-items" }, { name: "other-app" }], next_cursor: "c2", has_more: true }
          : { namespaces: [{ name: "sd-c1-themes" }], next_cursor: null, has_more: false };
      },
    });
    expect(await adapter.namespacesWithPrefix("sd-c1-")).toEqual({ ok: true, value: ["sd-c1-items", "sd-c1-themes"] });
  });

  it("F07 refuses before calling walrus once the budget is spent", async () => {
    let calls = 0;
    const adapter = adapterOver(
      {
        rememberAndWait: async () => {
          calls += 1;
          return { blob_id: "b", namespace: "n" };
        },
      },
      POINTS_PER_REMEMBER,
    );
    expect((await adapter.remember({ namespace: "n", text: "t", idempotencyKey: "k" }, 100)).ok).toBe(true);
    const second = await adapter.remember({ namespace: "n", text: "t2", idempotencyKey: "k2" }, 100);
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.code).toBe("BUDGET_EXHAUSTED");
    expect(calls).toBe(1);
  });

  it("keeps a secret out of the failure detail it records", () => {
    expect(describeFailure(new Error(`auth failed for suiprivkey1${"a".repeat(50)}`))).toContain("[redacted:sui_private_key]");
  });
});
