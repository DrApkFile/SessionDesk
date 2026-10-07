import type { Sleep } from "../core/ports.js";
import { maskSecrets } from "../core/redactor.js";
import { refuse, ok, type Result } from "../core/result.js";
import { MODEL_ATTEMPTS, MODEL_RETRY_BACKOFF_MS } from "../core/tuning.js";
import type { FetchLike, ModelAnswer, ModelAsk, TextModel } from "./textModel.js";

export const GROQ_ENDPOINT = "https://api.groq.com/openai/v1/chat/completions";

export interface GroqSettings {
  readonly apiKey: string;
  readonly model: string;
}

function textFrom(payload: string): string | null {
  const parsed: unknown = JSON.parse(payload);
  if (typeof parsed !== "object" || parsed === null) return null;
  const choices = (parsed as { choices?: unknown }).choices;
  if (!Array.isArray(choices) || choices.length === 0) return null;
  const content = (choices[0] as { message?: { content?: unknown } }).message?.content;
  return typeof content === "string" ? content : null;
}

export class GroqModel implements TextModel {
  readonly #settings: GroqSettings;
  readonly #sleep: Sleep;
  readonly #fetch: FetchLike;

  constructor(settings: GroqSettings, sleep: Sleep, fetchImpl: FetchLike) {
    this.#settings = settings;
    this.#sleep = sleep;
    this.#fetch = fetchImpl;
  }

  name(): string {
    return this.#settings.model;
  }

  async ask(ask: ModelAsk): Promise<Result<ModelAnswer>> {
    let detail = "no attempt made";
    for (let attempt = 0; attempt < MODEL_ATTEMPTS; attempt += 1) {
      const once = await this.#once(ask);
      if (once.ok) return ok({ text: once.value, model: this.#settings.model, attempts: attempt + 1 });
      detail = once.detail ?? once.code;
      if (attempt < MODEL_ATTEMPTS - 1) await this.#sleep(MODEL_RETRY_BACKOFF_MS[attempt] ?? 0);
    }
    return refuse("MODEL_UNAVAILABLE", detail);
  }

  async #once(ask: ModelAsk): Promise<Result<string>> {
    const body = JSON.stringify({
      model: this.#settings.model,
      messages: [{ role: "user", content: ask.prompt }],
      temperature: 0,
      reasoning_effort: "none",
      ...(ask.json ? { response_format: { type: "json_object" } } : {}),
    });
    try {
      const response = await this.#fetch(GROQ_ENDPOINT, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${this.#settings.apiKey}` },
        body,
      });
      const payload = await response.text();
      if (!response.ok) return refuse("MODEL_UNAVAILABLE", `${this.#settings.model} http ${response.status} ${maskSecrets(payload).slice(0, 160)}`);
      const text = textFrom(payload);
      if (text === null || text.trim().length === 0) return refuse("MODEL_UNAVAILABLE", `${this.#settings.model} returned no text`);
      return ok(text);
    } catch (error) {
      return refuse("MODEL_UNAVAILABLE", `${this.#settings.model} ${maskSecrets(error instanceof Error ? error.message : String(error)).slice(0, 160)}`);
    }
  }
}
