import { EmbedBuilder, SlashCommandBuilder } from 'discord.js';
import { log } from '../../lib/logger.js';
import { COLORS, error, truncate } from '../../lib/embeds.js';
import * as steam from '../../services/steam.js';
import { applyWatchOption, watchOption, priceFooter } from './watch-option.js';

export const data = new SlashCommandBuilder()
  .setName('steam')
  .setDescription('Look up a game on the Steam store.')
  .addStringOption((option) =>
    option
      .setName('game')
      .setDescription('Game title')
      .setRequired(true)
      .setAutocomplete(true)
      .setMaxLength(120),
  )
  .addChannelOption(watchOption);

export async function autocomplete(interaction) {
  const query = interaction.options.getFocused();
  if (query.length < 3) {
    await interaction.respond([]);
    return;
  }
  try {
    // Hard 2s ceiling and no retries: Discord discards an autocomplete reply
    // that arrives after 3 seconds, so anything slower is wasted work. A cache
    // hit returns instantly; a cold miss gives up early rather than retrying
    // into a deadline that has already passed.
    const results = await steam.searchApps(interaction.guildId, query, 10, {
      timeoutMs: 2_000,
      retries: 0,
    });
    await interaction.respond(
      results.map((item) => ({
        name: truncate(item.name, 100),
        // The value carries the app id so execute() can skip a second search.
        value: String(item.appId),
      })),
    );
  } catch {
    // Autocomplete must never throw at the user; an empty list is fine.
    await interaction.respond([]);
  }
}

// Same shared Steam IP budget as /deals. Autocomplete already fires a search
// per keystroke, so the explicit command deserves a floor.
export const cooldownMs = 8_000;

export async function execute(interaction) {
  const input = interaction.options.getString('game', true);
  await interaction.deferReply();

  // Autocomplete hands back a numeric app id; typed text needs a search.
  let game;
  try {
    game = /^\d+$/.test(input)
      ? await steam.getAppDetails(interaction.guildId, Number(input))
      : await steam.lookupGame(interaction.guildId, input);
  } catch (err) {
    // Steam's storefront endpoints are undocumented and go down often enough to
    // be worth naming, rather than showing a generic failure.
    log.warn(`Steam lookup failed for "${input}":`, err);
    await interaction.editReply({
      embeds: [
        error('Steam did not answer. That is usually temporary — try again shortly.'),
      ],
    });
    return;
  }

  if (!game) {
    await interaction.editReply({
      embeds: [error(`Nothing on Steam matched **${truncate(input, 100)}**.`)],
    });
    return;
  }

  const embed = new EmbedBuilder()
    .setColor(COLORS.info)
    .setTitle(truncate(game.name, 250))
    .setURL(game.url)
    .setDescription(truncate(game.description ?? 'No description.', 400))
    .setImage(game.headerImage)
    .addFields(
      { name: 'Price', value: priceLine(game), inline: true },
      {
        name: 'Released',
        value: game.releaseDate ?? 'Unknown',
        inline: true,
      },
    )
    .setFooter({ text: priceFooter(interaction.guildId, ['Steam']) });

  if (game.metacritic) {
    embed.addFields({
      name: 'Metacritic',
      value: String(game.metacritic),
      inline: true,
    });
  }
  if (game.genres.length > 0) {
    embed.addFields({ name: 'Genres', value: game.genres.join(', ') });
  }
  if (game.developers.length > 0) {
    embed.addFields({
      name: 'Developer',
      value: truncate(game.developers.join(', '), 200),
      inline: true,
    });
  }

  const watchNote = await applyWatchOption(interaction, {
    source: 'steam',
    ref: game.appId,
    title: game.name,
  });
  if (watchNote) embed.addFields({ name: '🔔 Price watch', value: watchNote });

  await interaction.editReply({ embeds: [embed] });
}

function priceLine(game) {
  if (game.comingSoon) return 'Not out yet';
  if (game.isFree) return 'Free to play';
  if (!game.price) return 'Unavailable';
  return game.price.discountPercent > 0
    ? `~~${game.price.initial}~~ **${game.price.final}** (-${game.price.discountPercent}%)`
    : game.price.final;
}
