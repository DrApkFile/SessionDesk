import { refuse, ok, type Result } from "../core/result.js";
import type { ModelAnswer, ModelAsk, TextModel } from "./textModel.js";

export type AnswerCheck = (text: string) => { readonly accepted: boolean; readonly reason: string };

export interface ChainAttempt {
  readonly model: string;
  readonly outcome: "answered" | "refused" | "rejected";
  readonly detail: string;
}

export interface ChainResult extends ModelAnswer {
  readonly attempts: number;
  readonly tried: readonly ChainAttempt[];
}

export class ReplyChain {
  readonly #models: readonly TextModel[];

  constructor(models: readonly TextModel[]) {
    this.#models = models;
  }

  names(): readonly string[] {
    return this.#models.map((model) => model.name());
  }

  async askChecked(ask: ModelAsk, check: AnswerCheck): Promise<Result<ChainResult>> {
    const tried: ChainAttempt[] = [];
    for (const model of this.#models) {
      const asked = await model.ask(ask);
      if (!asked.ok) {
        tried.push({ model: model.name(), outcome: "refused", detail: asked.detail ?? asked.code });
        continue;
      }
      const checked = check(asked.value.text);
      if (!checked.accepted) {
        tried.push({ model: asked.value.model, outcome: "rejected", detail: checked.reason });
        continue;
      }
      tried.push({ model: asked.value.model, outcome: "answered", detail: "" });
      return ok({ text: asked.value.text, model: asked.value.model, attempts: tried.length, tried });
    }
    return refuse("MODEL_UNAVAILABLE", tried.map((attempt) => `${attempt.model}:${attempt.outcome}`).join(" "));
  }
}
