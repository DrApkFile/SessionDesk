import type { CommunityState } from "../../src/core/state.js";

function plain(value: unknown): unknown {
  if (value instanceof Map) return Object.fromEntries([...value.entries()].sort().map(([key, held]) => [key, plain(held)]));
  if (value instanceof Set) return [...value].sort();
  if (Array.isArray(value)) return value.map(plain);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).sort(([left], [right]) => (left < right ? -1 : 1)).map(([key, held]) => [key, plain(held)]));
  }
  return value;
}

export function snapshotState(state: CommunityState): string {
  return JSON.stringify(plain(state), null, 1);
}
