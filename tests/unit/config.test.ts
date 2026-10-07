import { describe, expect, it } from "vitest";
import { configSummary, loadConfig } from "../../src/config.js";
import { findSecrets } from "../../src/core/redactor.js";

const complete: Record<string, string> = {
  MEMWAL_SERVER_URL: "https://relayer.memory.walrus.xyz",
  MEMWAL_A_ACCOUNT_ID: `0x${"a".repeat(64)}`,
  MEMWAL_A_PRIVATE_KEY: `suiprivkey1${"1".repeat(40)}`,
  MEMWAL_B_ACCOUNT_ID: `0x${"b".repeat(64)}`,
  MEMWAL_B_PRIVATE_KEY: `suiprivkey1${"2".repeat(40)}`,
  TELEGRAM_MEMBER_BOT_TOKEN: `1234567890:${"A".repeat(35)}`,
  TELEGRAM_MANAGER_BOT_TOKEN: `1234567891:${"B".repeat(35)}`,
  MANAGER_TELEGRAM_IDS: "4242,4343",
  COMMUNITY_CHAT_ID: "-1001234567890",
  COMMUNITY_KEY: "c1",
  NAMESPACE_SECRET: "f".repeat(64),
  GEMINI_API_KEY: `AIza${"c".repeat(35)}`,
  GEMINI_MODEL: "gemini-3.8-flash",
  GEMINI_FALLBACK_MODEL: "gemini-3.5-flash",
  GROQ_API_KEY: `gsk_${"d".repeat(40)}`,
  GROQ_MODEL: "qwen/qwen3.8-27b",
};

describe("config", () => {
  it("reads a complete environment into typed settings", () => {
    const loaded = loadConfig(complete);
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect(loaded.config.telegram.managerIds).toEqual([4242, 4343]);
    expect(loaded.config.telegram.communityChatId).toBe(-1001234567890);
    expect(loaded.config.community.key).toBe("c1");
    expect(loaded.config.groq.model).toBe("qwen/qwen3.8-27b");
  });

  it("names every missing variable instead of starting with a blank value", () => {
    const loaded = loadConfig({ COMMUNITY_KEY: "c1" });
    expect(loaded.ok).toBe(false);
    if (loaded.ok) return;
    expect(loaded.problems).toHaveLength(15);
    expect(loaded.problems.join(" ")).toContain("NAMESPACE_SECRET");
  });

  it("treats an empty or whitespace value as missing", () => {
    const loaded = loadConfig({ ...complete, GROQ_API_KEY: "   " });
    expect(loaded.ok).toBe(false);
    if (!loaded.ok) expect(loaded.problems.join(" ")).toContain("GROQ_API_KEY");
  });

  it("refuses the placeholder namespace secret from .env.example", () => {
    const loaded = loadConfig({ ...complete, NAMESPACE_SECRET: "generate-with: openssl rand -hex 32" });
    expect(loaded.ok).toBe(false);
    if (!loaded.ok) expect(loaded.problems.join(" ")).toContain("real random secret");
  });

  it("refuses a malformed bot token, account id, community key and manager list", () => {
    for (const [key, value] of [
      ["TELEGRAM_MEMBER_BOT_TOKEN", "not-a-token"],
      ["MEMWAL_A_ACCOUNT_ID", "a".repeat(64)],
      ["COMMUNITY_KEY", "Community One"],
      ["MANAGER_TELEGRAM_IDS", "4242, 4343"],
      ["MEMWAL_SERVER_URL", "relayer.memory.walrus.xyz"],
    ] as const) {
      const loaded = loadConfig({ ...complete, [key]: value });
      expect(loaded.ok).toBe(false);
      if (!loaded.ok) expect(loaded.problems.join(" ")).toContain(key);
    }
  });

  it("shortens the public account ids so the log redactor does not hide them", () => {
    const loaded = loadConfig(complete);
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    const summary = configSummary(loaded.config);
    expect(summary.accountA).toBe(`0x${"a".repeat(8)}..aaaaaa`);
    expect(findSecrets(JSON.stringify(summary))).toEqual([]);
  });

  it("keeps keys and secrets out of the startup summary", () => {
    const loaded = loadConfig(complete);
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    const summary = JSON.stringify(configSummary(loaded.config));
    for (const secret of [complete.MEMWAL_A_PRIVATE_KEY, complete.MEMWAL_B_PRIVATE_KEY, complete.GEMINI_API_KEY, complete.GROQ_API_KEY, complete.NAMESPACE_SECRET, complete.TELEGRAM_MEMBER_BOT_TOKEN]) {
      expect(summary).not.toContain(secret);
    }
  });
});
