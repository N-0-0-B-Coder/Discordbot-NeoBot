import {
  EmbedBuilder,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
} from 'discord.js';
import { countInfractions, listInfractions } from '../../db/infractions.js';
import { COLORS, info, truncate } from '../../lib/embeds.js';

export const data = new SlashCommandBuilder()
  .setName('warnings')
  .setDescription('Show a member\'s infraction history.')
  .addUserOption((option) =>
    option.setName('member').setDescription('Whose record to show').setRequired(true),
  )
  .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers);

const ICONS = { warn: '⚠️', mute: '🔇', kick: '👢', ban: '🔨', unban: '🕊️' };

export async function execute(interaction) {
  const user = interaction.options.getUser('member', true);
  const records = listInfractions(interaction.guildId, user.id, 15);
  const counts = countInfractions(interaction.guildId, user.id);

  if (records.length === 0) {
    await interaction.reply({
      embeds: [info(`**${user.tag}** has a clean record.`)],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const embed = new EmbedBuilder()
    .setColor(COLORS.warning)
    .setTitle(`Record for ${user.tag}`)
    .setThumbnail(user.displayAvatarURL())
    .setDescription(
      `**${counts.total}** total — ${counts.warn} warn · ${counts.mute} mute · ` +
        `${counts.kick} kick · ${counts.ban} ban`,
    )
    .setFooter({ text: 'Records older than 30 days are deleted automatically.' });

  for (const record of records) {
    embed.addFields({
      name: `${ICONS[record.type] ?? '•'} #${record.id} · ${record.type}`,
      value:
        `<t:${Math.floor(record.createdAt / 1000)}:R> by <@${record.moderatorId}>\n` +
        truncate(record.reason ?? 'No reason given', 200),
    });
  }

  await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
}
