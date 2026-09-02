import { EmbedBuilder, SlashCommandBuilder } from 'discord.js';
import { log } from '../../lib/logger.js';
import { COLORS, error, truncate } from '../../lib/embeds.js';
import * as steam from '../../services/steam.js';
import { applyWatchOption, watchOption, priceFooter } from '../../lib/watch-option.js';
import { getSetting } from '../../db/guild-settings.js';
import { echoChoice, respondInTime } from '../../lib/autocomplete.js';
import { attachRegionalPrices } from '../../lib/regional-prices.js';

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
  .addBooleanOption((option) =>
    option
      .setName('worldwide')
      .setDescription('Compare the price across 16 Steam regions'),
  )
  .addChannelOption(watchOption);

export async function autocomplete(interaction) {
  const query = interaction.options.getFocused();
  if (query.length < 3) {
    await interaction.respond([]);
    return;
  }

  // One search, no retries, and a hard deadline enforced by respondInTime.
  // Everything here is sized against Discord's 3 second window rather than
  // against how long Steam might like to take.
  const work = steam
    .searchApps(interaction.guildId, query, 10, { timeoutMs: 1_800, retries: 0 }, {
      fallbackToLocal: false,
    })
    .then((results) =>
      results.map((item) => ({
        name: truncate(item.name, 100),
        // The value carries the app id so execute() can skip a second search.
        value: String(item.appId),
      })),
    );

  // execute() also accepts free text, so offering the typed string back keeps
  // the command usable when Steam is slow.
  await respondInTime(interaction, work, {
    fallback: echoChoice(query),
    label: '/steam autocomplete',
  });
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

  // Compare across countries when asked — and ALWAYS when the local store has
  // no price, because that is the case where "no price" is a misleading answer:
  // the game may simply not be sold here while costing $9.99 elsewhere.
  await attachRegionalPrices(embed, {
    appId: game.appId,
    country: getSetting(interaction.guildId, 'priceCountry'),
    availableLocally: game.availableLocally !== false,
    hasLocalPrice: Boolean(game.price) || game.isFree,
    comingSoon: game.comingSoon,
    requested: interaction.options.getBoolean('worldwide') ?? false,
  });

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
  if (game.availableLocally === false) return 'Not sold in your region';
  if (game.isFree) return 'Free to play';
  if (!game.price) return 'Unavailable';
  return game.price.discountPercent > 0
    ? `~~${game.price.initial}~~ **${game.price.final}** (-${game.price.discountPercent}%)`
    : game.price.final;
}
