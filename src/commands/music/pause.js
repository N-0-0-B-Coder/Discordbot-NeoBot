import { MessageFlags, SlashCommandBuilder } from 'discord.js';
import { error, success } from '../../lib/embeds.js';
import { peekPlayer } from '../../music/manager.js';
import { requireSameChannel } from '../../music/guards.js';

export const data = new SlashCommandBuilder()
  .setName('pause')
  .setDescription('Pause playback.');

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

  const paused = player.pause();
  await interaction.reply({
    embeds: paused
      ? [success('⏸️ Paused. Use `/resume` to pick it back up.')]
      : [error('There is nothing playing to pause.')],
    flags: paused ? undefined : MessageFlags.Ephemeral,
  });
}
