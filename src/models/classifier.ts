import { readClassificationJson, type Classification } from "../core/classification.js";
import type { Clock } from "../core/ports.js";
import { refuse, ok, type Result } from "../core/result.js";
import { GEMINI_RETRY_WINDOW_MINUTES } from "../core/tuning.js";
import { classifyPrompt } from "./prompts.js";
import type { TextModel } from "./textModel.js";

export const CLASSIFIERS = ["gemini", "groq_fallback"] as const;
export type ClassifierName = (typeof CLASSIFIERS)[number];

export interface Classified {
  readonly classification: Classification;
  readonly classifier: ClassifierName;
  readonly wellFormed: boolean;
  readonly model: string;
}

export class Classifier {
  readonly #primary: TextModel;
  readonly #fallback: TextModel;
  readonly #clock: Clock;
  readonly #windowMs: number;
  #primaryDownSince: Date | null = null;
  #probeDueAt: Date | null = null;

  constructor(primary: TextModel, fallback: TextModel, clock: Clock, windowMinutes: number = GEMINI_RETRY_WINDOW_MINUTES) {
    this.#primary = primary;
    this.#fallback = fallback;
    this.#clock = clock;
    this.#windowMs = windowMinutes * 60 * 1000;
  }

  primaryDownSince(): Date | null {
    return this.#primaryDownSince;
  }

  outageMs(): number {
    return this.#primaryDownSince === null ? 0 : this.#clock.now().getTime() - this.#primaryDownSince.getTime();
  }

  pastWindow(): boolean {
    return this.#primaryDownSince !== null && this.outageMs() > this.#windowMs;
  }

  probeDueAt(): Date | null {
    return this.#probeDueAt;
  }

  async classify(text: string): Promise<Result<Classified>> {
    const now = this.#clock.now();
    const onFallback = this.pastWindow();
    const probing = onFallback && (this.#probeDueAt === null || now.getTime() >= this.#probeDueAt.getTime());
    let detail = "not attempted";

    if (!onFallback || probing) {
      const viaPrimary = await this.#ask(this.#primary, text, "gemini");
      if (viaPrimary.ok) {
        this.#primaryDownSince = null;
        this.#probeDueAt = null;
        return viaPrimary;
      }
      detail = viaPrimary.detail ?? viaPrimary.code;
      if (this.#primaryDownSince === null) this.#primaryDownSince = now;
      if (onFallback) this.#probeDueAt = new Date(now.getTime() + this.#windowMs);
      if (!onFallback) return refuse("MODEL_UNAVAILABLE", detail);
    }

    const viaFallback = await this.#ask(this.#fallback, text, "groq_fallback");
    if (viaFallback.ok) return viaFallback;
    return refuse("MODEL_UNAVAILABLE", `${detail}; ${viaFallback.detail ?? viaFallback.code}`);
  }

  async #ask(model: TextModel, text: string, classifier: ClassifierName): Promise<Result<Classified>> {
    const asked = await model.ask({ prompt: classifyPrompt(text), json: true });
    if (!asked.ok) return asked;
    const read = readClassificationJson(asked.value.text);
    return ok({ classification: read.classification, classifier, wellFormed: read.wellFormed, model: asked.value.model });
  }
}
