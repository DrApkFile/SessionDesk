import { refuse, ok, type Result } from "./result.js";
import { CONTRIBUTOR_MIN_POINTS, REGULAR_MIN_ACTIVE_DAYS } from "./tuning.js";
import { MEMBER_TIERS, type GrantableTier, type MemberTier } from "./vocabulary.js";

export const TIER_RANK = {
  new: 0,
  regular: 1,
  contributor: 2,
  ambassador: 3,
} satisfies Record<MemberTier, number>;

export const FIRST_TIER: MemberTier = "new";

export interface TierInputs {
  readonly activeDays: number;
  readonly points: number;
}

export function earnedTier(inputs: TierInputs): MemberTier {
  const isRegular = inputs.activeDays >= REGULAR_MIN_ACTIVE_DAYS;
  if (isRegular && inputs.points >= CONTRIBUTOR_MIN_POINTS) return "contributor";
  if (isRegular) return "regular";
  return FIRST_TIER;
}

export function highestTier(left: MemberTier, right: MemberTier): MemberTier {
  return TIER_RANK[left] >= TIER_RANK[right] ? left : right;
}

export function tierAfter(grantedTier: MemberTier | null, earned: MemberTier): MemberTier {
  return grantedTier === null ? earned : highestTier(grantedTier, earned);
}

export function grantTier(grantedTier: MemberTier | null, wanted: GrantableTier): Result<GrantableTier> {
  if (grantedTier === wanted) return refuse("INVALID_TRANSITION", `this member is already ${wanted}`);
  return ok(wanted);
}

export function revokeTier(grantedTier: MemberTier | null): Result<null> {
  if (grantedTier === null) return refuse("INVALID_TRANSITION", "this member holds no granted tier to revoke");
  return ok(null);
}

export function isMemberTier(candidate: string): candidate is MemberTier {
  return (MEMBER_TIERS as readonly string[]).includes(candidate);
}
