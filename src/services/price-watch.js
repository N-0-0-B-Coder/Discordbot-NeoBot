/**
 * The background half of the price watch feature: re-check saved games and
 * report when the price moves.
 *
 * Two rules shape everything here.
 *
 * ONE, it must survive its own failures. A watch pointing at a deleted channel,
 * a game ITAD stops knowing about, an API having a bad afternoon — none of
 * those may stop the other watches from being checked, and none may kill the
 * timer. RNBot lost a background job permanently that way: it caught its error
 * and then broke out of the loop, so the feature stayed dead until a restart
 * that nobody knew to perform.
 *
 * TWO, it must not spam. The first check after a watch is created only records
 * the price; it never announces. Otherwise adding a watch would immediately
 * report a "change" from nothing to the current price.
 */
import { EmbedBuilder } from 'discord.js';
import { COLORS } from '../lib/embeds.js';
import { log } from '../lib/logger.js';
import { report } from '../lib/error-reporter.js';
import {
  allWatches,
  recordCheck,
  removeWatchesForChannel,
} from '../db/price-watches.js';
import * as itad from './itad.js';
import * as steam from './steam.js';

/**
 * Gap between individual lookups inside one sweep.
 *
 * Steam's storefront is IP rate-limited and the ITAD key has a quota, both
 * shared with whatever people are typing at the time. A sweep is never urgent,
 * so it goes slowly and stays out of the way of live commands.
 */
const SPACING_MS = 1_500;

/** Ignore differences below this — currency rounding is not news. */
const EPSILON = 0.005;

/** Current best price for one watch, or null when nothing could be read. */
async function currentPrice(watch) {
  if (watch.source === 'itad') {
    const prices = await itad.getPrices(watch.guild_id, watch.ref);
    const deals = (prices?.deals ?? []).filter((deal) => deal.price !== null);
    if (deals.length === 0) return null;

    const best = deals.reduce((a, b) => (a.price <= b.price ? a : b));
    return {
      amount: best.price,
      currency: best.currency ?? null,
      shop: best.shop ?? null,
      url: best.url ?? null,
      cut: best.cut ?? 0,
    };
  }

  const game = await steam.getAppDetails(watch.guild_id, watch.ref);
  if (!game) return null;
  if (game.isFree) return { amount: 0, currency: null, shop: 'Steam', url: game.url, cut: 0 };
  if (game.price?.amount == null) return null;

  return {
    amount: game.price.amount,
    currency: game.price.currency ?? null,
    shop: 'Steam',
    url: game.url,
    cut: game.price.discountPercent ?? 0,
  };
}

const money = (amount, currency) =>
  amount === 0
    ? 'Free'
    : new Intl.NumberFormat('en-US', {
        style: currency ? 'currency' : 'decimal',
        currency: currency ?? undefined,
        minimumFractionDigits: 2,
      }).format(amount);

function changeEmbed(watch, price) {
  const previous = watch.last_amount;
  const dropped = price.amount < previous;
  const delta = Math.abs(previous - price.amount);
  const percent = previous > 0 ? Math.round((delta / previous) * 100) : 0;

  const embed = new EmbedBuilder()
    .setColor(dropped ? COLORS.deal : COLORS.info)
    .setTitle(`${dropped ? '📉' : '📈'} ${watch.title}`)
    .setDescription(
      `**${money(price.amount, price.currency)}**` +
        ` — was ${money(previous, watch.last_currency ?? price.currency)}` +
        (percent > 0 ? ` (${dropped ? '−' : '+'}${percent}%)` : ''),
    )
    .setFooter({ text: `Source: ${price.shop ?? 'unknown store'}` });

  if (price.url) embed.setURL(price.url);
  if (price.cut > 0) {
    embed.addFields({ name: 'Discount', value: `−${price.cut}%`, inline: true });
  }
  return embed;
}

/**
 * Checks one watch and posts if the price moved.
 *
 * `lookup` is injectable so the announce-or-not decision can be tested without
 * a live store behind it — that rule is the one worth getting right, and it is
 * exactly the part a network call would hide.
 *
 * @returns {'announced'|'recorded'|'unchanged'|'unreadable'|'channel-gone'}
 */
export async function checkWatch(client, watch, { lookup = currentPrice } = {}) {
  const channel = await client.channels.fetch(watch.channel_id).catch(() => null);
  if (!channel?.isTextBased?.()) {
    // The channel was deleted or the bot lost access. Keeping the watch would
    // mean failing forever on every sweep with nowhere to report it.
    removeWatchesForChannel(watch.channel_id);
    log.warn(
      `[${watch.guild_id}] Dropped price watch for "${watch.title}" — channel ${watch.channel_id} is gone.`,
    );
    return 'channel-gone';
  }

  const price = await lookup(watch);
  if (!price) {
    recordCheck(watch.id, null);
    return 'unreadable';
  }

  const isFirstCheck = watch.last_amount === null;
  const moved = !isFirstCheck && Math.abs(watch.last_amount - price.amount) > EPSILON;

  recordCheck(watch.id, price);
  if (isFirstCheck) return 'recorded';
  if (!moved) return 'unchanged';

  await channel.send({ embeds: [changeEmbed(watch, price)] });
  log.info(
    `[${watch.guild_id}] Price change reported for "${watch.title}": ` +
      `${watch.last_amount} -> ${price.amount}.`,
  );
  return 'announced';
}

/** Checks every saved watch, slowly, without ever throwing. */
export async function sweepPriceWatches(client) {
  const watches = allWatches();
  if (watches.length === 0) return;

  log.debug(`Price watch sweep starting for ${watches.length} game(s).`);
  let announced = 0;

  for (const watch of watches) {
    try {
      if (await checkWatch(client, watch) === 'announced') announced += 1;
    } catch (err) {
      // One bad watch must not end the sweep.
      report(`price watch "${watch.title}"`, err, {}, watch.guild_id);
    }
    await new Promise((resolve) => setTimeout(resolve, SPACING_MS));
  }

  if (announced > 0) log.info(`Price watch sweep reported ${announced} change(s).`);
}
