import { COMMUNITY_MAX_ITEMS, activeAnswerCount, asksAboutTrends, describePublicItem, topThemes, type CommunityKnowledge } from "../../core/community.js";
import { decode } from "../../core/codec.js";
import { resolveNamespace } from "../../core/namespace.js";
import type { CommunityState } from "../../core/state.js";
import { KNOWN_ISSUE_MAX_DISTANCE, KNOWN_ISSUE_SEARCH_LIMIT } from "../../core/tuning.js";
import type { MemoryPort } from "../../memory/port.js";

export async function lookUpCommunityKnowledge(
  memory: MemoryPort,
  communityKey: string,
  state: CommunityState,
  question: string,
): Promise<CommunityKnowledge> {
  const namespace = resolveNamespace(communityKey, { kind: "items" });
  const found = await memory.search(namespace, question, KNOWN_ISSUE_SEARCH_LIMIT, KNOWN_ISSUE_MAX_DISTANCE);
  const hits = found.ok ? found.value.lines : [];

  const seen = new Set<string>();
  const items = hits
    .map((line) => {
      const event = decode(line.text);
      if (event === null || event.type !== "ITEM_OPENED") return null;
      const item = state.items.get(event.itemId);
      if (item === undefined || item.visibility !== "public" || seen.has(item.itemId)) return null;
      seen.add(item.itemId);
      return describePublicItem(item, line.distance ?? KNOWN_ISSUE_MAX_DISTANCE);
    })
    .filter((item): item is NonNullable<typeof item> => item !== null)
    .slice(0, COMMUNITY_MAX_ITEMS);

  return {
    items,
    themes: asksAboutTrends(question) ? topThemes(state) : [],
    answersConsidered: activeAnswerCount(state),
    candidates: hits.length,
  };
}
