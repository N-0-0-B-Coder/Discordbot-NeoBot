/**
 * Managing the watches created by the `watch` option on /deals and /steam.
 *
 * A subscription you cannot list or cancel is a trap, so this ships with the
 * feature rather than after it.
 */
import { EmbedBuilder, MessageFlags, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import { COLORS, error } from '../../lib/embeds.js';
import { listWatches, removeWatch, MAX_WATCHES_PER_GUILD } from '../../db/price-watches.js';
import { describeWatch } from '../../lib/watch-option.js';

export const data = new SlashCommandBuilder()
  .setName('pricewatch')
  .setDescription('See or cancel the game prices I am watching for this server.')
  .addSubcommand((sub) =>
    sub.setName('list').setDescription('Show every game being watched here'),
  )
  .addSubcommand((sub) =>
    sub
      .setName('remove')
      .setDescription('Stop watching one game')
      .addIntegerOption((option) =>
        option
          .setName('id')
          .setDescription('The number shown by /pricewatch list')
          .setRequired(true)
          .setMinValue(1),
      ),
  )
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels);

export async function execute(interaction) {
  const watches = listWatches(interaction.guildId);

  if (interaction.options.getSubcommand() === 'remove') {
    const id = interaction.options.getInteger('id', true);
    const target = watches.find((watch) => watch.id === id);

    if (!removeWatch(interaction.guildId, id)) {
      await interaction.reply({
        embeds: [
          error(
            `No watch with id **${id}** on this server. Run \`/pricewatch list\` to see the ids.`,
          ),
        ],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    await interaction.reply({
      embeds: [
        new EmbedBuilder()
          .setColor(COLORS.info)
          .setDescription(`No longer watching **${target?.title ?? id}**.`),
      ],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (watches.length === 0) {
    await interaction.reply({
      embeds: [
        new EmbedBuilder()
          .setColor(COLORS.info)
          .setTitle('No price watches')
          .setDescription(
            'Add one with the `watch` option on `/deals` or `/steam` — pick the ' +
              'channel you want the reports in.',
          ),
      ],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  await interaction.reply({
    embeds: [
      new EmbedBuilder()
        .setColor(COLORS.deal)
        .setTitle(`Watching ${watches.length} of ${MAX_WATCHES_PER_GUILD} games`)
        .setDescription(
          watches.map((watch) => `\`${watch.id}\` ${describeWatch(watch)}`).join('\n'),
        )
        .setFooter({ text: 'Remove one with /pricewatch remove id:<number>' }),
    ],
    flags: MessageFlags.Ephemeral,
  });
}
