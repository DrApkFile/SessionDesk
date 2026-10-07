import { describe, expect, it } from "vitest";
import { countingIds } from "../../src/core/ports.js";
import { planWrites, type GateContext } from "../../src/core/writeGate.js";

const MEMBER = "a".repeat(24);
const HELPER = "b".repeat(24);

function context(overrides: Partial<GateContext> = {}): GateContext {
  return {
    memberH: MEMBER,
    consented: true,
    themes: [{ themeId: "t1", label: "android login" }],
    replyToMemberH: null,
    helperPairDayCounts: new Map(),
    day: "2026-10-07",
    ids: countingIds(),
    ...overrides,
  };
}

describe("write gate", () => {
  it("F13 stores nothing for a member who has not consented", () => {
    const planned = planWrites({ kind: "bug" }, "android login fails", context({ consented: false }));
    expect(planned.ok).toBe(false);
    if (!planned.ok) expect(planned.code).toBe("NOT_CONSENTED");
  });

  it("stores nothing for chit chat or an unclassified message", () => {
    expect(planWrites({ kind: "chit_chat" }, "good morning everyone", context())).toEqual({ ok: true, value: [] });
    expect(planWrites({ kind: "other" }, "???", context())).toEqual({ ok: true, value: [] });
  });

  it("opens an item in the member namespace and the shared items namespace", () => {
    const planned = planWrites({ kind: "bug", themeLabel: "android login" }, "  android login fails on 2.3  ", context());
    expect(planned.ok).toBe(true);
    if (!planned.ok) return;
    expect(planned.value).toEqual([
      {
        draft: { type: "ITEM_OPENED", itemId: "i1", kind: "bug", themeId: "t1", text: "android login fails on 2.3" },
        namespaces: [{ kind: "member", memberH: MEMBER }, { kind: "items" }],
      },
    ]);
  });

  it("reuses an existing theme and creates one only when the label is new", () => {
    const reused = planWrites({ kind: "question", themeLabel: "Android Login" }, "any news on login?", context());
    expect(reused.ok && reused.value).toEqual([{ draft: { type: "QUESTION_ASKED", themeId: "t1" }, namespaces: [{ kind: "member", memberH: MEMBER }] }]);

    const created = planWrites({ kind: "question", themeLabel: "payments" }, "do we take cards?", context());
    expect(created.ok && created.value.map((write) => write.draft)).toEqual([
      { type: "THEME_CREATED", themeId: "t1", label: "payments" },
      { type: "QUESTION_ASKED", themeId: "t1" },
    ]);
    expect(created.ok && created.value[0]?.namespaces).toEqual([{ kind: "themes" }]);
  });

  it("refuses rather than pick when a label matches two themes", () => {
    const twins = [
      { themeId: "t1", label: "android login" },
      { themeId: "t2", label: "Android Login" },
    ];
    const planned = planWrites({ kind: "bug", themeLabel: "android login" }, "fails again", context({ themes: twins }));
    expect(planned.ok).toBe(false);
    if (!planned.ok) expect(planned.code).toBe("AMBIGUOUS_TARGET");
  });

  it("records a profile fact only when the model supplied one", () => {
    const withFact = planWrites({ kind: "profile", profile: { field: "role", value: "designer" } }, "i am a designer", context());
    expect(withFact.ok && withFact.value).toEqual([{ draft: { type: "PROFILE_FACT", field: "role", value: "designer" }, namespaces: [{ kind: "member", memberH: MEMBER }] }]);
    expect(planWrites({ kind: "profile" }, "i am a designer", context())).toEqual({ ok: true, value: [] });
  });

  it("credits a thanks to the member who was replied to, in their namespace", () => {
    const planned = planWrites({ kind: "thanks" }, "thanks, that fixed it", context({ replyToMemberH: HELPER }));
    expect(planned.ok && planned.value).toEqual([
      { draft: { type: "CONTRIBUTION", kind: "helped", toMemberH: MEMBER }, namespaces: [{ kind: "member", memberH: HELPER }] },
    ]);
  });

  it("stores no contribution for a thanks with no reply, a self thanks or a repeat the same day", () => {
    expect(planWrites({ kind: "thanks" }, "thanks all", context())).toEqual({ ok: true, value: [] });
    expect(planWrites({ kind: "thanks" }, "thanks me", context({ replyToMemberH: MEMBER }))).toEqual({ ok: true, value: [] });
    const counts = new Map([[`${MEMBER}:2026-10-07`, 1]]);
    expect(planWrites({ kind: "thanks" }, "thanks again", context({ replyToMemberH: HELPER, helperPairDayCounts: counts }))).toEqual({ ok: true, value: [] });
  });

  it("F10 stores nothing when the message carries a secret", () => {
    const planned = planWrites({ kind: "bug" }, "login fails with key ada@example.com", context());
    expect(planned.ok).toBe(false);
    if (!planned.ok) expect(planned.code).toBe("SECRET_BLOCKED");
  });
});
