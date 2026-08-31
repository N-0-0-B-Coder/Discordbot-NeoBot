import { EmbedBuilder, MessageFlags, SlashCommandBuilder } from 'discord.js';
import { COLORS, formatDuration, info, truncate } from '../../lib/embeds.js';
import { peekPlayer } from '../../music/manager.js';

const PAGE_SIZE = 10;

export const data = new SlashCommandBuilder()
  .setName('queue')
  .setDescription('Show what is lined up.')
  .addIntegerOption((option) =>
    option.setName('page').setDescription('Page number').setMinValue(1),
  );

export async function execute(interaction) {
  const player = peekPlayer(interaction.guildId);
  if (!player || (!player.current && player.queue.length === 0)) {
    await interaction.reply({
      embeds: [info('The queue is empty. Add something with `/play`.')],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const page = interaction.options.getInteger('page') ?? 1;
  const pageCount = Math.max(1, Math.ceil(player.queue.length / PAGE_SIZE));
  const clamped = Math.min(page, pageCount);
  const start = (clamped - 1) * PAGE_SIZE;
  const slice = player.queue.slice(start, start + PAGE_SIZE);

  const totalSeconds = player.queue.reduce(
    (sum, track) => sum + (track.duration || 0),
    0,
  );

  const lines = slice.map(
    (track, index) =>
      `\`${start + index + 1}.\` [${truncate(track.title, 60)}](${track.url}) ` +
      `· ${formatDuration(track.duration)} · <@${track.requestedBy}>`,
  );

  const embed = new EmbedBuilder()
    .setColor(COLORS.info)
    .setTitle('Queue')
    .setDescription(lines.join('\n') || 'Nothing queued after the current track.')
    .setFooter({
      text: `Page ${clamped}/${pageCount} · ${player.queue.length} track(s) · ${formatDuration(
        totalSeconds,
      )} remaining`,
    });

  if (player.current) {
    embed.addFields({
      name: 'Now playing',
      value: `[${truncate(player.current.title, 80)}](${player.current.url}) · <@${player.current.requestedBy}>`,
    });
  }

  await interaction.reply({ embeds: [embed] });
}
