import { MessageFlags, SlashCommandBuilder } from 'discord.js';
import { error, success, truncate } from '../../lib/embeds.js';
import { peekPlayer } from '../../music/manager.js';
import { requireSameChannel } from '../../music/guards.js';

export const data = new SlashCommandBuilder()
  .setName('skip')
  .setDescription('Skip the current track.');

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

  const skipped = player.skip();
  await interaction.reply({
    embeds: [
      success(
        skipped
          ? `⏭️ Skipped **${truncate(skipped.title, 200)}**.`
          : '⏭️ Skipped.',
      ),
    ],
  });
}
