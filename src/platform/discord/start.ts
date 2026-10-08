import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  Client,
  Events,
  GatewayIntentBits,
  REST,
  Routes,
  type ButtonInteraction,
  type ChatInputCommandInteraction,
  type Interaction,
  type Message,
} from "discord.js";
import { textForCommand } from "../../bots/manager/commandList.js";
import { DISCORD_ARGS_OPTION, definitionsAreWithinDiscordLimits, slashCommandDefinitions } from "./slashCommands.js";
import type { DiscordSettings } from "../../config.js";
import type { ManagerService } from "../../bots/manager/service.js";
import type { MemberService } from "../../bots/member/service.js";
import { CONSENT_PREFIX } from "../../bots/member/telegram.js";
import { dmStartLink, CONSENT_SCOPES, type ConsentScope } from "../../bots/member/notices.js";
import type { Log } from "../../bots/shared/log.js";
import { PollingSupervisor, type Pollable } from "../../bots/shared/polling.js";
import type { IncomingMessage, BotAction } from "../../bots/shared/incoming.js";
import type { Clock, Sleep } from "../../core/ports.js";
import type { PlatformRuntime } from "../runtime.js";
import { MESSAGE_CONTENT_FIX, chatKindOfDiscord, hasMessageContentIntent, mentionsDiscordBot, strippedDiscordText } from "./shapes.js";

export const DISCORD_INTENTS = GatewayIntentBits.Guilds | GatewayIntentBits.GuildMessages | GatewayIntentBits.MessageContent | GatewayIntentBits.DirectMessages;

export interface DiscordStart {
  readonly settings: DiscordSettings;
  readonly member: MemberService;
  readonly manager: ManagerService;
  readonly log: Log;
  readonly sleep: Sleep;
  readonly clock: Clock;
}

function scopeOf(callback: string): ConsentScope | null {
  const raw = callback.slice(CONSENT_PREFIX.length);
  return (CONSENT_SCOPES as readonly string[]).includes(raw) ? (raw as ConsentScope) : null;
}

function consentRow(botUsername: string): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(`${CONSENT_PREFIX}storage`).setLabel("I agree").setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(`${CONSENT_PREFIX}storage_and_dm`).setLabel("I agree + DMs").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setLabel("Open DMs with me").setStyle(ButtonStyle.Link).setURL(dmStartLink(botUsername)),
  );
}

export function toDiscordIncoming(message: Message, botUserId: string, communityChannelId: string): IncomingMessage | null {
  const text = message.content;
  if (text.length === 0) return null;
  const repliedToBot = message.mentions.repliedUser?.id === botUserId;
  return {
    platform: "discord",
    chatId: message.channelId,
    chatKind: chatKindOfDiscord({ isDirect: message.guildId === null, channelId: message.channelId, communityChannelId }),
    messageId: message.id,
    userId: message.author.id,
    isBot: message.author.bot,
    userName: message.author.username,
    text: strippedDiscordText(text, botUserId),
    mentionsBot: mentionsDiscordBot(text, botUserId, [...message.mentions.users.keys()], repliedToBot),
    replyToUserId: message.mentions.repliedUser?.id ?? null,
    replyToIsBot: message.mentions.repliedUser?.bot ?? false,
    replyToText: null,
  };
}

async function deliver(message: Message, action: BotAction, botUsername: string, log: Log): Promise<void> {
  if (action.kind === "silent") return;
  if (!message.channel.isSendable()) {
    log.say("channel_not_sendable", { channel: message.channelId });
    return;
  }
  const sent = await message.channel.send(
    action.offerConsent ? { content: action.text, components: [consentRow(botUsername)] } : { content: action.text },
  );
  if (action.pin !== true) return;
  try {
    await sent.pin();
    log.say("optin_pinned", { channel: sent.channelId });
  } catch (error) {
    log.say("optin_pin_failed", { channel: sent.channelId, detail: String(error instanceof Error ? error.message : error).slice(0, 160) });
  }
}

