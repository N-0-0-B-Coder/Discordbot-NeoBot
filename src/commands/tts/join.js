import { EmbedBuilder, MessageFlags, SlashCommandBuilder } from 'discord.js';
import { log } from '../../lib/logger.js';
import { COLORS, error } from '../../lib/embeds.js';
import { getPlayer } from '../../music/manager.js';
import { requireVoiceChannel } from '../../music/guards.js';
import { describeVoiceFailure } from '../../music/diagnose.js';

export const data = new SlashCommandBuilder()
  .setName('tts-join')
  .setDescription(
    'Bring me into your voice channel to read its chat aloud.',
  );

export async function execute(interaction) {
  const { channel, problem } = requireVoiceChannel(interaction);
  if (problem) {
    await interaction.reply({
      embeds: [error(problem)],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  await interaction.deferReply();

  const session = getPlayer(interaction.guild);
  session.textChannel = interaction.channel;

  try {
    await session.connect(channel);
  } catch (err) {
    // manager.js has already logged which state it stalled in, plus the voice
    // dependency report; this is the short version for whoever ran the command.
    log.error('Failed to join voice channel for TTS:', err);
    if (!session.isPlaying) session.destroy();
    await interaction.editReply({
      embeds: [error(describeVoiceFailure(err, channel.name))],
    });
    return;
  }

  session.enableTts(channel.id);

  const embed = new EmbedBuilder()
    .setColor(COLORS.success)
    .setTitle(`🔊 Reading ${channel.name} aloud`)
    .setDescription(
      [
        `Type in **${channel.name}**'s own chat and I will speak it in voice.`,
        '',
        'Open it with the chat bubble on the voice channel, or by clicking the',
        'channel while connected — messages sent anywhere else are ignored.',
      ].join('\n'),
    )
    .addFields(
      {
        name: 'Who gets read',
        value: 'Only people currently connected to this voice channel.',
        inline: true,
      },
      { name: 'Voice', value: session.ttsVoice, inline: true },
      {
        name: 'Stop',
        value: '`/tts-leave`, or I leave on my own when the channel empties.',
      },
    )
    .setFooter({
      text: 'Music still works — a track pauses while I speak, then resumes.',
    });

  await interaction.editReply({ embeds: [embed] });
}
