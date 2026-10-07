import { describe, expect, it } from "vitest";
import { ERRORS } from "../../src/core/errors.js";
import { SUMMARY_HEADER } from "../../src/bots/manager/summary.js";
import { MANAGER_ID, NOTES_NAMESPACE, OUTSIDER_ID, managerHarness, type ManagerHarness } from "../support/managerHarness.js";

const MEMBER_ID = 42_000_001;

function openItem(field: ManagerHarness, itemId = "i-abc123", text = "android login fails"): string {
  const memberH = field.memberHashOf(MEMBER_ID);
  field.directory.remember({ userId: MEMBER_ID, memberH, userName: "ada" }, field.clock.now());
  field.pipeline.commit(
    [
      { draft: { type: "THEME_CREATED", themeId: "t-login", label: "android login" }, namespaces: [{ kind: "themes" }] },
      { draft: { type: "ITEM_OPENED", itemId, kind: "bug", themeId: "t-login", text }, namespaces: [{ kind: "member", memberH }, { kind: "items" }] },
    ],
    { chatId: -100, messageId: 1 },
    field.clock.now(),
  );
  return memberH;
}

describe("F14 only an allowlisted manager is obeyed", () => {
  it("refuses everyone else and changes nothing", async () => {
    const field = managerHarness();
    openItem(field);
    const refused = await field.ask("/fixed i-abc123", { userId: OUTSIDER_ID });
    expect(refused).toContain(ERRORS.NOT_MANAGER.message);
    expect(field.cache.state().items.get("i-abc123")?.status).toBe("reported");
    expect(field.logLines.join("\n")).toContain("not_manager");
  });

  it("ignores other bots entirely", async () => {
    const field = managerHarness();
    const action = await field.service.handle(field.message({ isBot: true, text: "/owed" }));
    expect(action.kind).toBe("silent");
  });
});

describe("status commands move an item through the state machine", () => {
  it("walks reported to acknowledged to fixed to verified", async () => {
    const field = managerHarness();
    openItem(field);
    expect(await field.ask("/ack i-abc123")).toContain("is now acknowledged (was reported)");
    expect(field.cache.state().items.get("i-abc123")?.status).toBe("acknowledged");
    expect(await field.ask("/fixed i-abc123")).toContain("is now fixed");
    expect(await field.ask("/verify i-abc123")).toContain("is now verified");
    expect(field.cache.state().items.get("i-abc123")?.status).toBe("verified");
  });

  it("refuses a transition the state machine does not allow and changes nothing", async () => {
    const field = managerHarness();
    openItem(field);
    const refused = await field.ask("/verify i-abc123");
    expect(refused).toContain("is reported, so it cannot become verified");
    expect(refused).toContain(ERRORS.INVALID_TRANSITION.message);
    expect(field.cache.state().items.get("i-abc123")?.status).toBe("reported");
  });

  it("reopens a fixed item, which is the one backward edge", async () => {
    const field = managerHarness();
    openItem(field);
    await field.ask("/ack i-abc123");
    await field.ask("/fixed i-abc123");
    expect(await field.ask("/reopen i-abc123")).toContain("is now reported (was fixed)");
  });

  it("accepts a shortened item id but refuses one that matches two items", async () => {
    const field = managerHarness();
    openItem(field, "i-abc123");
    expect(await field.ask("/ack i-abc")).toContain("is now acknowledged");
    openItem(field, "i-abcdef", "another login bug");
    const ambiguous = await field.ask("/fixed i-abc");
    expect(ambiguous).toContain(ERRORS.AMBIGUOUS_TARGET.message);
    expect(ambiguous).toContain("matches 2 items");
  });

  it("says it has no such item rather than guessing", async () => {
    const field = managerHarness();
    expect(await field.ask("/fixed i-nothing")).toContain(ERRORS.UNKNOWN_ITEM.message);
  });

  it("names who filed the item so the manager knows who to tell", async () => {
    const field = managerHarness();
    openItem(field);
    expect(await field.ask("/ack i-abc123")).toContain("Filed for @ada");
  });
});

