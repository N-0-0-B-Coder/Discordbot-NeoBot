import { EmbedBuilder, SlashCommandBuilder } from 'discord.js';
import { getSetting } from '../../db/guild-settings.js';
import { log } from '../../lib/logger.js';
import { COLORS, error, truncate } from '../../lib/embeds.js';
import * as itad from '../../services/itad.js';
import * as steam from '../../services/steam.js';

export const data = new SlashCommandBuilder()
  .setName('deals')
  .setDescription('Find the cheapest price for a game across every major store.')
  .addStringOption((option) =>
    option
      .setName('game')
      .setDescription('Game title')
      .setRequired(true)
      .setMaxLength(120),
  );

// Steam's storefront is IP rate-limited (~200 req / 5 min) and the ITAD key has
// a quota — both are shared by everyone in the server, so one person mashing
// this command degrades it for the whole group.
export const cooldownMs = 10_000;

export async function execute(interaction) {
  const title = interaction.options.getString('game', true);
  await interaction.deferReply();

  // Two independent sources: ITAD for cross-store comparison, Steam for the
  // storefront detail ITAD does not carry. Run them together and let either one
  // fail without taking the whole command down.
  const [itadResult, steamResult] = await Promise.allSettled([
    itad.isConfigured(interaction.guildId)
      ? itad.lookupDeals(interaction.guildId, title)
      : Promise.resolve(null),
    steam.lookupGame(interaction.guildId, title),
  ]);

  const deals = settled(itadResult, 'ITAD');
  const steamGame = settled(steamResult, 'Steam');

  if (!deals && !steamGame) {
    await interaction.editReply({
      embeds: [
        error(
          `No store listings found for **${truncate(title, 100)}**.` +
            (itad.isConfigured(interaction.guildId)
              ? ''
              : '\n\n*No ITAD key set for this server, so only Steam was searched. An admin can add one with `/config`.*'),
        ),
      ],
    });
    return;
  }

  const name = deals?.game?.title ?? steamGame?.name ?? title;
  const embed = new EmbedBuilder()
    .setColor(COLORS.deal)
    .setTitle(truncate(name, 250))
    .setFooter({
      text: `Prices in ${getSetting(interaction.guildId, 'priceCountry')} · IsThereAnyDeal + Steam`,
    });

  const art =
    deals?.game?.assets?.boxart ?? deals?.game?.assets?.banner300 ?? steamGame?.headerImage;
  if (art) embed.setThumbnail(art);
  if (steamGame?.description) {
    embed.setDescription(truncate(steamGame.description, 300));
  }
  if (steamGame?.url) embed.setURL(steamGame.url);

  const rows = deals?.prices?.deals ?? [];
  if (rows.length > 0) {
    // ITAD returns deals unsorted with respect to price; cheapest first is what
    // anyone actually wants to see.
    const cheapest = [...rows]
      .filter((row) => row.price !== null)
      .sort((a, b) => a.price - b.price)
      .slice(0, 6);

    embed.addFields({
      name: '💰 Best prices right now',
      value:
        cheapest
          .map((row) => {
            const price = formatMoney(row.price, row.currency);
            const cut = row.cut > 0 ? ` (**-${row.cut}%**)` : '';
            const label = row.url ? `[${row.shop}](${row.url})` : row.shop;
            return `${label} — ${price}${cut}`;
          })
          .join('\n') || 'No active listings.',
    });
  }

  if (deals?.prices?.historyLow) {
    const low = deals.prices.historyLow;
    embed.addFields({
      name: '📉 All-time low',
      value: formatMoney(low.amount, low.currency),
      inline: true,
    });
  }

  if (steamGame) {
    embed.addFields({
      name: '🎮 On Steam',
      value: steamPriceLine(steamGame),
      inline: true,
    });
  }

  if (!itad.isConfigured(interaction.guildId)) {
    embed.addFields({
      name: 'Steam-only results',
      value:
        'An admin can add an ITAD key with `/config` to compare Epic, GOG, Humble, Fanatical and the rest.',
    });
  }

  await interaction.editReply({ embeds: [embed] });
}

function settled(result, label) {
  if (result.status === 'fulfilled') return result.value;
  log.warn(`${label} lookup failed:`, result.reason);
  return null;
}

function formatMoney(amount, currency) {
  if (amount === null || amount === undefined) return 'n/a';
  if (amount === 0) return 'Free';
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: currency ?? 'USD',
    }).format(amount);
  } catch {
    // Intl throws on a currency code it does not recognise.
    return `${amount} ${currency ?? ''}`.trim();
  }
}

function steamPriceLine(game) {
  if (game.comingSoon) return `Unreleased${game.releaseDate ? ` — ${game.releaseDate}` : ''}`;
  if (game.isFree) return 'Free to play';
  if (!game.price) return 'Not sold on Steam';
  return game.price.discountPercent > 0
    ? `~~${game.price.initial}~~ **${game.price.final}** (-${game.price.discountPercent}%)`
    : game.price.final;
}
