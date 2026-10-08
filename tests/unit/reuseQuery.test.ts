import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { contentWords, expandedContractions, reuseQueryOf, strippedOfNames } from "../../src/core/reuseQuery.js";
import { MIN_REUSE_CONTENT_WORDS } from "../../src/core/tuning.js";

describe("a question is reduced to its own words before anything is matched", () => {
  it("removes the bot's handle, any other handle, and the display names it knows", () => {
    expect(strippedOfNames("@sdmemberbot what's Kenne fixed?", ["sdmemberbot"], ["Kenne"])).toBe("what's fixed?");
    expect(strippedOfNames("hey @someone_else can you help", ["sdmemberbot"], [])).toBe("hey can you help");
  });

  it("leaves a question alone when it names nobody", () => {
    expect(strippedOfNames("how do I reset my password", ["sdmemberbot"], ["Kenne"])).toBe("how do I reset my password");
  });

  it("does not strip a short display name that would eat ordinary words", () => {
    expect(strippedOfNames("can the app sync", ["sdmemberbot"], ["an"])).toBe("can the app sync");
  });

  it("survives a display name made of regular expression characters", () => {
    expect(() => strippedOfNames("what did kenne( fix", ["sdmemberbot"], ["kenne("])).not.toThrow();
    expect(strippedOfNames("ada.b said it works", ["sdmemberbot"], ["ada.b"])).toBe("said it works");
    expect(strippedOfNames("adaxb said it works", ["sdmemberbot"], ["ada.b"])).toBe("adaxb said it works");
  });

  it("never throws on any display name a platform could hand us", () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 40 }), fc.string({ maxLength: 60 }), (name, text) => {
        expect(() => strippedOfNames(text, ["sdmemberbot"], [name])).not.toThrow();
      }),
      { numRuns: 300 },
    );
  });

  it("reads a contraction as the words it stands for, so the question words are counted honestly", () => {
    expect(expandedContractions("what's")).toBe("what");
    expect(expandedContractions("doesn't")).toBe("does not");
    expect(contentWords("what's broken")).toEqual(["broken"]);
    expect(contentWords("doesn't the sync work")).toEqual(["sync", "work"]);
  });
});

describe("only a question with words of its own is worth matching", () => {
  it("skips the live false match that quoted two unrelated answers", () => {
    const query = reuseQueryOf("@sdmemberbot what's Kenne fixed?", ["sdmemberbot"], ["Kenne"]);
    expect(query.contentWords).toEqual(["fixed"]);
    expect(query.worthMatching).toBe(false);
  });

  it("keeps a real question, even a short one", () => {
    expect(reuseQueryOf("how do I reset my password", ["sdmemberbot"], []).contentWords).toEqual(["reset", "password"]);
    expect(reuseQueryOf("how do I reset my password", ["sdmemberbot"], []).worthMatching).toBe(true);
  });

  it("skips a greeting, a thanks and a bare mention", () => {
    for (const text of ["@sdmemberbot hi", "thanks!", "@sdmemberbot", "hey, please help me"]) {
      expect(reuseQueryOf(text, ["sdmemberbot"], []).worthMatching).toBe(false);
    }
  });

  it("needs at least the floor the tuning file sets", () => {
    expect(MIN_REUSE_CONTENT_WORDS).toBe(2);
    expect(reuseQueryOf("sync broken", ["sdmemberbot"], []).contentWords).toHaveLength(MIN_REUSE_CONTENT_WORDS);
    expect(reuseQueryOf("sync broken", ["sdmemberbot"], []).worthMatching).toBe(true);
  });
});
