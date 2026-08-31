import {
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
} from 'discord.js';
import { addInfraction } from '../../db/infractions.js';
import { checkTarget } from '../../lib/moderation-guards.js';
import { formatDurationMs, parseDuration } from '../../lib/duration.js';
import { error, success } from '../../lib/embeds.js';

// Discord caps communication timeouts at 28 days.
const MAX_TIMEOUT_MS = 28 * 24 * 60 * 60 * 1000;

export const data = new SlashCommandBuilder()
  .setName('timeout')
  .setDescription('Mute a member for a while (Discord timeout).')
  .addUserOption((option) =>
    option.setName('member').setDescription('Who to time out').setRequired(true),
  )
  .addStringOption((option) =>
    option
      .setName('duration')
      .setDescription('How long, e.g. 10m, 2h, 1d (max 28d)')
      .setRequired(true),
  )
  .addStringOption((option) =>
    option.setName('reason').setDescription('Why?').setMaxLength(400),
  )
  .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers);

export async function execute(interaction) {
  const user = interaction.options.getUser('member', true);
  const durationInput = interaction.options.getString('duration', true);
  const reason = interaction.options.getString('reason') ?? 'No reason given';
  const member = await interaction.guild.members.fetch(user.id).catch(() => null);

  if (!member) {
    await interaction.reply({
      embeds: [error(`**${user.tag}** is not in this server.`)],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const durationMs = parseDuration(durationInput);
  if (!durationMs) {
    await interaction.reply({
      embeds: [
        error(
          `I could not read \`${durationInput}\` as a duration. Try \`10m\`, \`2h\` or \`1d\`.`,
        ),
      ],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  if (durationMs > MAX_TIMEOUT_MS) {
    await interaction.reply({
      embeds: [error('Discord caps timeouts at **28 days**.')],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const problem = checkTarget({
    interaction,
    target: member,
    permission: PermissionFlagsBits.ModerateMembers,
    verb: 'time out',
  });
  if (problem) {
    await interaction.reply({
      embeds: [error(problem)],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  await member.timeout(durationMs, `${reason} — by ${interaction.user.tag}`);
  addInfraction({
    guildId: interaction.guildId,
    userId: user.id,
    moderatorId: interaction.user.id,
    type: 'mute',
    reason,
    expiresAt: Date.now() + durationMs,
  });

  await interaction.reply({
    embeds: [
      success(
        `🔇 Timed out **${user.tag}** for **${formatDurationMs(durationMs)}** — ${reason}`,
      ),
    ],
  });
}
