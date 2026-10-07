import { maskSecrets } from "../../core/redactor.js";

export type Sink = (line: string) => void;

export class Log {
  readonly #sink: Sink;
  readonly #scope: string;

  constructor(scope: string, sink: Sink = console.log) {
    this.#scope = scope;
    this.#sink = sink;
  }

  say(event: string, fields: Record<string, string | number | boolean | null> = {}): void {
    const parts = Object.entries(fields).map(([key, value]) => `${key}=${String(value)}`);
    this.#sink(maskSecrets([new Date().toISOString(), this.#scope, event, ...parts].join(" ")));
  }

  child(scope: string): Log {
    return new Log(`${this.#scope}.${scope}`, this.#sink);
  }
}
