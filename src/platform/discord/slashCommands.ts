import { SlashCommandBuilder } from "discord.js";
import { MANAGER_COMMANDS } from "../../bots/manager/commandList.js";

export const DISCORD_ARGS_OPTION = "args";
export const DISCORD_NAME_LIMIT = 32;
export const DISCORD_DESCRIPTION_LIMIT = 100;

export function slashCommandDefinitions(): readonly ReturnType<SlashCommandBuilder["toJSON"]>[] {
  return MANAGER_COMMANDS.map((command) => {
    const builder = new SlashCommandBuilder().setName(command.name).setDescription(command.description.slice(0, DISCORD_DESCRIPTION_LIMIT));
    if (command.argsHint !== null) {
      builder.addStringOption((option) => option.setName(DISCORD_ARGS_OPTION).setDescription(command.argsHint!.slice(0, DISCORD_DESCRIPTION_LIMIT)).setRequired(false));
    }
    return builder.toJSON();
  });
}

export function definitionsAreWithinDiscordLimits(): readonly string[] {
  const problems: string[] = [];
  for (const command of MANAGER_COMMANDS) {
    if (!/^[a-z][a-z0-9_-]*$/.test(command.name)) problems.push(`${command.name}: a Discord command name must be lower case letters, digits, dashes or underscores`);
    if (command.name.length > DISCORD_NAME_LIMIT) problems.push(`${command.name}: longer than ${DISCORD_NAME_LIMIT} characters`);
    if (command.description.length === 0 || command.description.length > DISCORD_DESCRIPTION_LIMIT) problems.push(`${command.name}: description must be 1 to ${DISCORD_DESCRIPTION_LIMIT} characters`);
  }
  return problems;
}
