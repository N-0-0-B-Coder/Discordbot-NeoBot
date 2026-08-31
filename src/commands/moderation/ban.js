import {
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
} from 'discord.js';
import { addInfraction } from '../../db/infractions.js';
import { checkTarget } from '../../lib/moderation-guards.js';
import { error, success } from '../../lib/embeds.js';

export const data = new SlashCommandBuilder()
  .setName('ban')
  .setDescription('Ban a user from the server.')
  .addUserOption((option) =>
    option
      .setName('user')
      .setDescription('Who to ban (works for users who already left)')
      .setRequired(true),
  )
  .addStringOption((option) =>
    option.setName('reason').setDescription('Why?').setMaxLength(400),
  )
  .addIntegerOption((option) =>
    option
      .setName('delete_days')
      .setDescription('Also delete their messages from the last N days')
      .setMinValue(0)
      .setMaxValue(7),
  )
  .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers);

export async function execute(interaction) {
  const user = interaction.options.getUser('user', true);
  const reason = interaction.options.getString('reason') ?? 'No reason given';
  const deleteDays = interaction.options.getInteger('delete_days') ?? 0;

  // A ban can target someone who already left, so a missing member is fine —
  // checkTarget skips the hierarchy comparison in that case.
  const member = await interaction.guild.members.fetch(user.id).catch(() => null);

  const problem = checkTarget({
    interaction,
    target: member,
    permission: PermissionFlagsBits.BanMembers,
    verb: 'ban',
  });
  if (problem) {
    await interaction.reply({
      embeds: [error(problem)],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (member) {
    await user
      .send(`You were banned from **${interaction.guild.name}**.\nReason: ${reason}`)
      .catch(() => null);
  }

  await interaction.guild.bans.create(user.id, {
    reason: `${reason} — by ${interaction.user.tag}`,
    deleteMessageSeconds: deleteDays * 24 * 60 * 60,
  });
  addInfraction({
    guildId: interaction.guildId,
    userId: user.id,
    moderatorId: interaction.user.id,
    type: 'ban',
    reason,
  });

  await interaction.reply({
    embeds: [success(`🔨 Banned **${user.tag}** — ${reason}`)],
  });
}
