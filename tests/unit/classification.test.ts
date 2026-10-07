import { describe, expect, it } from "vitest";
import { UNCLASSIFIED, readClassification, readClassificationJson } from "../../src/core/classification.js";

describe("F09 reading model classifications", () => {
  it("accepts the strict shape the prompt asks for", () => {
    const read = readClassification({ kind: "bug", themeLabel: "android login" });
    expect(read).toEqual({ classification: { kind: "bug", themeLabel: "android login" }, wellFormed: true, problems: [] });
  });

  it("falls back to other for an unknown kind, an extra field or a wrong type", () => {
    for (const payload of [{ kind: "complaint" }, { kind: "bug", severity: "high" }, { kind: "bug", themeLabel: 7 }, {}, null, "bug", [{ kind: "bug" }]]) {
      const read = readClassification(payload);
      expect(read.wellFormed).toBe(false);
      expect(read.classification).toEqual(UNCLASSIFIED);
      expect(read.problems.length).toBeGreaterThan(0);
    }
  });

  it("falls back to other for text that is not JSON at all", () => {
    const read = readClassificationJson("```json {kind: bug} ```");
    expect(read.wellFormed).toBe(false);
    expect(read.classification).toEqual(UNCLASSIFIED);
    expect(read.problems).toEqual(["not JSON"]);
  });

  it("reads a profile fact only in the declared shape", () => {
    expect(readClassificationJson('{"kind":"profile","profile":{"field":"skill","value":"figma"}}').wellFormed).toBe(true);
    expect(readClassificationJson('{"kind":"profile","profile":{"field":"favourite_colour","value":"blue"}}').wellFormed).toBe(false);
  });
});
