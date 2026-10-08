import { describe, expect, it } from "vitest";
import { plannedPlatforms } from "../../src/platform/runtime.js";
import { PLATFORMS } from "../../src/platform/platform.js";
import { loadConfig } from "../../src/config.js";

const complete: Record<string, string> = {
  MEMWAL_SERVER_URL: "https://relayer.memory.walrus.xyz",
  MEMWAL_A_ACCOUNT_ID: `0x${"a".repeat(64)}`,
  MEMWAL_A_PRIVATE_KEY: `suiprivkey1${"1".repeat(40)}`,
  MEMWAL_B_ACCOUNT_ID: `0x${"b".repeat(64)}`,
  MEMWAL_B_PRIVATE_KEY: `suiprivkey1${"2".repeat(40)}`,
  TELEGRAM_MEMBER_BOT_TOKEN: `1234567890:${"A".repeat(35)}`,
  TELEGRAM_MANAGER_BOT_TOKEN: `1234567891:${"B".repeat(35)}`,
  MANAGER_TELEGRAM_IDS: "4242",
  COMMUNITY_CHAT_ID: "-1001234567890",
  COMMUNITY_KEY: "c1",
  NAMESPACE_SECRET: "f".repeat(64),
  GEMINI_API_KEY: `AIza${"c".repeat(35)}`,
  GEMINI_MODEL: "gemini-3.8-flash",
  GEMINI_FALLBACK_MODEL: "gemini-3.5-flash",
  GROQ_API_KEY: `gsk_${"d".repeat(40)}`,
  GROQ_MODEL: "qwen/qwen3.8-27b",
};

describe("a platform that is switched off never starts", () => {
  it("plans to start only the platforms that are both enabled and configured", () => {
    const planned = plannedPlatforms({ telegram: true, discord: false, slack: false }, { telegram: true, discord: true, slack: true });
    expect(planned.filter((plan) => plan.willStart).map((plan) => plan.platform)).toEqual(["telegram"]);
    expect(planned.find((plan) => plan.platform === "discord")?.willStart).toBe(false);
  });

  it("does not start an enabled platform that has no settings", () => {
    const planned = plannedPlatforms({ telegram: true, discord: true, slack: true }, { telegram: true, discord: false, slack: false });
    expect(planned.filter((plan) => plan.willStart).map((plan) => plan.platform)).toEqual(["telegram"]);
  });

  it("covers every platform the code knows about", () => {
    const planned = plannedPlatforms({ telegram: true, discord: true, slack: true }, { telegram: true, discord: true, slack: true });
    expect(planned.map((plan) => plan.platform)).toEqual([...PLATFORMS]);
    expect(planned.every((plan) => plan.willStart)).toBe(true);
  });

  it("leaves a disabled platform's settings null in the config, so nothing can be constructed from them", () => {
    const loaded = loadConfig(complete);
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect(loaded.config.discord).toBeNull();
    expect(loaded.config.slack).toBeNull();
    expect(loaded.config.telegram).not.toBeNull();
    const configured = { telegram: loaded.config.telegram !== null, discord: loaded.config.discord !== null, slack: loaded.config.slack !== null };
    expect(plannedPlatforms(loaded.config.enabled, configured).filter((plan) => plan.willStart).map((plan) => plan.platform)).toEqual(["telegram"]);
  });

  it("defaults telegram on and the new platforms off", () => {
    const loaded = loadConfig(complete);
    expect(loaded.ok && loaded.config.enabled).toEqual({ telegram: true, discord: false, slack: false });
  });
});
