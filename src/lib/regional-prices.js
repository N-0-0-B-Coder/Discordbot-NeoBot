/**
 * Renders a cross-region Steam price comparison.
 *
 * This is the no-account answer to "where is it cheapest": Steam's own store
 * API takes a country code, so the comparison needs nothing but Steam and a
 * currency table. IsThereAnyDeal compares STORES; this compares COUNTRIES, and
 * the two answer different questions.
 *
 * It is deliberately honest about what it cannot do — see BUYING_NOTE.
 */
import { flag } from './regions.js';
import { getRates, toUsd } from '../services/fx.js';
import * as steam from '../services/steam.js';
import { log } from './logger.js';

/**
 * Steam ties purchases to the country of your payment method, and treats
 * working around that as account abuse. Showing the prices is ordinary public
 * information — SteamDB publishes the same table — but presenting it as a way
 * to buy cheaply would be selling something that does not work and can get an
 * account restricted. So the note ships with every comparison.
 */
export const BUYING_NOTE =
  'Steam sells at your payment method\'s country, so these are for comparison — ' +
  'not prices you can switch to.';

const usd = (amount) => `$${amount.toFixed(2)}`;

/**
 * Builds the comparison lines, cheapest first.
 *
 * @param {Array} regions from steam.getRegionalPrices()
 * @param {number} limit how many rows to render
 * @returns {Promise<{lines: string[], ranked: boolean, cheapest: object|null}>}
 */
export async function describeRegionalPrices(regions, { limit = 8, rates } = {}) {
  if (regions.length === 0) return { lines: [], ranked: false, cheapest: null };

  // Injectable so tests rank real currencies without depending on a live rate
  // service — a suite that fails when someone else's API has a bad morning is
  // not testing this code.
  const table = rates === undefined ? await getRates() : rates;
  const priced = regions.map((region) => ({
    ...region,
    usd: toUsd(region.amount, region.currency, table),
  }));

  // Without rates, or for a currency the table does not carry, there is no
  // common scale — so show the regions unranked rather than ordering them by a
  // number that does not mean anything.
  const comparable = priced.filter((region) => region.usd !== null);
  const ranked = comparable.length > 1;
  const rows = ranked
    ? [...comparable].sort((a, b) => a.usd - b.usd)
    : priced;

  const lines = rows.slice(0, limit).map((region) => {
    const converted = region.usd !== null && region.currency !== 'USD'
      ? ` ≈ ${usd(region.usd)}`
      : '';
    const cut = region.discountPercent > 0 ? ` **-${region.discountPercent}%**` : '';
    return `${flag(region.code)} ${region.name} — ${region.formatted}${converted}${cut}`;
  });

  return { lines, ranked, cheapest: ranked ? rows[0] : null };
}

/**
 * The line shown when the server's own country cannot buy the game at all.
 *
 * This is the case that started the feature: a game missing from your local
 * store looks identical to a game that does not exist, and "no results" is a
 * bad answer when the truth is "not sold in your region, but $9.99 in the US".
 */
export function notSoldHere(country, cheapest) {
  const base = `**Not sold on the ${country} store.**`;
  return cheapest
    ? `${base} The cheapest region that has it is ${flag(cheapest.code)} ${cheapest.name} at ${cheapest.formatted}.`
    : `${base} I could not find a region that sells it either.`;
}

/**
 * Adds the region fields to an embed, for whichever command asked.
 *
 * Shared by /steam and /deals so the two cannot drift: the rule about when to
 * show this is more subtle than it looks — always on request, and also
 * unprompted when the local store has no price, because that is the case where
 * silence is misleading rather than merely quiet.
 *
 * Steam-only by nature: the comparison works by asking one storefront about
 * many countries, so a game with no Steam listing has nothing to compare.
 *
 * @returns {Promise<boolean>} whether anything was added.
 */
export async function attachRegionalPrices(embed, options) {
  const { appId, country, availableLocally = true, comingSoon = false, requested } = options;

  const localHasPrice = availableLocally && options.hasLocalPrice;
  if (!requested && localHasPrice) return false;

  if (!appId) {
    // Only reachable when someone explicitly asked; an automatic attempt on a
    // game with no Steam listing should stay quiet rather than explain itself.
    if (requested) {
      embed.addFields({
        name: '🌍 Prices by region',
        value: 'I compare regions through Steam, and this game is not listed there.',
      });
    }
    return requested;
  }

  const regions = await steam.getRegionalPrices(appId).catch((err) => {
    log.warn('Regional price lookup failed:', err);
    return [];
  });
  const { lines, ranked, cheapest } = await describeRegionalPrices(regions);

  if (!localHasPrice && !comingSoon) {
    embed.addFields({
      name: '🌍 Not available in your region',
      value: notSoldHere(country, cheapest),
    });
  }

  if (lines.length > 0) {
    embed.addFields({
      name: ranked ? '🌍 Cheapest regions' : '🌍 Prices by region',
      value: [lines.join('\n'), '', `*${BUYING_NOTE}*`].join('\n'),
    });
  } else if (requested) {
    embed.addFields({
      name: '🌍 Prices by region',
      value: 'No region I checked is selling this right now.',
    });
  }

  return true;
}
