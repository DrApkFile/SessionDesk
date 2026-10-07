import { HELPED_PER_PAIR_PER_DAY, POINTS_PER_CONTRIBUTION } from "./tuning.js";
import type { ContributionKind } from "./vocabulary.js";

export type HelpCredit =
  | { readonly credited: true }
  | { readonly credited: false; readonly reason: "self_thanks" | "pair_limit_reached" };

export function pointsFor(kind: ContributionKind): number {
  return POINTS_PER_CONTRIBUTION[kind];
}

export function helpedPairKey(thankerH: string, day: string): string {
  return `${thankerH}:${day}`;
}

export interface HelpCreditInputs {
  readonly helperH: string;
  readonly thankerH: string;
  readonly day: string;
  readonly helperPairDayCounts: ReadonlyMap<string, number>;
}

export function mayCreditHelp(inputs: HelpCreditInputs): HelpCredit {
  if (inputs.helperH === inputs.thankerH) return { credited: false, reason: "self_thanks" };
  const alreadyCredited = inputs.helperPairDayCounts.get(helpedPairKey(inputs.thankerH, inputs.day)) ?? 0;
  if (alreadyCredited >= HELPED_PER_PAIR_PER_DAY) return { credited: false, reason: "pair_limit_reached" };
  return { credited: true };
}
