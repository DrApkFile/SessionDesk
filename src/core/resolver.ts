import { authorityOf } from "./authority.js";
import { encode } from "./codec.js";
import { helpedPairKey, pointsFor } from "./contributions.js";
import type { LedgerEvent } from "./events.js";
import { FIRST_ITEM_STATUS, transitionItem } from "./items.js";
import { emptyState, memberIn, type CommunityState, type LedgerEntry } from "./state.js";
import { earnedTier, grantTier, revokeTier, tierAfter } from "./tier.js";
import { isProfileField } from "./vocabulary.js";

export function resolve(entries: readonly LedgerEntry[]): CommunityState {
  const state = emptyState();
  const seenBySeq = new Map<number, LedgerEvent>();
  for (const entry of inLedgerOrder(entries)) {
    apply(state, entry, seenBySeq);
    state.maxSeq = Math.max(state.maxSeq, entry.event.seq);
    seenBySeq.set(entry.event.seq, entry.event);
  }
  for (const member of state.members.values()) {
    member.tier = tierAfter(member.grantedTier, earnedTier({ activeDays: member.activeDays.size, points: member.points }));
  }
  return state;
}

export function inLedgerOrder(entries: readonly LedgerEntry[]): readonly LedgerEntry[] {
  const unique = new Map<string, LedgerEntry>();
  for (const entry of entries) unique.set(`${entry.memberH ?? ""}|${encode(entry.event)}`, entry);
  return [...unique.values()].sort(compareEntries);
}

function compareEntries(left: LedgerEntry, right: LedgerEntry): number {
  if (left.event.seq !== right.event.seq) return left.event.seq - right.event.seq;
  const leftKey = `${left.memberH ?? ""}|${encode(left.event)}`;
  const rightKey = `${right.memberH ?? ""}|${encode(right.event)}`;
  return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
}

function apply(state: CommunityState, entry: LedgerEntry, seenBySeq: Map<number, LedgerEvent>): void {
  const { event, memberH } = entry;
  const day = event.ts.slice(0, 10);
  if (memberH !== null) {
    const member = memberIn(state, memberH);
    member.lastSeq = Math.max(member.lastSeq, event.seq);
    if (authorityOf(event.type) !== "manager_command") member.activeDays.add(day);
  }

  switch (event.type) {
    case "CONSENT_GIVEN": {
      if (memberH === null) return reject(state);
      const member = memberIn(state, memberH);
      member.consented = true;
      member.dmConsent = member.dmConsent || event.scope === "storage_and_dm";
      return;
    }
    case "PROFILE_FACT": {
      if (memberH === null) return reject(state);
      memberIn(state, memberH).profile.set(event.field, event.value);
      return;
    }
    case "QUESTION_ASKED": {
      const theme = state.themes.get(event.themeId);
      if (theme === undefined) return reject(state);
      theme.questionCount += 1;
      return;
    }
    case "ITEM_OPENED": {
      const existing = state.items.get(event.itemId);
      if (existing === undefined) {
        state.items.set(event.itemId, {
          itemId: event.itemId,
          kind: event.kind,
          themeId: event.themeId,
          text: event.text,
          status: FIRST_ITEM_STATUS,
          openedByH: memberH,
          openedSeq: event.seq,
          openedTs: event.ts,
          statusSeq: event.seq,
          statusTs: event.ts,
        });
      } else if (memberH !== null) {
        existing.openedByH = memberH;
      }
      const theme = state.themes.get(event.themeId);
      if (theme !== undefined) pushUnique(theme.itemIds, event.itemId);
      if (memberH !== null) pushUnique(memberIn(state, memberH).itemIds, event.itemId);
      return;
    }
    case "ITEM_STATUS": {
      const item = state.items.get(event.itemId);
      if (item === undefined) return reject(state);
      const moved = transitionItem(item.status, event.status, true);
      if (!moved.ok) return reject(state);
      item.status = moved.value;
      item.statusSeq = event.seq;
      item.statusTs = event.ts;
      return;
    }
    case "PROMISE_MADE": {
      if (state.promises.has(event.promiseId)) return reject(state);
      state.promises.set(event.promiseId, {
        promiseId: event.promiseId,
        memberH: event.memberH,
        itemId: event.itemId ?? null,
        due: event.due,
        text: event.text,
        byManagerId: event.byManagerId,
        state: "open",
        madeSeq: event.seq,
        madeTs: event.ts,
        fulfilledTs: null,
      });
      return;
    }
    case "PROMISE_FULFILLED": {
      const promise = state.promises.get(event.promiseId);
      if (promise === undefined || promise.state !== "open") return reject(state);
      promise.state = "fulfilled";
      promise.fulfilledTs = event.ts;
      return;
    }
    case "CONTRIBUTION": {
      if (memberH === null) return reject(state);
      const member = memberIn(state, memberH);
      member.points += pointsFor(event.kind);
      if (event.kind === "helped" && event.toMemberH !== undefined) {
        const key = helpedPairKey(event.toMemberH, day);
        member.helperPairDayCounts.set(key, (member.helperPairDayCounts.get(key) ?? 0) + 1);
      }
      return;
    }
    case "CORRECTION": {
      applyCorrection(state, entry, seenBySeq);
      return;
    }
    case "THEME_CREATED": {
      if (state.themes.has(event.themeId)) return reject(state);
      state.themes.set(event.themeId, { themeId: event.themeId, label: event.label, questionCount: 0, itemIds: [], createdTs: event.ts });
      return;
    }
    case "TIER_SET": {
      const member = memberIn(state, event.memberH);
      const granted = grantTier(member.grantedTier, event.tier);
      if (!granted.ok) return reject(state);
      member.grantedTier = granted.value;
      return;
    }
    case "TIER_REVOKED": {
      const member = memberIn(state, event.memberH);
      const revoked = revokeTier(member.grantedTier);
      if (!revoked.ok) return reject(state);
      member.grantedTier = revoked.value;
      return;
    }
    case "MANAGER_NOTE": {
      state.notes.push({ seq: event.seq, ts: event.ts, memberH: event.memberH ?? null, text: event.text });
      return;
    }
  }
}

function applyCorrection(state: CommunityState, entry: LedgerEntry, seenBySeq: Map<number, LedgerEvent>): void {
  const event = entry.event;
  if (event.type !== "CORRECTION") return reject(state);
  const target = seenBySeq.get(event.targetSeq);
  if (target === undefined) return reject(state);
  if (target.type === "PROFILE_FACT" && entry.memberH !== null && isProfileField(event.field)) {
    memberIn(state, entry.memberH).profile.set(event.field, event.value);
    return;
  }
  if (target.type === "ITEM_OPENED" && event.field === "text") {
    const item = state.items.get(target.itemId);
    if (item === undefined) return reject(state);
    item.text = event.value;
    return;
  }
  reject(state);
}

function pushUnique(list: string[], value: string): void {
  if (!list.includes(value)) list.push(value);
}

function reject(state: CommunityState): void {
  state.rejectedEvents += 1;
}
