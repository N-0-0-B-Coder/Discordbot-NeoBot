import {
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
} from 'discord.js';
import { buildPanel } from '../../components/config.js';

export const data = new SlashCommandBuilder()
  .setName('config')
  .setDescription('Set up the bot for this server.')
  // Hides the command from members without Manage Server. The server owner
  // always has it. Re-checked at runtime below, because an admin can re-grant
  // this per-role and the default is only a UI hint.
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild);

export async function execute(interaction) {
  if (!interaction.memberPermissions.has(PermissionFlagsBits.ManageGuild)) {
    await interaction.reply({
      content: 'You need the **Manage Server** permission to configure me.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  // buildPanel already carries MessageFlags.Ephemeral — the panel shows the
  // ITAD key's last four characters, so it must never be public.
  await interaction.reply(buildPanel(interaction.guild));
}