describe("promises", () => {
  it("promises against an item to the member who filed it", async () => {
    const field = managerHarness();
    const memberH = openItem(field);
    const made = await field.ask("/promise i-abc123 2026-10-09 we will check by thursday");
    expect(made).toContain("to @ada");
    expect(made).toContain("by 2026-10-09");
    const promise = [...field.cache.state().promises.values()][0];
    expect(promise?.memberH).toBe(memberH);
    expect(promise?.itemId).toBe("i-abc123");
    expect(promise?.byManagerId).toBe(MANAGER_ID);
  });

  it("refuses a date in the past, too far ahead, or not a date", async () => {
    const field = managerHarness();
    openItem(field);
    for (const raw of ["2026-10-07", "2026-12-25", "thursday"]) {
      const refused = await field.ask(`/promise i-abc123 ${raw} we will look`);
      expect(refused).toContain(ERRORS.INVALID_DATE.message);
    }
    expect(field.cache.state().promises.size).toBe(0);
  });

  it("lists what is owed with overdue first and marks one done", async () => {
    const field = managerHarness();
    openItem(field);
    await field.ask("/promise i-abc123 2026-10-09 thursday check");
    const owed = await field.ask("/owed");
    expect(owed).toContain("1 open promise(s)");
    expect(owed).toContain("due 2026-10-09");
    const promiseId = [...field.cache.state().promises.keys()][0] ?? "";
    expect(await field.ask(`/done ${promiseId}`)).toContain("is done");
    expect(field.cache.state().promises.get(promiseId)?.state).toBe("fulfilled");
    expect(await field.ask("/owed")).toContain("Nothing is owed");
  });

  it("refuses to fulfil the same promise twice", async () => {
    const field = managerHarness();
    openItem(field);
    await field.ask("/promise i-abc123 2026-10-09 thursday check");
    const promiseId = [...field.cache.state().promises.keys()][0] ?? "";
    await field.ask(`/done ${promiseId}`);
    expect(await field.ask(`/done ${promiseId}`)).toContain("already fulfilled");
  });

  it("shows an overdue promise as overdue", async () => {
    const field = managerHarness();
    const memberH = openItem(field);
    field.pipeline.commit(
      [{ draft: { type: "PROMISE_MADE", promiseId: "p-old", memberH, due: "2026-10-01", text: "last week", byManagerId: MANAGER_ID }, namespaces: [{ kind: "member", memberH }] }],
      { chatId: -100, messageId: 2 },
      field.clock.now(),
    );
    await field.ask("/promise i-abc123 2026-10-09 thursday check");
    const owed = await field.ask("/owed");
    expect(owed.indexOf("OVERDUE")).toBeLessThan(owed.indexOf("due 2026-10-09"));
  });
});

describe("manager notes live on the separate account", () => {
  it("writes a note to the notes namespace and nowhere else", async () => {
    const field = managerHarness();
    const written = await field.ask("/note ada is our most reliable reporter");
    expect(written).toContain("manager-only account");
    await field.queue.settled();
    expect(field.notesMemory.stored.get(NOTES_NAMESPACE)).toHaveLength(1);
    expect([...field.community.stored.keys()]).toEqual([]);
    expect(field.cache.state().notes).toEqual([]);
    expect(field.notesCache.state().notes).toHaveLength(1);
  });

  it("reads notes back, newest first, and attaches one to a member", async () => {
    const field = managerHarness();
    const memberH = openItem(field);
    await field.ask("/note the community wants dark mode");
    await field.ask("/note @ada keeps finding real bugs", { messageId: 5 });
    const notes = await field.ask("/notes");
    expect(notes).toContain("2 manager note(s)");
    expect(notes).toContain("@ada");
    expect(field.notesCache.state().notes.some((note) => note.memberH === memberH)).toBe(true);
  });

  it("says plainly when there are no notes", async () => {
    expect(await managerHarness().ask("/notes")).toContain("No manager notes on record yet");
  });

  it("refuses a note carrying a secret", async () => {
    const field = managerHarness();
    expect(await field.ask("/note ada's login is ada@example.com")).toContain("contains a secret");
    expect(field.notesCache.state().notes).toEqual([]);
  });
});

