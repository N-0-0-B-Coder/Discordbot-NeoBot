import { Events, MessageFlags } from 'discord.js';
import { log } from '../lib/logger.js';
import { error as errorEmbed } from '../lib/embeds.js';
import { consume } from '../lib/cooldowns.js';
import { findComponent } from '../lib/loaders.js';
import { report } from '../lib/error-reporter.js';
import { logAction, logDone, describeOptions } from '../lib/activity.js';

export const name = Events.InteractionCreate;

export async function execute(interaction, client) {
  if (interaction.isAutocomplete()) {
    const command = client.commands.get(interaction.commandName);
    if (typeof command?.autocomplete !== 'function') return;
    // Autocomplete fires on every keystroke, so it stays at debug — at info it
    // would bury every other line in the log.
    log.debug(`autocomplete /${interaction.commandName}`);
    try {
      await command.autocomplete(interaction);
    } catch (err) {
      // Autocomplete failures are noisy and harmless — the user just sees no
      // suggestions. Log them, but never page the owner over one.
      log.warn(`Autocomplete for /${interaction.commandName} failed:`, err);
    }
    return;
  }

  // Buttons, select menus and modals route by customId rather than by folder.
  if (
    interaction.isButton() ||
    interaction.isAnySelectMenu() ||
    interaction.isModalSubmit()
  ) {
    const component = findComponent(client.components, interaction.customId);
    if (!component) {
      log.warn(`No handler for component "${interaction.customId}".`);
      return;
    }
    const where = {
      user: interaction.user.tag,
      channel: interaction.channel?.name,
      guild: interaction.guild?.name,
    };
    logAction(`component ${interaction.customId}`, where);

    try {
      await component.execute(interaction);
    } catch (err) {
      report(
        `component ${interaction.customId}`,
        err,
        { User: interaction.user.tag, Guild: interaction.guild?.name ?? 'DM' },
        interaction.guildId,
      );
      // showModal cannot be followed by another response, and a component
      // interaction may already be updated — so only reply if nothing has
      // acknowledged it yet.
      if (!interaction.replied && !interaction.deferred) {
        await interaction
          .reply({
            embeds: [errorEmbed('That did not work. The error has been logged.')],
            flags: MessageFlags.Ephemeral,
          })
          .catch(() => null);
      }
    }
    return;
  }

  if (!interaction.isChatInputCommand()) return;

  const command = client.commands.get(interaction.commandName);
  if (!command) {
    log.warn(`Received unknown command /${interaction.commandName}.`);
    return;
  }

  if (command.guildOnly !== false && !interaction.inGuild()) {
    await interaction.reply({
      embeds: [errorEmbed('This command only works inside a server.')],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  // Per-user cooldown, opted into by a command exporting `cooldownMs`.
  // Commands that hit a rate-limited third-party API set this.
  const remainingMs = consume(
    interaction.commandName,
    interaction.user.id,
    command.cooldownMs,
  );
  if (remainingMs > 0) {
    const readyAt = Math.round((Date.now() + remainingMs) / 1000);
    await interaction.reply({
      embeds: [
        errorEmbed(
          `Slow down — you can use \`/${interaction.commandName}\` again <t:${readyAt}:R>.`,
        ),
      ],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const where = {
    user: interaction.user.tag,
    channel: interaction.channel?.name,
    guild: interaction.guild?.name,
  };
  const startedAt = Date.now();
  logAction(`/${interaction.commandName}`, { ...where, detail: describeOptions(interaction) });

  try {
    await command.execute(interaction);
    logDone(`/${interaction.commandName}`, startedAt, where);
  } catch (err) {
    // Mirror to the error channel with enough context to actually debug it.
    report(
      `/${interaction.commandName}`,
      err,
      {
        User: interaction.user.tag,
        Guild: interaction.guild?.name ?? 'DM',
        Channel: interaction.channel?.name ?? 'unknown',
      },
      interaction.guildId,
    );

    const payload = {
      embeds: [
        errorEmbed(
          'Something went wrong running that command. The error has been logged.',
        ),
      ],
      flags: MessageFlags.Ephemeral,
    };
    // The interaction may already be acknowledged (deferred or replied), and
    // replying twice is itself an error — pick the right call.
    try {
      if (interaction.deferred || interaction.replied) {
        await interaction.followUp(payload);
      } else {
        await interaction.reply(payload);
      }
    } catch (replyErr) {
      log.error('Failed to report the error to the user:', replyErr);
    }
  }
}
