import type { Sleep } from "../core/ports.js";
import { refuse, ok, type Result } from "../core/result.js";
import { MODEL_ATTEMPTS, MODEL_RETRY_BACKOFF_MS } from "../core/tuning.js";
import { maskSecrets } from "../core/redactor.js";
import type { FetchLike, ModelAnswer, ModelAsk, TextModel } from "./textModel.js";

export const GEMINI_ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models";

export interface GeminiSettings {
  readonly apiKey: string;
  readonly model: string;
  readonly fallbackModel: string;
}

function textFrom(payload: string): string | null {
  const parsed: unknown = JSON.parse(payload);
  if (typeof parsed !== "object" || parsed === null) return null;
  const candidates = (parsed as { candidates?: unknown }).candidates;
  if (!Array.isArray(candidates) || candidates.length === 0) return null;
  const parts = (candidates[0] as { content?: { parts?: unknown } }).content?.parts;
  if (!Array.isArray(parts)) return null;
  const text = (parts[0] as { text?: unknown }).text;
  return typeof text === "string" ? text : null;
}

export class GeminiModel implements TextModel {
  readonly #settings: GeminiSettings;
  readonly #sleep: Sleep;
  readonly #fetch: FetchLike;

  constructor(settings: GeminiSettings, sleep: Sleep, fetchImpl: FetchLike) {
    this.#settings = settings;
    this.#sleep = sleep;
    this.#fetch = fetchImpl;
  }

  name(): string {
    return this.#settings.model;
  }

  async ask(ask: ModelAsk): Promise<Result<ModelAnswer>> {
    let attempts = 0;
    let lastDetail = "no attempt made";
    for (const model of [...new Set([this.#settings.model, this.#settings.fallbackModel])]) {
      for (let tries = 0; tries < MODEL_ATTEMPTS; tries += 1) {
        attempts += 1;
        const attempt = await this.#once(model, ask);
        if (attempt.ok) return ok({ text: attempt.value, model, attempts });
        lastDetail = attempt.detail ?? attempt.code;
        if (tries < MODEL_ATTEMPTS - 1) await this.#sleep(MODEL_RETRY_BACKOFF_MS[tries] ?? 0);
      }
    }
    return refuse("MODEL_UNAVAILABLE", lastDetail);
  }

  async #once(model: string, ask: ModelAsk): Promise<Result<string>> {
    const body = JSON.stringify({
      contents: [{ parts: [{ text: ask.prompt }] }],
      generationConfig: ask.json ? { responseMimeType: "application/json", temperature: 0 } : { temperature: 0.2 },
    });
    try {
      const response = await this.#fetch(`${GEMINI_ENDPOINT}/${model}:generateContent`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-goog-api-key": this.#settings.apiKey },
        body,
      });
      const payload = await response.text();
      if (!response.ok) return refuse("MODEL_UNAVAILABLE", `${model} http ${response.status} ${maskSecrets(payload).slice(0, 160)}`);
      const text = textFrom(payload);
      if (text === null || text.trim().length === 0) return refuse("MODEL_UNAVAILABLE", `${model} returned no text`);
      return ok(text);
    } catch (error) {
      return refuse("MODEL_UNAVAILABLE", `${model} ${maskSecrets(error instanceof Error ? error.message : String(error)).slice(0, 160)}`);
    }
  }
}
