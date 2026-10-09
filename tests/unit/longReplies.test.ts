import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { messageParts, sendFailedNotice } from "../../src/core/messageParts.js";
import { reasonOf, sendInParts } from "../../src/bots/shared/sending.js";
import { Log } from "../../src/bots/shared/log.js";
import { TELEGRAM_MESSAGE_LIMIT, THEMES_SHOWN } from "../../src/core/tuning.js";
import { MANAGER_ID, managerHarness, type ManagerHarness } from "../support/managerHarness.js";

function manyThemes(field: ManagerHarness, count: number): void {
  for (let index = 0; index < count; index += 1) {
    const themeId = `t-${String(index).padStart(3, "0")}`;
    const label = `theme number ${index} about something a member raised at length`;
    field.pipeline.commit([{ draft: { type: "THEME_CREATED", themeId, label }, namespaces: [{ kind: "themes" }] }], { chatId: "-100", messageId: "1" }, field.clock.now());
    for (let item = 0; item < 3; item += 1) {
      field.pipeline.commit(
        [{ draft: { type: "ITEM_OPENED", itemId: `i-${index}-${item}`, kind: "bug", themeId, text: `something went wrong in theme ${index} case ${item}` }, namespaces: [{ kind: "items" }] }],
        { chatId: "-100", messageId: "2" },
        field.clock.now(),
      );
    }
  }
}

describe("a reply longer than the chat app allows arrives in parts", () => {
  it("keeps every part inside the limit and loses no line", () => {
    const lines = Array.from({ length: 400 }, (_, index) => `line ${index} with enough words on it to add up to something long`);
    const text = lines.join("\n");
    expect(text.length).toBeGreaterThan(TELEGRAM_MESSAGE_LIMIT);
    const parts = messageParts(text);
    expect(parts.length).toBeGreaterThan(1);
    for (const part of parts) expect(part.length).toBeLessThanOrEqual(TELEGRAM_MESSAGE_LIMIT);
    expect(parts.join("\n")).toBe(text);
  });

  it("sends a short reply as one message", () => {
    expect(messageParts("just this")).toEqual(["just this"]);
  });

  it("splits at a line boundary, never mid-line, while a line fits", () => {
    const text = Array.from({ length: 200 }, (_, index) => `${index}: a line of moderate length that fits on its own`).join("\n");
    for (const part of messageParts(text)) {
      for (const line of part.split("\n")) expect(line).toMatch(/^\d+: a line of moderate length that fits on its own$/);
    }
  });

  it("breaks a single line that is itself too long, at a space where it can", () => {
    const long = `${"word ".repeat(2000)}end`;
    const parts = messageParts(long);
    expect(parts.length).toBeGreaterThan(1);
    for (const part of parts) expect(part.length).toBeLessThanOrEqual(TELEGRAM_MESSAGE_LIMIT);
    expect(parts.join(" ").replace(/\s+/g, " ").trim()).toBe(long.replace(/\s+/g, " ").trim());
  });

  it("never produces a part over the limit, for any text", () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 900 }), fc.integer({ min: 10, max: 200 }), (text, limit) => {
        for (const part of messageParts(text, limit)) expect(part.length).toBeLessThanOrEqual(limit);
      }),
      { numRuns: 200 },
    );
  });
});

