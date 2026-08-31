import {
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
} from 'discord.js';
import { addInfraction } from '../../db/infractions.js';
import { error, success } from '../../lib/embeds.js';

export const data = new SlashCommandBuilder()
  .setName('unban')
  .setDescription('Lift a ban.')
  .addStringOption((option) =>
    option
      .setName('user_id')
      .setDescription("The banned user's ID (start typing to search the ban list)")
      .setRequired(true)
      .setAutocomplete(true),
  )
  .addStringOption((option) =>
    option.setName('reason').setDescription('Why?').setMaxLength(400),
  )
  .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers);

/** Suggests entries from the guild's ban list so nobody has to copy IDs by hand. */
export async function autocomplete(interaction) {
  if (!interaction.memberPermissions?.has(PermissionFlagsBits.BanMembers)) {
    await interaction.respond([]);
    return;
  }
  const query = interaction.options.getFocused().toLowerCase();
  const bans = await interaction.guild.bans.fetch().catch(() => null);
  if (!bans) {
    await interaction.respond([]);
    return;
  }
  const choices = [...bans.values()]
    .filter(
      (ban) =>
        !query ||
        ban.user.tag.toLowerCase().includes(query) ||
        ban.user.id.includes(query),
    )
    .slice(0, 25)
    .map((ban) => ({ name: `${ban.user.tag} (${ban.user.id})`, value: ban.user.id }));
  await interaction.respond(choices);
}

export async function execute(interaction) {
  const userId = interaction.options.getString('user_id', true).trim();
  const reason = interaction.options.getString('reason') ?? 'No reason given';

  if (!interaction.memberPermissions.has(PermissionFlagsBits.BanMembers)) {
    await interaction.reply({
      embeds: [error('You need the **Ban Members** permission.')],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const ban = await interaction.guild.bans.fetch(userId).catch(() => null);
  if (!ban) {
    await interaction.reply({
      embeds: [error(`\`${userId}\` is not banned in this server.`)],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  await interaction.guild.bans.remove(
    userId,
    `${reason} — by ${interaction.user.tag}`,
  );
  addInfraction({
    guildId: interaction.guildId,
    userId,
    moderatorId: interaction.user.id,
    type: 'unban',
    reason,
  });

  await interaction.reply({
    embeds: [success(`🕊️ Unbanned **${ban.user.tag}** — ${reason}`)],
  });
}