describe("reports", () => {
  it("shows themes with their item ids", async () => {
    const field = managerHarness();
    openItem(field);
    const themes = await field.ask("/themes");
    expect(themes).toContain("android login: 1 item(s)");
    expect(themes).toContain("i-abc123");
  });

  it("shows one member's card including manager notes", async () => {
    const field = managerHarness();
    openItem(field);
    await field.ask("/note @ada is reliable");
    const card = await field.ask("/member @ada");
    expect(card).toContain("MEMBER FACTS");
    expect(card).toContain("status=reported");
    expect(card).toContain("manager notes:");
    expect(card).toContain("is reliable");
  });

  it("refuses a member it has not seen and suggests replying instead", async () => {
    const field = managerHarness();
    expect(await field.ask("/member @nobody")).toContain("I have not seen @nobody since I started");
  });

  it("finds a member by the reply when no name is given", async () => {
    const field = managerHarness();
    openItem(field);
    const card = await field.ask("/member", { replyToUserId: MEMBER_ID });
    expect(card).toContain("MEMBER FACTS");
  });

  it("shows status with the queue, budget and sequence", async () => {
    const status = await managerHarness().ask("/status");
    expect(status).toContain("SessionDesk status");
    expect(status).toContain("seqNext: 7");
    expect(status).toContain("memory: booted=");
  });

  it("shows helpers once anyone has points", async () => {
    const field = managerHarness();
    const memberH = openItem(field);
    field.pipeline.commit([{ draft: { type: "CONTRIBUTION", kind: "helped" }, namespaces: [{ kind: "member", memberH }] }], { chatId: -100, messageId: 3 }, field.clock.now());
    expect(await field.ask("/helpers")).toContain("@ada (");
  });
});

describe("the ambassador tier", () => {
  it("grants and revokes it, and refuses the same twice", async () => {
    const field = managerHarness();
    const memberH = openItem(field);
    expect(await field.ask("/ambassador @ada")).toContain("is now an ambassador");
    expect(field.cache.state().members.get(memberH)?.tier).toBe("ambassador");
    expect(await field.ask("/ambassador @ada")).toContain("already an ambassador");
    expect(await field.ask("/unambassador @ada")).toContain("no longer an ambassador");
    expect(field.cache.state().members.get(memberH)?.tier).toBe("new");
    expect(await field.ask("/unambassador @ada")).toContain("holds no granted tier");
  });
});

describe("free text is answered from the code-built summary only", () => {
  it("answers with what the summary holds", async () => {
    const field = managerHarness({ answer: "One item is reported and nothing is owed." });
    openItem(field);
    const answer = await field.ask("what do I owe anyone?");
    expect(answer).toBe("One item is reported and nothing is owed.");
    expect(field.service.summary()).toContain(SUMMARY_HEADER);
    expect(field.service.summary()).toContain("i-abc123");
  });

  it("drops an answer that invents a status and hands over the summary instead", async () => {
    const field = managerHarness({ answer: "Everything is verified and closed." });
    openItem(field);
    const answer = await field.ask("how are we doing?");
    expect(answer).toContain(ERRORS.MODEL_OUTPUT_REFUSED.message);
    expect(answer).toContain(SUMMARY_HEADER);
    expect(field.logLines.join("\n")).toContain("manager_reply_refused");
  });

  it("hands over the summary when qwen is down", async () => {
    const field = managerHarness({ modelStatus: 503 });
    openItem(field);
    const answer = await field.ask("what is going on?");
    expect(answer).toContain(ERRORS.MODEL_UNAVAILABLE.message);
    expect(answer).toContain(SUMMARY_HEADER);
  });

  it("shows the command list for an unknown command", async () => {
    expect(await managerHarness().ask("/nonsense")).toContain("Manager commands:");
  });
});