describe("a reply that cannot be sent is never silence", () => {
  function recorder(): { readonly lines: string[]; readonly log: Log } {
    const lines: string[] = [];
    return { lines, log: new Log("test", (line) => lines.push(line)) };
  }

  it("tells the manager why, in plain words, and logs it", async () => {
    const { lines, log } = recorder();
    const said: string[] = [];
    const attempt = await sendInParts(
      "the reply nobody will see",
      async (part) => {
        if (part === "the reply nobody will see") throw new Error("Call to 'sendMessage' failed! (400: Bad Request: message is too long)");
        said.push(part);
      },
      log,
      "manager",
    );
    expect(attempt.failed).toBe(true);
    expect(said).toEqual([sendFailedNotice("(400: Bad Request: message is too long)")]);
    expect(lines.join("\n")).toContain("reply_send_failed");
    expect(lines.join("\n")).toContain("bot=manager");
  });

  it("logs again rather than throwing when even the fallback cannot be sent", async () => {
    const { lines, log } = recorder();
    const attempt = await sendInParts(
      "nothing gets through",
      async () => {
        throw new Error("network down");
      },
      log,
      "member",
    );
    expect(attempt.failed).toBe(true);
    expect(lines.join("\n")).toContain("reply_fallback_failed");
  });

  it("strips grammY's wrapper so the member reads the reason, not the call", () => {
    expect(reasonOf(new Error("Call to 'sendMessage' failed! (400: Bad Request: message is too long)"))).toBe("(400: Bad Request: message is too long)");
    expect(reasonOf("plain string")).toBe("plain string");
  });

  it("records the split when a reply went out in parts", async () => {
    const { lines, log } = recorder();
    const attempt = await sendInParts("a\nb\nc\nd", async () => undefined, log, "manager", 3);
    expect(attempt.parts).toBeGreaterThan(1);
    expect(attempt.failed).toBe(false);
    expect(lines.join("\n")).toContain("reply_split");
  });
});

describe("/themes stays inside one message and names the busiest first", () => {
  it("caps the list and says how many more there are", async () => {
    const field = managerHarness();
    manyThemes(field, THEMES_SHOWN + 7);
    const said = await field.ask("/themes");
    expect(said).toContain(`Page 1 of ${Math.ceil((THEMES_SHOWN + 7) / THEMES_SHOWN)}`);
    expect(said.split("\n").filter((line) => line.includes("item(s)") && !line.includes("open,"))).toHaveLength(THEMES_SHOWN);
  });

  it("says nothing about pages when everything fits", async () => {
    const field = managerHarness();
    manyThemes(field, 3);
    const said = await field.ask("/themes");
    expect(said).not.toContain("Page 1 of");
  });

  it("puts the theme with the most items and most affected members first", async () => {
    const field = managerHarness();
    for (const [themeId, label, items] of [["t-small", "quiet theme", 1], ["t-big", "busy theme", 5]] as const) {
      field.pipeline.commit([{ draft: { type: "THEME_CREATED", themeId, label }, namespaces: [{ kind: "themes" }] }], { chatId: "-100", messageId: "1" }, field.clock.now());
      for (let item = 0; item < items; item += 1) {
        field.pipeline.commit(
          [{ draft: { type: "ITEM_OPENED", itemId: `i-${themeId}-${item}`, kind: "bug", themeId, text: "something broke" }, namespaces: [{ kind: "items" }] }],
          { chatId: "-100", messageId: "2" },
          field.clock.now(),
        );
      }
    }
    const said = await field.ask("/themes");
    expect(said.indexOf("busy theme")).toBeLessThan(said.indexOf("quiet theme"));
  });

  it("would have sent the old uncapped reply in parts rather than failing", async () => {
    const field = managerHarness();
    manyThemes(field, 60);
    const said = await field.ask("/themes");
    for (const part of messageParts(said)) expect(part.length).toBeLessThanOrEqual(TELEGRAM_MESSAGE_LIMIT);
  });
});

describe("member text with characters a markup parser would choke on", () => {
  it("is sent as written, because no reply asks for a parse mode", async () => {
    const field = managerHarness();
    field.pipeline.commit(
      [
        { draft: { type: "THEME_CREATED", themeId: "t-odd", label: "_*[]() and `backticks`" }, namespaces: [{ kind: "themes" }] },
        { draft: { type: "ITEM_OPENED", itemId: "i-odd", kind: "bug", themeId: "t-odd", text: "crash on *tap* [here](x) _now_" }, namespaces: [{ kind: "items" }] },
      ],
      { chatId: "-100", messageId: "1" },
      field.clock.now(),
    );
    const said = await field.ask("/themes");
    expect(said).toContain("_*[]() and `backticks`");
    expect(messageParts(said)).toEqual([said]);
  });

  it("manager id is not in the log line for a failed send", async () => {
    const lines: string[] = [];
    const log = new Log("test", (line) => lines.push(line));
    await sendInParts("x", async () => {
      throw new Error("nope");
    }, log, "manager");
    expect(lines.join("\n")).not.toContain(String(MANAGER_ID));
  });
});
