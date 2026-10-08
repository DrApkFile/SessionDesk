import { describe, expect, it } from "vitest";
import { MANAGER_COMMANDS, commandNames, textForCommand } from "../../src/bots/manager/commandList.js";
import { DISCORD_ARGS_OPTION, definitionsAreWithinDiscordLimits, slashCommandDefinitions } from "../../src/platform/discord/slashCommands.js";

describe("every manager command is offered as a Discord slash command", () => {
  it("fits Discord's rules for names and descriptions", () => {
    expect(definitionsAreWithinDiscordLimits()).toEqual([]);
  });

  it("registers one command per manager command, under Discord's limit of 100", () => {
    const definitions = slashCommandDefinitions();
    expect(definitions).toHaveLength(MANAGER_COMMANDS.length);
    expect(definitions.length).toBeLessThanOrEqual(100);
    expect(definitions.map((definition) => definition.name)).toEqual([...commandNames()]);
  });

  it("gives an args option only to the commands that take arguments", () => {
    const definitions = slashCommandDefinitions();
    const owed = definitions.find((definition) => definition.name === "owed");
    const fixed = definitions.find((definition) => definition.name === "fixed");
    expect(owed?.options ?? []).toEqual([]);
    expect((fixed?.options ?? []).map((option) => option.name)).toEqual([DISCORD_ARGS_OPTION]);
    expect((fixed?.options ?? [])[0]?.required ?? true).toBe(false);
  });

  it("covers the commands a new community needs to set itself up", () => {
    for (const name of ["claim", "addmanager", "removemanager", "setup"]) {
      expect(commandNames()).toContain(name);
    }
  });

  it("rebuilds the text the manager service already understands", () => {
    expect(textForCommand("fixed", "i-abc123")).toBe("/fixed i-abc123");
    expect(textForCommand("owed", "")).toBe("/owed");
    expect(textForCommand("promise", "  i-1 2026-10-09 we will look  ")).toBe("/promise i-1 2026-10-09 we will look");
  });

  it("describes each command in words a manager would read", () => {
    for (const command of MANAGER_COMMANDS) {
      expect(command.description.length).toBeGreaterThan(8);
      expect(command.description).not.toMatch(/\b(itemId|memberH|seq|namespace|status=)\b/);
    }
  });
});
