import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { managerHarness } from "../support/managerHarness.js";

const FORBIDDEN_IN_MEMBER_BOT = ["accountB", "ACCOUNT_B", "MEMWAL_B_", "notesClient", "managerMemory"];
const MANAGER_ONLY_EVENTS = ["ITEM_STATUS", "PROMISE_MADE", "PROMISE_FULFILLED", "MANAGER_NOTE", "TIER_SET", "TIER_REVOKED"];
const MEMBER_BOT_DIRECTORIES = ["src/bots/member", "src/bots/shared"];

function sourceFiles(root: string): readonly string[] {
  let found: string[] = [];
  let names: readonly string[] = [];
  try {
    names = readdirSync(root);
  } catch {
    return [];
  }
  for (const name of names) {
    const path = join(root, name);
    if (statSync(path).isDirectory()) found = [...found, ...sourceFiles(path)];
    else if (path.endsWith(".ts")) found.push(path);
  }
  return found;
}

describe("F15 account B boundary", () => {
  it.each(MEMBER_BOT_DIRECTORIES)("has %s to scan, so this suite cannot pass by finding nothing", (directory) => {
    expect(existsSync(directory)).toBe(true);
    expect(sourceFiles(directory).length).toBeGreaterThan(0);
  });

  it("keeps every mention of the manager notes account inside src/bots/manager", () => {
    const offenders = sourceFiles("src/bots/member")
      .concat(sourceFiles("src/bots/shared"))
      .filter((path) => FORBIDDEN_IN_MEMBER_BOT.some((marker) => readFileSync(path, "utf8").includes(marker)));
    expect(offenders).toEqual([]);
  });

  it("constructs the account B client in src/bots/manager and nowhere else", () => {
    const offenders = sourceFiles("src")
      .filter((path) => !path.startsWith(join("src", "bots", "manager")))
      .filter((path) => path !== join("src", "config.ts"))
      .filter((path) => readFileSync(path, "utf8").includes("accountB"));
    expect(offenders).toEqual([join("src", "main.ts")]);
    expect(readFileSync(join("src", "main.ts"), "utf8")).toContain("createNotesMemory({ serverUrl: config.memwal.serverUrl, accountB: config.memwal.accountB");
    expect(readFileSync(join("src", "main.ts"), "utf8")).not.toContain("createMemwalClient({\n    key: config.memwal.accountB");
  });

  it("keeps the notes namespace out of every module except the manager bot and the namespace resolver", () => {
    const allowed = ["src/core/namespace.ts"];
    const offenders = sourceFiles("src")
      .filter((path) => !path.startsWith(join("src", "bots", "manager")))
      .filter((path) => !allowed.includes(path))
      .filter((path) => readFileSync(path, "utf8").includes('"notes"'));
    expect(offenders).toEqual([]);
  });

  it("never constructs a manager-only event in the member bot", () => {
    const offenders = sourceFiles("src/bots/member")
      .map((path) => ({ path, text: readFileSync(path, "utf8") }))
      .filter((file) => MANAGER_ONLY_EVENTS.some((type) => file.text.includes(`type: "${type}"`)))
      .map((file) => file.path);
    expect(offenders).toEqual([]);
  });

  it("constructs a memwal client in no core module", () => {
    const offenders = sourceFiles("src/core").filter((path) => readFileSync(path, "utf8").includes("memwal"));
    expect(offenders).toEqual([]);
  });
});

describe("the member bot cannot reach a manager note through the cache", () => {
  it("routes a note to its own cache, so the member cache never holds one", async () => {
    const field = managerHarness();
    await field.service.handle(field.message({ text: "/note something private" }));
    await field.queue.settled();
    expect(field.notesCache.state().notes).toHaveLength(1);
    expect(field.cache.state().notes).toEqual([]);
    expect(field.cache.lines().some((line) => line.namespace.endsWith("-notes"))).toBe(false);
    expect([...field.community.stored.keys()]).toEqual([]);
  });
});
