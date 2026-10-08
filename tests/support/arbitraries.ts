import fc from "fast-check";
import type { LedgerEvent } from "../../src/core/events.js";
import { CONTRIBUTION_KINDS, ITEM_KINDS, ITEM_STATUSES, PROFILE_FIELDS } from "../../src/core/vocabulary.js";

const ID_CHARS = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_-".split("");
const HEX_CHARS = "0123456789abcdef".split("");
const TEXT_CHARS = ["a", "Z", "9", " ", "|", "=", "%", "&", "+", "\n", "\t", "e", "漢", "🙂", "<", ">", '"', "'", "/", "\\", "?", "#", ";", ":", ",", ".", "SD1"];

function joined(chars: readonly string[], minLength: number, maxLength: number): fc.Arbitrary<string> {
  return fc.array(fc.constantFrom(...chars), { minLength, maxLength }).map((parts) => parts.join(""));
}

export const identifierArb = joined(ID_CHARS, 1, 20);
export const memberHashArb = joined(HEX_CHARS, 24, 24);
export const storedTextArb = joined(TEXT_CHARS, 1, 40);
export const shortTextArb = joined(TEXT_CHARS, 1, 12);
export const seqArb = fc.integer({ min: 1, max: 1_000_000 });
export const momentArb = fc.date({ min: new Date("2020-01-01T00:00:00.000Z"), max: new Date("2030-01-01T00:00:00.000Z"), noInvalidDate: true });
export const timestampArb = momentArb.map((moment) => moment.toISOString());
export const dayArb = timestampArb.map((timestamp) => timestamp.slice(0, 10));

const optional = <T>(arb: fc.Arbitrary<T>): fc.Arbitrary<T | undefined> => fc.option(arb, { nil: undefined });

export const eventArb: fc.Arbitrary<LedgerEvent> = fc
  .tuple(seqArb, timestampArb)
  .chain(([seq, ts]) =>
    fc.oneof<fc.Arbitrary<LedgerEvent>[]>(
      fc.record({ seq: fc.constant(seq), ts: fc.constant(ts), type: fc.constant("CONSENT_GIVEN" as const), scope: fc.constantFrom("storage" as const, "storage_and_dm" as const) }),
      fc.record({ seq: fc.constant(seq), ts: fc.constant(ts), type: fc.constant("PROFILE_FACT" as const), field: fc.constantFrom(...PROFILE_FIELDS), value: shortTextArb }),
      fc.record({ seq: fc.constant(seq), ts: fc.constant(ts), type: fc.constant("QUESTION_ASKED" as const), themeId: identifierArb }),
      fc.record({ seq: fc.constant(seq), ts: fc.constant(ts), type: fc.constant("ITEM_OPENED" as const), itemId: identifierArb, kind: fc.constantFrom(...ITEM_KINDS), themeId: identifierArb, text: storedTextArb }),
      fc.record({ seq: fc.constant(seq), ts: fc.constant(ts), type: fc.constant("ITEM_STATUS" as const), itemId: identifierArb, status: fc.constantFrom(...ITEM_STATUSES) }),
      fc.record({
        seq: fc.constant(seq),
        ts: fc.constant(ts),
        type: fc.constant("PROMISE_MADE" as const),
        promiseId: identifierArb,
        memberH: memberHashArb,
        itemId: optional(identifierArb),
        due: dayArb,
        text: storedTextArb,
        byManagerId: joined("0123456789".split(""), 3, 10),
      }),
      fc.record({ seq: fc.constant(seq), ts: fc.constant(ts), type: fc.constant("PROMISE_FULFILLED" as const), promiseId: identifierArb }),
      fc.record({ seq: fc.constant(seq), ts: fc.constant(ts), type: fc.constant("CONTRIBUTION" as const), kind: fc.constantFrom(...CONTRIBUTION_KINDS), toMemberH: optional(memberHashArb) }),
      fc.record({ seq: fc.constant(seq), ts: fc.constant(ts), type: fc.constant("CORRECTION" as const), targetSeq: fc.integer({ min: 0, max: 1_000_000 }), field: identifierArb, value: storedTextArb }),
      fc.record({ seq: fc.constant(seq), ts: fc.constant(ts), type: fc.constant("THEME_CREATED" as const), themeId: identifierArb, label: shortTextArb }),
      fc.record({ seq: fc.constant(seq), ts: fc.constant(ts), type: fc.constant("MANAGER_NOTE" as const), memberH: optional(memberHashArb), text: storedTextArb }),
      fc.record({ seq: fc.constant(seq), ts: fc.constant(ts), type: fc.constant("TIER_SET" as const), memberH: memberHashArb, tier: fc.constant("ambassador" as const), byManagerId: joined("0123456789".split(""), 3, 10) }),
      fc.record({ seq: fc.constant(seq), ts: fc.constant(ts), type: fc.constant("TIER_REVOKED" as const), memberH: memberHashArb, byManagerId: joined("0123456789".split(""), 3, 10) }),
      fc.record({ seq: fc.constant(seq), ts: fc.constant(ts), type: fc.constant("ANSWER" as const), answerId: identifierArb, questionText: optional(storedTextArb), answerText: storedTextArb, answeredBy: fc.constantFrom("manager" as const, "member" as const), themeId: identifierArb }),
      fc.record({ seq: fc.constant(seq), ts: fc.constant(ts), type: fc.constant("ANSWER_RETIRED" as const), answerId: identifierArb, byManagerId: joined("0123456789".split(""), 3, 10) }),
      fc.record({ seq: fc.constant(seq), ts: fc.constant(ts), type: fc.constant("ANSWER_FEEDBACK" as const), answerId: identifierArb, helpful: fc.boolean() }),
      fc.record({ seq: fc.constant(seq), ts: fc.constant(ts), type: fc.constant("ITEM_AFFECTS" as const), itemId: identifierArb, memberH: memberHashArb }),
      fc.record({ seq: fc.constant(seq), ts: fc.constant(ts), type: fc.constant("DM_ADDRESS" as const), telegramUserId: fc.integer({ min: 1, max: 9_999_999_999 }) }),
      fc.record({ seq: fc.constant(seq), ts: fc.constant(ts), type: fc.constant("DM_HANDLE" as const), platform: fc.constantFrom("discord" as const, "slack" as const), address: joined(ID_CHARS, 3, 30) }),
    ),
  );

