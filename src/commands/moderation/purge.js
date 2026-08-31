import {
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
} from 'discord.js';
import { error, success } from '../../lib/embeds.js';

export const data = new SlashCommandBuilder()
  .setName('purge')
  .setDescription('Bulk-delete recent messages in this channel.')
  .addIntegerOption((option) =>
    option
      .setName('count')
      .setDescription('How many messages to scan (1-100)')
      .setRequired(true)
      .setMinValue(1)
      .setMaxValue(100),
  )
  .addUserOption((option) =>
    option.setName('from').setDescription('Only delete messages from this member'),
  )
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages);

export async function execute(interaction) {
  const count = interaction.options.getInteger('count', true);
  const from = interaction.options.getUser('from');

  if (!interaction.memberPermissions.has(PermissionFlagsBits.ManageMessages)) {
    await interaction.reply({
      embeds: [error('You need the **Manage Messages** permission.')],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const fetched = await interaction.channel.messages.fetch({ limit: count });
  const targets = from ? fetched.filter((m) => m.author.id === from.id) : fetched;

  // bulkDelete with filterOld=true silently drops messages older than 14 days,
  // which Discord's API refuses to bulk-delete — so report what actually went,
  // not what was asked for.
  const deleted = await interaction.channel.bulkDelete(targets, true);
  const skipped = targets.size - deleted.size;

  await interaction.editReply({
    embeds: [
      success(
        `🧹 Deleted **${deleted.size}** message(s)${from ? ` from **${from.tag}**` : ''}.` +
          (skipped > 0
            ? `\n${skipped} were skipped — Discord cannot bulk-delete messages older than 14 days.`
            : ''),
      ),
    ],
  });
}
