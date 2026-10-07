import { describe, expect, it } from "vitest";
import { recordedSleep } from "../../src/core/ports.js";
import { MODEL_ATTEMPTS, MODEL_RETRY_BACKOFF_MS } from "../../src/core/tuning.js";
import { GeminiModel } from "../../src/models/gemini.js";
import type { FetchLike } from "../../src/models/textModel.js";

const settings = { apiKey: `AIza${"k".repeat(35)}`, model: "gemini-3.8-flash", fallbackModel: "gemini-3.5-flash" };

function answer(text: string): string {
  return JSON.stringify({ candidates: [{ content: { parts: [{ text }] } }] });
}

function fetcher(plan: ReadonlyArray<{ status: number; body: string }>, seen: string[]): FetchLike {
  let call = 0;
  return async (url, init) => {
    seen.push(url);
    const step = plan[Math.min(call, plan.length - 1)];
    call += 1;
    expect(init.headers["x-goog-api-key"]).toBe(settings.apiKey);
    return { ok: (step?.status ?? 500) < 400, status: step?.status ?? 500, text: async () => step?.body ?? "" };
  };
}

describe("F08 gemini 503 high demand", () => {
  it("answers on the first try when the model is healthy", async () => {
    const seen: string[] = [];
    const model = new GeminiModel(settings, recordedSleep([]), fetcher([{ status: 200, body: answer('{"kind":"bug"}') }], seen));
    const asked = await model.ask({ prompt: "p", json: true });
    expect(asked.ok && asked.value).toEqual({ text: '{"kind":"bug"}', model: "gemini-3.8-flash", attempts: 1 });
    expect(seen[0]).toContain("gemini-3.8-flash:generateContent");
  });

  it("retries the primary model with backoff before giving up on it", async () => {
    const waits: number[] = [];
    const seen: string[] = [];
    const model = new GeminiModel(
      settings,
      recordedSleep(waits),
      fetcher([{ status: 503, body: '{"error":"The model is overloaded"}' }, { status: 503, body: "busy" }, { status: 200, body: answer("ok") }], seen),
    );
    const asked = await model.ask({ prompt: "p", json: false });
    expect(asked.ok && asked.value.attempts).toBe(3);
    expect(asked.ok && asked.value.model).toBe("gemini-3.8-flash");
    expect(waits).toEqual([MODEL_RETRY_BACKOFF_MS[0], MODEL_RETRY_BACKOFF_MS[1]]);
  });

  it("falls back to the fallback model once the primary keeps failing", async () => {
    const seen: string[] = [];
    const plan = [
      { status: 503, body: "busy" },
      { status: 503, body: "busy" },
      { status: 503, body: "busy" },
      { status: 200, body: answer("from the fallback") },
    ];
    const model = new GeminiModel(settings, recordedSleep([]), fetcher(plan, seen));
    const asked = await model.ask({ prompt: "p", json: false });
    expect(asked.ok && asked.value).toEqual({ text: "from the fallback", model: "gemini-3.5-flash", attempts: MODEL_ATTEMPTS + 1 });
    expect(seen.filter((url) => url.includes("gemini-3.5-flash"))).toHaveLength(1);
  });

  it("refuses with MODEL_UNAVAILABLE when both models stay down", async () => {
    const model = new GeminiModel(settings, recordedSleep([]), fetcher([{ status: 503, body: "high demand" }], []));
    const asked = await model.ask({ prompt: "p", json: false });
    expect(asked.ok).toBe(false);
    if (!asked.ok) {
      expect(asked.code).toBe("MODEL_UNAVAILABLE");
      expect(asked.detail).toContain("gemini-3.5-flash http 503");
    }
  });

  it("refuses a 200 that carries no text instead of inventing one", async () => {
    const model = new GeminiModel(settings, recordedSleep([]), fetcher([{ status: 200, body: '{"candidates":[]}' }], []));
    const asked = await model.ask({ prompt: "p", json: false });
    expect(asked.ok).toBe(false);
    if (!asked.ok) expect(asked.detail).toContain("returned no text");
  });

  it("survives a thrown network error and keeps the key out of the detail", async () => {
    const model = new GeminiModel(settings, recordedSleep([]), async () => {
      throw new Error(`connect ECONNREFUSED with key ${settings.apiKey}`);
    });
    const asked = await model.ask({ prompt: "p", json: false });
    expect(asked.ok).toBe(false);
    if (!asked.ok) {
      expect(asked.detail).toContain("[redacted:google_api_key]");
      expect(asked.detail).not.toContain(settings.apiKey);
    }
  });

  it("asks for json only when the caller wants json", async () => {
    const bodies: string[] = [];
    const capture: FetchLike = async (_url, init) => {
      bodies.push(init.body);
      return { ok: true, status: 200, text: async () => answer("x") };
    };
    const model = new GeminiModel(settings, recordedSleep([]), capture);
    await model.ask({ prompt: "p", json: true });
    await model.ask({ prompt: "p", json: false });
    expect(bodies[0]).toContain('"responseMimeType":"application/json"');
    expect(bodies[1]).not.toContain("responseMimeType");
  });
});