const WORD_CHARS = "abcdefghijklmnopqrstuvwxyz".split("");
export const fillerArb = fc.array(joined(WORD_CHARS, 1, 8), { minLength: 0, maxLength: 4 }).map((words) => words.join(" "));

export const glueArb = joined(WORD_CHARS, 1, 8);

export const highSpecificitySecretArb: fc.Arbitrary<string> = fc.oneof(
  joined(HEX_CHARS, 64, 70),
  joined(HEX_CHARS, 64, 70).map((hex) => `0x${hex}`),
  joined("abcdefghijklmnopqrstuvwxyz0123456789".split(""), 45, 55).map((rest) => `suiprivkey1${rest}`),
  joined(ID_CHARS, 35, 35).map((rest) => `AIza${rest}`),
  joined(ID_CHARS, 24, 40).map((rest) => `gsk_${rest.replace(/[_-]/g, "a")}`),
  joined(ID_CHARS, 24, 40).map((rest) => `sk-${rest}`),
  fc.tuple(joined("0123456789".split(""), 10, 10), joined(ID_CHARS, 35, 35)).map(([id, secret]) => `${id}:${secret}`),
  fc.tuple(joined(ID_CHARS, 10, 20), joined(ID_CHARS, 10, 20), joined(ID_CHARS, 10, 20)).map(([head, body, sign]) => `eyJ${head}.${body}.${sign}`),
);

export const lowSpecificitySecretArb: fc.Arbitrary<string> = fc.oneof(
  fc.tuple(joined(WORD_CHARS, 3, 8), joined(WORD_CHARS, 3, 8)).map(([user, host]) => `${user}@${host}.com`),
  joined("0123456789".split(""), 10, 12).map((digits) => `+${digits}`),
  joined("123456789".split(""), 10, 12).map((digits) => `0${digits}`),
);

export const secretArb: fc.Arbitrary<string> = fc.oneof(highSpecificitySecretArb, lowSpecificitySecretArb);
