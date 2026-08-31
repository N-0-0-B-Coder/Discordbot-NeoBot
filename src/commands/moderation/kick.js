import {
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
} from 'discord.js';
import { addInfraction } from '../../db/infractions.js';
import { checkTarget } from '../../lib/moderation-guards.js';
import { error, success } from '../../lib/embeds.js';

export const data = new SlashCommandBuilder()
  .setName('kick')
  .setDescription('Remove a member from the server.')
  .addUserOption((option) =>
    option.setName('member').setDescription('Who to kick').setRequired(true),
  )
  .addStringOption((option) =>
    option.setName('reason').setDescription('Why?').setMaxLength(400),
  )
  .setDefaultMemberPermissions(PermissionFlagsBits.KickMembers);

export async function execute(interaction) {
  const user = interaction.options.getUser('member', true);
  const reason = interaction.options.getString('reason') ?? 'No reason given';
  const member = await interaction.guild.members.fetch(user.id).catch(() => null);

  if (!member) {
    await interaction.reply({
      embeds: [error(`**${user.tag}** is not in this server.`)],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const problem = checkTarget({
    interaction,
    target: member,
    permission: PermissionFlagsBits.KickMembers,
    verb: 'kick',
  });
  if (problem) {
    await interaction.reply({
      embeds: [error(problem)],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  // DM before kicking — afterwards the bot may no longer share a server with
  // them, and Discord will refuse to open the DM.
  await user
    .send(`You were kicked from **${interaction.guild.name}**.\nReason: ${reason}`)
    .catch(() => null);

  await member.kick(`${reason} — by ${interaction.user.tag}`);
  addInfraction({
    guildId: interaction.guildId,
    userId: user.id,
    moderatorId: interaction.user.id,
    type: 'kick',
    reason,
  });

  await interaction.reply({
    embeds: [success(`👢 Kicked **${user.tag}** — ${reason}`)],
  });
}