export async function startDiscord(start: DiscordStart): Promise<PlatformRuntime> {
  if (!hasMessageContentIntent(DISCORD_INTENTS)) throw new Error(MESSAGE_CONTENT_FIX);
  const client = new Client({ intents: DISCORD_INTENTS });
  const log = start.log;

  const ready = new Promise<{ id: string; username: string }>((resolve, reject) => {
    client.once(Events.ClientReady, (self) => resolve({ id: self.user.id, username: self.user.username }));
    client.once(Events.Error, reject);
  });

  client.on(Events.MessageCreate, (message) => {
    void (async () => {
      const self = client.user;
      if (self === null) return;
      if (message.content.length === 0 && message.attachments.size > 0) {
        log.say("content_empty", { channel: message.channelId, hint: MESSAGE_CONTENT_FIX });
        return;
      }
      const incoming = toDiscordIncoming(message, self.id, start.settings.channelId);
      if (incoming === null) return;
      const action = await start.member.handle(incoming);
      await deliver(message, action, self.username, log);
    })().catch((error: unknown) => log.say("discord_error", { detail: String(error instanceof Error ? error.message : error).slice(0, 200) }));
  });

  client.on(Events.InteractionCreate, (interaction: Interaction) => {
    void (async () => {
      if (interaction.isButton()) {
        await handleButton(interaction, start);
        return;
      }
      if (interaction.isChatInputCommand()) await handleSlashCommand(interaction, start);
    })().catch((error: unknown) => log.say("discord_interaction_error", { detail: String(error instanceof Error ? error.message : error).slice(0, 200) }));
  });

  const pollable: Pollable = {
    name: "discord",
    start: async (onPolling) => {
      await client.login(start.settings.botToken);
      const self = await ready;
      log.say("identity", { username: self.username, id: self.id, platform: "discord" });
      await registerSlashCommands(start.settings.botToken, self.id, log);
      onPolling();
      await new Promise<void>(() => {});
    },
    stop: async () => {
      await client.destroy();
    },
  };

  const supervisor = new PollingSupervisor(pollable, start.sleep, start.clock, log);

  return {
    platform: "discord",
    supervisors: [supervisor],
    toManager: async (userId, text) => {
      const user = await client.users.fetch(userId);
      await user.send(text);
    },
    toMember: async (userId, text) => {
      const user = await client.users.fetch(userId);
      await user.send(text);
    },
    detail: { channelId: start.settings.channelId, managers: start.settings.managerIds.length },
    stop: async () => {
      await client.destroy();
    },
  };
}

async function handleButton(interaction: ButtonInteraction, start: DiscordStart): Promise<void> {
  if (!interaction.customId.startsWith(CONSENT_PREFIX)) return;
  const scope = scopeOf(interaction.customId);
  if (scope === null) {
    await interaction.reply({ content: "That button is not one of mine.", ephemeral: true });
    return;
  }
  const outcome = start.member.consentFromTap({
    platform: "discord",
    userId: interaction.user.id,
    chatId: interaction.channelId ?? interaction.user.id,
    chatKind: chatKindOfDiscord({
      isDirect: interaction.guildId === null,
      channelId: interaction.channelId ?? "",
      communityChannelId: start.settings.channelId,
    }),
    messageId: interaction.message.id,
    scope,
  });
  if (outcome.ignored) {
    await interaction.reply({ content: "I only take that button in this community's channel.", ephemeral: true });
    return;
  }
  await interaction.reply({ content: outcome.alert, ephemeral: true });
}

export async function registerSlashCommands(botToken: string, applicationId: string, log: Log): Promise<void> {
  const problems = definitionsAreWithinDiscordLimits();
  if (problems.length > 0) {
    log.say("slash_commands_refused", { problems: problems.join("; ") });
    throw new Error(`manager commands do not fit Discord's rules: ${problems.join("; ")}`);
  }
  const definitions = slashCommandDefinitions();
  const rest = new REST({ version: "10" }).setToken(botToken);
  await rest.put(Routes.applicationCommands(applicationId), { body: definitions });
  log.say("slash_commands_registered", { count: definitions.length, note: "global commands can take a minute to appear" });
}

async function handleSlashCommand(interaction: ChatInputCommandInteraction, start: DiscordStart): Promise<void> {
  const args = interaction.options.getString(DISCORD_ARGS_OPTION) ?? "";
  const incoming: IncomingMessage = {
    platform: "discord",
    chatId: interaction.channelId ?? interaction.user.id,
    chatKind: chatKindOfDiscord({
      isDirect: interaction.guildId === null,
      channelId: interaction.channelId ?? "",
      communityChannelId: start.settings.channelId,
    }),
    messageId: interaction.id,
    userId: interaction.user.id,
    isBot: interaction.user.bot,
    userName: interaction.user.username,
    text: textForCommand(interaction.commandName, args),
    mentionsBot: true,
    replyToUserId: null,
    replyToIsBot: false,
    replyToText: null,
  };
  const action = await start.manager.handle(incoming);
  if (action.kind === "silent") {
    await interaction.reply({ content: "Nothing to do.", ephemeral: true });
    return;
  }
  await interaction.reply({ content: action.text.slice(0, 1900), ephemeral: true });
}
