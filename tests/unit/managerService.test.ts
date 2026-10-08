import { describe, expect, it } from "vitest";
import { ERRORS } from "../../src/core/errors.js";
import { SUMMARY_HEADER } from "../../src/bots/manager/summary.js";
import { WEEKLY_HEADER } from "../../src/bots/manager/weekly.js";
import { MANAGER_ID, NOTES_NAMESPACE, OUTSIDER_ID, managerHarness, type ManagerHarness } from "../support/managerHarness.js";

const MEMBER_ID = 42_000_001;

function openItem(field: ManagerHarness, itemId = "i-abc123", text = "android login fails"): string {
  const memberH = field.memberHashOf(MEMBER_ID);
  field.directory.remember({ platform: "telegram", userId: String(MEMBER_ID), memberH, userName: "ada" }, field.clock.now());
  field.pipeline.commit(
    [
      { draft: { type: "THEME_CREATED", themeId: "t-login", label: "android login" }, namespaces: [{ kind: "themes" }] },
      { draft: { type: "ITEM_OPENED", itemId, kind: "bug", themeId: "t-login", text }, namespaces: [{ kind: "member", memberH }, { kind: "items" }] },
    ],
    { chatId: "-100", messageId: "1" },
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
    expect(promise?.byManagerId).toBe(String(MANAGER_ID));
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
      [{ draft: { type: "PROMISE_MADE", promiseId: "p-old", memberH, due: "2026-10-01", text: "last week", byManagerId: String(MANAGER_ID) }, namespaces: [{ kind: "member", memberH }] }],
      { chatId: "-100", messageId: "2" },
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
    field.pipeline.commit([{ draft: { type: "CONTRIBUTION", kind: "helped" }, namespaces: [{ kind: "member", memberH }] }], { chatId: "-100", messageId: "3" }, field.clock.now());
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

describe("the weekly report is drafted from counted data", () => {
  it("shows the draft and the data it was written from", async () => {
    const field = managerHarness({ answer: "One bug was filed this week and it is reported. Nothing is overdue." });
    openItem(field);
    const report = await field.ask("/report");
    expect(report).toContain("One bug was filed this week");
    expect(report).toContain(WEEKLY_HEADER);
    expect(report).toContain("items filed in the window: 1");
    expect(report).toContain("Draft only, from the counted data below");
  });

  it("refuses a draft that invents a status and hands over the data instead", async () => {
    const field = managerHarness({ answer: "Great week: everything was verified and shipped." });
    openItem(field);
    const report = await field.ask("/report");
    expect(report).toContain(ERRORS.MODEL_OUTPUT_REFUSED.message);
    expect(report).toContain(WEEKLY_HEADER);
    expect(report).not.toContain("verified and shipped");
  });

  it("hands over the data when qwen is down", async () => {
    const field = managerHarness({ modelStatus: 503 });
    openItem(field);
    const report = await field.ask("/report");
    expect(report).toContain(ERRORS.MODEL_UNAVAILABLE.message);
    expect(report).toContain(WEEKLY_HEADER);
  });

  it("counts an empty week honestly rather than padding it", async () => {
    const field = managerHarness({ answer: "Nothing was filed this week." });
    const report = await field.ask("/report");
    expect(report).toContain("items filed in the window: 0");
    expect(report).toContain("promises made in the window: 0");
  });

  it("offers /report in the command list", async () => {
    expect(await managerHarness().ask("/nonsense")).toContain("/report");
  });
});

function recordAnswer(field: ManagerHarness, answerId = "a-1", questionText = "how do I reset my password?"): void {
  field.pipeline.commit(
    [{ draft: { type: "ANSWER", answerId, questionText, answerText: "Open settings, then Account, then Reset.", answeredBy: "manager", themeId: "t-login" }, namespaces: [{ kind: "answers" }] }],
    { chatId: "-100", messageId: "50" },
    field.clock.now(),
  );
}

describe("the manager curates the community's answers", () => {
  it("lists them with who answered, when, and whether they are still reused", async () => {
    const field = managerHarness();
    recordAnswer(field);
    const listed = await field.ask("/answers");
    expect(listed).toContain("1 answer(s)");
    expect(listed).toContain("a-1 active by manager");
    expect(listed).toContain("Q: how do I reset my password?");
    expect(listed).toContain("A: Open settings");
  });

  it("says plainly when there are none", async () => {
    expect(await managerHarness().ask("/answers")).toContain("No answers on record yet");
  });

  it("retires one so it is never reused again, and refuses to retire it twice", async () => {
    const field = managerHarness();
    recordAnswer(field);
    expect(await field.ask("/retire a-1")).toContain("is retired and will not be reused");
    expect(field.cache.state().answers.get("a-1")?.state).toBe("retired");
    expect(await field.ask("/retire a-1")).toContain("already retired");
    expect(await field.ask("/answers")).toContain("a-1 RETIRED");
  });

  it("refuses an id it does not hold, or one that matches two answers", async () => {
    const field = managerHarness();
    recordAnswer(field, "a-1");
    recordAnswer(field, "a-12");
    expect(await field.ask("/retire a-nothing")).toContain(ERRORS.UNKNOWN_ITEM.message);
    expect(await field.ask("/retire a-1")).toContain("is retired");
    expect(await field.ask("/retire a-")).toContain(ERRORS.AMBIGUOUS_TARGET.message);
  });

  it("refuses a non-manager", async () => {
    const field = managerHarness();
    recordAnswer(field);
    expect(await field.ask("/retire a-1", { userId: OUTSIDER_ID })).toContain(ERRORS.NOT_MANAGER.message);
    expect(field.cache.state().answers.get("a-1")?.state).toBe("active");
  });

  it("offers both commands in the list", async () => {
    const listed = await managerHarness().ask("/nonsense");
    expect(listed).toContain("/answers");
    expect(listed).toContain("/retire");
  });
});

describe("affected counts are visible to the manager", () => {
  function affect(field: ManagerHarness, itemId: string, memberH: string): void {
    field.pipeline.commit([{ draft: { type: "ITEM_AFFECTS", itemId, memberH }, namespaces: [{ kind: "items" }] }], { chatId: "-100", messageId: "60" }, field.clock.now());
  }

  it("/themes shows how many extra members an item affects", async () => {
    const field = managerHarness();
    openItem(field);
    affect(field, "i-abc123", "b".repeat(24));
    affect(field, "i-abc123", "c".repeat(24));
    expect(await field.ask("/themes")).toContain("2 extra member(s) affected");
  });

  it("/member shows the items that also affect them", async () => {
    const field = managerHarness();
    const memberH = openItem(field);
    affect(field, "i-abc123", "b".repeat(24));
    const other = managerHarness();
    openItem(other);
    affect(other, "i-abc123", memberH);
    expect(await other.ask("/member @ada")).toContain("also affected by: i-abc123");
  });

  it("the facts sheet tells the member how many others are affected", async () => {
    const field = managerHarness();
    openItem(field);
    affect(field, "i-abc123", "b".repeat(24));
    expect(await field.ask("/member @ada")).toContain("1 other member(s) affected");
  });
});

describe("/member works on a reply after a restart, without the member speaking first", () => {
  it("finds the member by hashing the replied-to id, not by the in-memory directory", async () => {
    const field = managerHarness();
    openItem(field);
    const fresh = managerHarness();
    fresh.cache.replaceAll(field.cache.lines());
    expect(fresh.directory.size()).toBe(0);
    const card = await fresh.ask("/member", { replyToUserId: MEMBER_ID });
    expect(card).toContain("MEMBER FACTS");
    expect(card).toContain("status=reported");
    expect(card).toContain(fresh.memberHashOf(MEMBER_ID).slice(0, 8));
  });
});
