import { randomBytes } from "node:crypto";
import type { IdSource } from "../../core/ports.js";

export function randomIds(): IdSource {
  const token = (): string => randomBytes(4).toString("hex");
  return {
    newItemId: () => `i-${token()}`,
    newThemeId: () => `t-${token()}`,
    newPromiseId: () => `p-${token()}`,
  };
}
