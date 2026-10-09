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

export function overlapRatio(left: ReadonlySet<string>, right: ReadonlySet<string>): number {
  const smaller = left.size <= right.size ? left : right;
  const larger = smaller === left ? right : left;
  if (smaller.size === 0) return 0;
  let shared = 0;
  for (const token of smaller) if (larger.has(token)) shared += 1;
  return shared / smaller.size;
}

export function onlyNearMatch<T>(
  candidates: readonly T[],
  tokensOf: (candidate: T) => ReadonlySet<string>,
  wanted: ReadonlySet<string>,
  minOverlap: number,
  minTokens = 2,
): Match<T> {
  if (wanted.size < minTokens) return { kind: "none" };
  const scored = candidates
    .map((candidate) => ({ candidate, tokens: tokensOf(candidate) }))
    .filter((scored) => scored.tokens.size >= minTokens)
    .map((scored) => ({ candidate: scored.candidate, ratio: overlapRatio(scored.tokens, wanted) }))
    .filter((scored) => scored.ratio >= minOverlap)
    .sort((left, right) => right.ratio - left.ratio);
  const best = scored[0];
  if (best === undefined) return { kind: "none" };
  const runnerUp = scored[1];
  if (runnerUp !== undefined && runnerUp.ratio === best.ratio) return { kind: "many", count: scored.filter((scored) => scored.ratio === best.ratio).length };
  return { kind: "one", value: best.candidate };
}
