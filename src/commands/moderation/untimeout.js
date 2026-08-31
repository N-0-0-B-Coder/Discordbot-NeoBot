import {
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
} from 'discord.js';
import { checkTarget } from '../../lib/moderation-guards.js';
import { error, success } from '../../lib/embeds.js';

export const data = new SlashCommandBuilder()
  .setName('untimeout')
  .setDescription("Lift a member's timeout early.")
  .addUserOption((option) =>
    option.setName('member').setDescription('Who to un-mute').setRequired(true),
  )
  .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers);

export async function execute(interaction) {
  const user = interaction.options.getUser('member', true);
  const member = await interaction.guild.members.fetch(user.id).catch(() => null);

  if (!member) {
    await interaction.reply({
      embeds: [error(`**${user.tag}** is not in this server.`)],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  if (!member.isCommunicationDisabled()) {
    await interaction.reply({
      embeds: [error(`**${user.tag}** is not timed out.`)],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const problem = checkTarget({
    interaction,
    target: member,
    permission: PermissionFlagsBits.ModerateMembers,
    verb: 'un-mute',
  });
  if (problem) {
    await interaction.reply({
      embeds: [error(problem)],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  await member.timeout(null, `Lifted by ${interaction.user.tag}`);
  await interaction.reply({
    embeds: [success(`🔊 Timeout lifted for **${user.tag}**.`)],
  });
}
