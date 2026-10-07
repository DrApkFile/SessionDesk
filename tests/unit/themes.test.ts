import { describe, expect, it } from "vitest";
import { UNLABELLED_THEME, matchTheme, normalizeThemeLabel, themeLabelFor } from "../../src/core/themes.js";

const themes = [
  { themeId: "t1", label: "Android login" },
  { themeId: "t2", label: "payments" },
];

describe("onlyMatch theme labels", () => {
  it("joins an existing theme on a normalized exact match", () => {
    expect(matchTheme(themes, "  android   LOGIN!  ")).toEqual({ kind: "one", value: themes[0] });
  });

  it("reports none for a label it has never seen so a new theme is created", () => {
    expect(matchTheme(themes, "onboarding")).toEqual({ kind: "none" });
  });

  it("never picks between two candidates", () => {
    const twins = [...themes, { themeId: "t3", label: "android login" }];
    expect(matchTheme(twins, "android login")).toEqual({ kind: "many", count: 2 });
  });

  it("does not match on a partial label", () => {
    expect(matchTheme(themes, "login").kind).toBe("none");
    expect(matchTheme(themes, "android login fails").kind).toBe("none");
  });

  it("normalizes case, spacing and punctuation only", () => {
    expect(normalizeThemeLabel("  Android, Login!  ")).toBe("android login");
    expect(normalizeThemeLabel("payments")).toBe("payments");
  });

  it("falls back to one named theme when the model gives no usable label", () => {
    expect(themeLabelFor(undefined)).toBe(UNLABELLED_THEME);
    expect(themeLabelFor("   ")).toBe(UNLABELLED_THEME);
    expect(themeLabelFor("!!!")).toBe(UNLABELLED_THEME);
    expect(themeLabelFor(" Android Login ")).toBe("Android Login");
  });
});
