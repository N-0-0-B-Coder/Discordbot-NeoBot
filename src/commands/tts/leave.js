import { MessageFlags, SlashCommandBuilder } from 'discord.js';
import { error, success } from '../../lib/embeds.js';
import { peekPlayer } from '../../music/manager.js';
import { requireSameChannel } from '../../music/guards.js';

export const data = new SlashCommandBuilder()
  .setName('tts-leave')
  .setDescription('Stop reading the voice channel chat aloud.');

export async function execute(interaction) {
  const session = peekPlayer(interaction.guildId);

  if (!session?.ttsEnabled) {
    await interaction.reply({
      embeds: [error('I am not reading anything aloud right now.')],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const { problem } = requireSameChannel(interaction, session);
  if (problem) {
    await interaction.reply({
      embeds: [error(problem)],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  session.disableTts();

  // Music may still be going, in which case stay — only leave if there is
  // nothing left to do here.
  if (session.isPlaying) {
    await interaction.reply({
      embeds: [
        success('🔇 Stopped reading chat aloud. Still here for the music.'),
      ],
    });
    return;
  }

  session.destroy();
  await interaction.reply({
    embeds: [success('🔇 Stopped reading chat aloud, and left the channel.')],
  });
}
