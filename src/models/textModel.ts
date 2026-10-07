import type { Result } from "../core/result.js";

export type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body: string }) => Promise<{
  ok: boolean;
  status: number;
  text(): Promise<string>;
}>;

export interface ModelAsk {
  readonly prompt: string;
  readonly json: boolean;
}

export interface ModelAnswer {
  readonly text: string;
  readonly model: string;
  readonly attempts: number;
}

export interface TextModel {
  ask(ask: ModelAsk): Promise<Result<ModelAnswer>>;
  name(): string;
}
