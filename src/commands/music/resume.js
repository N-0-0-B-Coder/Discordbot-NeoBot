import { MessageFlags, SlashCommandBuilder } from 'discord.js';
import { error, success } from '../../lib/embeds.js';
import { peekPlayer } from '../../music/manager.js';
import { requireSameChannel } from '../../music/guards.js';

export const data = new SlashCommandBuilder()
  .setName('resume')
  .setDescription('Resume paused playback.');

export async function execute(interaction) {
  const player = peekPlayer(interaction.guildId);
  const { problem } = requireSameChannel(interaction, player);
  if (problem) {
    await interaction.reply({
      embeds: [error(problem)],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const resumed = player.resume();
  await interaction.reply({
    embeds: resumed
      ? [success('▶️ Back on.')]
      : [error('Nothing is paused right now.')],
    flags: resumed ? undefined : MessageFlags.Ephemeral,
  });
}
