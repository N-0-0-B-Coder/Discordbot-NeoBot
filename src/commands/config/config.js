import {
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
} from 'discord.js';
import { buildPanel } from '../../components/config.js';
import { countryName, searchCountries, resolveCountry } from '../../lib/countries.js';
import { setSetting, markConfigured } from '../../db/guild-settings.js';

export const data = new SlashCommandBuilder()
  .setName('config')
  .setDescription('Set up the bot for this server.')
  // The one setting that belongs on the command rather than in the panel.
  // Modals cannot autocomplete, and nobody knows their ISO code — so asking for
  // "VN" in a text box was asking people to go and look something up. A slash
  // command option CAN autocomplete, so the country is chosen by name here and
  // stored as a code behind the scenes.
  .addStringOption((option) =>
    option
      .setName('country')
      .setDescription('Set the country used for game prices — type its name')
      .setAutocomplete(true)
      .setMaxLength(60),
  )
  // Hides the command from members without Manage Server. The server owner
  // always has it. Re-checked at runtime below, because an admin can re-grant
  // this per-role and the default is only a UI hint.
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild);

export async function autocomplete(interaction) {
  const query = interaction.options.getFocused();
  await interaction.respond(
    searchCountries(query).map((country) => ({
      name: `${country.name} (${country.code})`,
      // The VALUE is the code — the name is only ever for reading.
      value: country.code,
    })),
  );
}

export async function execute(interaction) {
  if (!interaction.memberPermissions.has(PermissionFlagsBits.ManageGuild)) {
    await interaction.reply({
      content: 'You need the **Manage Server** permission to configure me.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  // Accept a code the autocomplete supplied, or a name someone typed straight
  // past it — "Vietnam" is unambiguous and refusing it would be pedantry.
  const chosen = interaction.options.getString('country');
  if (chosen) {
    const code = resolveCountry(chosen);
    if (!code) {
      await interaction.reply(
        buildPanel(interaction.guild, {
          text: `⚠️ I do not recognise **${chosen}** as a country. Pick one from the list.`,
          error: true,
        }),
      );
      return;
    }

    setSetting(interaction.guildId, 'priceCountry', code);
    markConfigured(interaction.guildId);
    await interaction.reply(
      buildPanel(interaction.guild, {
        text: `🌍 Prices are now shown for **${countryName(code)}**.`,
      }),
    );
    return;
  }

  // buildPanel already carries MessageFlags.Ephemeral — the panel shows the
  // ITAD key's last four characters, so it must never be public.
  await interaction.reply(buildPanel(interaction.guild));
}
