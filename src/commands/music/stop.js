import { MessageFlags, SlashCommandBuilder } from 'discord.js';
import { error, success } from '../../lib/embeds.js';
import { peekPlayer } from '../../music/manager.js';
import { requireSameChannel } from '../../music/guards.js';

export const data = new SlashCommandBuilder()
  .setName('stop')
  .setDescription('Stop playback and clear the queue (stays in the channel).');

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

  const cleared = player.queue.length;
  player.stop();
  await interaction.reply({
    embeds: [
      success(
        `⏹️ Stopped and cleared **${cleared}** queued track(s). ` +
          'I will leave on my own if nothing else gets played.',
      ),
    ],
  });
}
