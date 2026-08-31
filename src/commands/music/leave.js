import { MessageFlags, SlashCommandBuilder } from 'discord.js';
import { error, success } from '../../lib/embeds.js';
import { peekPlayer } from '../../music/manager.js';
import { requireSameChannel } from '../../music/guards.js';

export const data = new SlashCommandBuilder()
  .setName('leave')
  .setDescription('Disconnect from the voice channel.');

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

  player.destroy();
  await interaction.reply({ embeds: [success('👋 Left the voice channel.')] });
}
