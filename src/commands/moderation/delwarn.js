import {
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
} from 'discord.js';
import { clearInfractions, deleteInfraction } from '../../db/infractions.js';
import { error, success } from '../../lib/embeds.js';

export const data = new SlashCommandBuilder()
  .setName('delwarn')
  .setDescription('Remove one infraction by id, or clear a member\'s whole record.')
  .addSubcommand((sub) =>
    sub
      .setName('one')
      .setDescription('Delete a single infraction')
      .addIntegerOption((option) =>
        option
          .setName('id')
          .setDescription('Infraction id, shown by /warnings')
          .setRequired(true)
          .setMinValue(1),
      ),
  )
  .addSubcommand((sub) =>
    sub
      .setName('all')
      .setDescription('Clear every infraction for a member')
      .addUserOption((option) =>
        option.setName('member').setDescription('Whose record to clear').setRequired(true),
      ),
  )
  .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers);

export async function execute(interaction) {
  if (interaction.options.getSubcommand() === 'one') {
    const id = interaction.options.getInteger('id', true);
    // Scoped by guild id so one server cannot delete another server's records.
    const removed = deleteInfraction(interaction.guildId, id);
    await interaction.reply({
      embeds: removed
        ? [success(`Deleted infraction **#${id}**.`)]
        : [error(`No infraction **#${id}** in this server.`)],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const user = interaction.options.getUser('member', true);
  const removed = clearInfractions(interaction.guildId, user.id);
  await interaction.reply({
    embeds: [
      success(`Cleared **${removed}** infraction(s) for **${user.tag}**.`),
    ],
    flags: MessageFlags.Ephemeral,
  });
}
