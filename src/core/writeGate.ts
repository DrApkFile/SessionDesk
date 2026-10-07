import type { DraftFrom } from "./authority.js";
import type { Classification } from "./classification.js";
import { mayCreditHelp } from "./contributions.js";
import type { NamespaceRef } from "./namespace.js";
import type { IdSource } from "./ports.js";
import { guardStoredText } from "./redactor.js";
import { refuse, ok, type Result } from "./result.js";
import { matchTheme, themeLabelFor, type ThemeRecord } from "./themes.js";
import { clipStoredText } from "./text.js";
import type { ItemKind } from "./vocabulary.js";

export type GateDraft = DraftFrom<"write_gate">;

export interface PlannedWrite {
  readonly draft: GateDraft;
  readonly namespaces: readonly NamespaceRef[];
}

export interface GateContext {
  readonly memberH: string;
  readonly consented: boolean;
  readonly themes: readonly ThemeRecord[];
  readonly replyToMemberH: string | null;
  readonly helperPairDayCounts: ReadonlyMap<string, number>;
  readonly day: string;
  readonly ids: IdSource;
}

const ITEM_KINDS_BY_MESSAGE = { bug: "bug", feature: "feature", feedback: "feedback" } as const;

export function planWrites(classification: Classification, text: string, context: GateContext): Result<readonly PlannedWrite[]> {
  if (!context.consented) return refuse("NOT_CONSENTED");
  const guarded = guardStoredText(text);
  if (!guarded.ok) return guarded;

  const kind = classification.kind;
  if (kind === "chit_chat" || kind === "other") return ok([]);

  if (kind === "profile") {
    const profile = classification.profile;
    if (profile === undefined) return ok([]);
    return ok([member(context, { type: "PROFILE_FACT", field: profile.field, value: profile.value })]);
  }

  if (kind === "thanks") return ok(planThanks(context));

  const theme = planTheme(classification, context);
  if (!theme.ok) return theme;
  const { themeId, created } = theme.value;
  const writes: readonly PlannedWrite[] = created === null ? [] : [{ draft: created, namespaces: [{ kind: "themes" }] }];

  if (kind === "question") {
    return ok([...writes, member(context, { type: "QUESTION_ASKED", themeId })]);
  }

  const itemKind: ItemKind = ITEM_KINDS_BY_MESSAGE[kind];
  const draft: GateDraft = { type: "ITEM_OPENED", itemId: context.ids.newItemId(), kind: itemKind, themeId, text: clipStoredText(text) };
  return ok([...writes, { draft, namespaces: [{ kind: "member", memberH: context.memberH }, { kind: "items" }] }]);
}

function planThanks(context: GateContext): readonly PlannedWrite[] {
  const helperH = context.replyToMemberH;
  if (helperH === null) return [];
  const credit = mayCreditHelp({
    helperH,
    thankerH: context.memberH,
    day: context.day,
    helperPairDayCounts: context.helperPairDayCounts,
  });
  if (!credit.credited) return [];
  return [
    {
      draft: { type: "CONTRIBUTION", kind: "helped", toMemberH: context.memberH },
      namespaces: [{ kind: "member", memberH: helperH }],
    },
  ];
}

interface ThemeChoice {
  readonly themeId: string;
  readonly created: GateDraft | null;
}

function planTheme(classification: Classification, context: GateContext): Result<ThemeChoice> {
  const label = themeLabelFor(classification.themeLabel);
  const matched = matchTheme(context.themes, label);
  if (matched.kind === "many") return refuse("AMBIGUOUS_TARGET", `theme label ${label} matches ${matched.count} themes`);
  if (matched.kind === "one") return ok({ themeId: matched.value.themeId, created: null });
  const themeId = context.ids.newThemeId();
  return ok({ themeId, created: { type: "THEME_CREATED", themeId, label } });
}

function member(context: GateContext, draft: GateDraft): PlannedWrite {
  return { draft, namespaces: [{ kind: "member", memberH: context.memberH }] };
}
