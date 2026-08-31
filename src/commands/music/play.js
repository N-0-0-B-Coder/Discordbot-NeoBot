import { EmbedBuilder, MessageFlags, SlashCommandBuilder } from 'discord.js';
import { config } from '../../lib/config.js';
import { log } from '../../lib/logger.js';
import { COLORS, error, formatDuration, truncate } from '../../lib/embeds.js';
import { release } from '../../lib/cooldowns.js';
import { getPlayer } from '../../music/manager.js';
import { requireVoiceChannel } from '../../music/guards.js';
import { resolveQuery } from '../../music/source.js';

export const data = new SlashCommandBuilder()
  .setName('play')
  .setDescription('Play audio in your voice channel.')
  .addStringOption((option) =>
    option
      .setName('query')
      .setDescription('Search terms, a video link, or a playlist link')
      .setRequired(true),
  );

// Every /play spawns a yt-dlp process. Without a floor, a few people queueing
// at once can pin the CPU on a small hosting container.
export const cooldownMs = 5_000;

export async function execute(interaction) {
  const query = interaction.options.getString('query', true);

  const { channel, problem } = requireVoiceChannel(interaction);
  if (problem) {
    // Nothing was spent, so do not hold the cooldown against them — otherwise
    // "join a channel first" locks you out for five seconds for no reason.
    release('play', interaction.user.id);
    await interaction.reply({
      embeds: [error(problem)],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  // Resolution shells out to yt-dlp, which routinely takes several seconds —
  // well past Discord's 3-second window to acknowledge an interaction.
  await interaction.deferReply();

  let tracks;
  try {
    tracks = await resolveQuery(query, interaction.user.id);
  } catch (err) {
    log.warn(`Failed to resolve "${query}":`, err?.stderr ?? err);
    await interaction.editReply({
      embeds: [
        error(
          'I could not look that up. If this keeps happening, yt-dlp is probably ' +
            'out of date — see the troubleshooting section in the README.',
        ),
      ],
    });
    return;
  }

  if (tracks.length === 0) {
    await interaction.editReply({
      embeds: [error(`Nothing found for **${truncate(query, 100)}**.`)],
    });
    return;
  }

  const playable = tracks.filter(
    (track) => !track.isLive && track.duration <= config.music.maxTrackDurationSec,
  );
  if (playable.length === 0) {
    await interaction.editReply({
      embeds: [
        error('That is a live stream or is too long for me to queue.'),
      ],
    });
    return;
  }

  const player = getPlayer(interaction.guild);
  // Remember where the request came from so idle/error notices land somewhere
  // the requester will actually see them.
  player.textChannel = interaction.channel;

  const { accepted, rejected } = player.enqueue(playable);
  if (accepted === 0) {
    await interaction.editReply({
      embeds: [
        error(`The queue is full (${config.music.maxQueueLength} tracks).`),
      ],
    });
    return;
  }

  try {
    await player.connect(channel);
  } catch (err) {
    log.error('Failed to join voice channel:', err);
    player.destroy();
    await interaction.editReply({
      embeds: [error(`I could not connect to **${channel.name}**.`)],
    });
    return;
  }

  const startedNow = !player.isPlaying && !player.current;
  if (startedNow) await player.playNext();

  const first = playable[0];
  const embed = new EmbedBuilder()
    .setColor(COLORS.info)
    .setAuthor({
      name: startedNow ? 'Now playing' : 'Added to the queue',
    })
    .setTitle(truncate(first.title, 250))
    .setURL(first.url)
    .setFooter({
      text: [
        first.uploader,
        formatDuration(first.duration),
        accepted > 1 ? `+${accepted - 1} more from the playlist` : null,
        rejected > 0 ? `${rejected} dropped (queue full)` : null,
      ]
        .filter(Boolean)
        .join(' · '),
    });
  if (first.thumbnail) embed.setThumbnail(first.thumbnail);

  await interaction.editReply({ embeds: [embed] });
}
