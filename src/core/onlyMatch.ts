export type Match<T> =
  | { readonly kind: "one"; readonly value: T }
  | { readonly kind: "none" }
  | { readonly kind: "many"; readonly count: number };

export function onlyMatch<T>(candidates: readonly T[], accepts: (candidate: T) => boolean): Match<T> {
  const hits = candidates.filter(accepts);
  const first = hits[0];
  if (hits.length === 1 && first !== undefined) return { kind: "one", value: first };
  if (hits.length === 0) return { kind: "none" };
  return { kind: "many", count: hits.length };
}
