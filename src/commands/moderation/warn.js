import {
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
} from 'discord.js';
import { addInfraction, countInfractions } from '../../db/infractions.js';
import { checkTarget } from '../../lib/moderation-guards.js';
import { error, success } from '../../lib/embeds.js';

export const data = new SlashCommandBuilder()
  .setName('warn')
  .setDescription('Log a warning against a member.')
  .addUserOption((option) =>
    option.setName('member').setDescription('Who to warn').setRequired(true),
  )
  .addStringOption((option) =>
    option
      .setName('reason')
      .setDescription('Why are they being warned?')
      .setMaxLength(400),
  )
  .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers);

export async function execute(interaction) {
  const user = interaction.options.getUser('member', true);
  const reason = interaction.options.getString('reason') ?? 'No reason given';
  const member = await interaction.guild.members.fetch(user.id).catch(() => null);

  const problem = checkTarget({
    interaction,
    target: member,
    permission: PermissionFlagsBits.ModerateMembers,
    verb: 'warn',
  });
  if (problem) {
    await interaction.reply({
      embeds: [error(problem)],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  addInfraction({
    guildId: interaction.guildId,
    userId: user.id,
    moderatorId: interaction.user.id,
    type: 'warn',
    reason,
  });
  const counts = countInfractions(interaction.guildId, user.id);

  // Best-effort DM: plenty of people have DMs closed, and that must not fail
  // the command.
  await user
    .send(
      `You were warned in **${interaction.guild.name}**.\nReason: ${reason}`,
    )
    .catch(() => null);

  await interaction.reply({
    embeds: [
      success(
        `⚠️ Warned **${user.tag}** — ${reason}\nThey now have **${counts.warn}** warning(s) on record.`,
      ),
    ],
  });
}
