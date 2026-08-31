import { AudioPlayerStatus } from '@discordjs/voice';
import { EmbedBuilder, MessageFlags, SlashCommandBuilder } from 'discord.js';
import { COLORS, formatDuration, info, truncate } from '../../lib/embeds.js';
import { peekPlayer } from '../../music/manager.js';

const BAR_WIDTH = 20;

export const data = new SlashCommandBuilder()
  .setName('nowplaying')
  .setDescription('Show the track that is playing right now.');

export async function execute(interaction) {
  const player = peekPlayer(interaction.guildId);
  const track = player?.current;
  if (!track) {
    await interaction.reply({
      embeds: [info('Nothing is playing.')],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  // playbackDuration is milliseconds of audio actually pushed to Discord, which
  // is the closest thing to a playhead the voice library exposes.
  const elapsedSec = Math.floor(
    (player.player.state.status === AudioPlayerStatus.Idle
      ? 0
      : player.player.state.resource?.playbackDuration ?? 0) / 1000,
  );

  const embed = new EmbedBuilder()
    .setColor(COLORS.info)
    .setAuthor({ name: 'Now playing' })
    .setTitle(truncate(track.title, 250))
    .setURL(track.url)
    .setDescription(
      `${progressBar(elapsedSec, track.duration)}\n` +
        `\`${formatDuration(elapsedSec)} / ${formatDuration(track.duration)}\``,
    )
    .setFooter({
      text: [track.uploader, `${player.queue.length} more queued`]
        .filter(Boolean)
        .join(' · '),
    });
  if (track.thumbnail) embed.setThumbnail(track.thumbnail);

  await interaction.reply({
    embeds: [embed],
    components: [linkRow(track.url)],
  });
}

function progressBar(elapsed, total) {
  if (!total || total <= 0) return '🔴 live';
  const filled = Math.min(
    BAR_WIDTH - 1,
    Math.floor((elapsed / total) * BAR_WIDTH),
  );
  return `${'▬'.repeat(filled)}🔘${'▬'.repeat(BAR_WIDTH - filled - 1)}`;
}

function linkRow(url) {
  return {
    type: 1,
    components: [{ type: 2, style: 5, label: 'Open source', url }],
  };
}
