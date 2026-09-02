/**
 * Steam storefront client.
 *
 * These are the storefront's own public JSON endpoints — no key, no signup.
 * They are undocumented and unversioned, so they can change without notice;
 * every caller here treats a failure as "no Steam data" rather than an error.
 * They are also rate-limited by IP (roughly 200 requests per 5 minutes), which
 * the cache below keeps us well clear of.
 */
import { getSetting } from '../db/guild-settings.js';
import { createCache, fetchJson } from '../lib/http.js';
import { REGIONS } from '../lib/regions.js';

const STORE = 'https://store.steampowered.com';

const searchCache = createCache({ ttlMs: 60 * 60 * 1000 });
const detailsCache = createCache({ ttlMs: 15 * 60 * 1000 });
// Regional prices move only when a sale starts, and one lookup fills sixteen
// entries — so this is cached longer and given room for several games.
const regionCache = createCache({ ttlMs: 60 * 60 * 1000, maxEntries: 500 });

/**
 * Searches the Steam store. Returns [{ appId, name, thumbnail }].
 *
 * `fetchOptions` exists for the autocomplete caller, which has a 3-second
 * budget and must override the default 8s timeout and 2 retries — those add up
 * to far longer than Discord will wait, and every retry after the deadline is
 * work nobody can receive.
 */
export async function searchApps(guildId, term, limit = 5, fetchOptions = {}, { fallbackToLocal = true } = {}) {
  // SEARCH the widest catalogue, PRICE in the local one. Searching the local
  // storefront hides everything it does not sell — and hides it partially,
  // which is worse than hiding it completely: Helldivers 2 is not sold in
  // Vietnam, so a Vietnamese search for it returned only its armour-set DLC,
  // and the game itself was unfindable. Availability is now reported by the
  // regional comparison instead of silently shaping what you can look up.
  let items = await rawSearch(SEARCH_COUNTRY, term, fetchOptions);

  // The wide catalogue is not a strict superset — a title can be delisted in
  // the US and sold elsewhere — so fall back rather than insisting.
  //
  // Autocomplete opts out: two sequential requests cannot fit in Discord's 3
  // second window, and a second search that usually finds nothing is a poor
  // trade for blowing the deadline on every miss.
  if (items.length === 0 && fallbackToLocal) {
    items = await rawSearch(getSetting(guildId, 'priceCountry'), term, fetchOptions);
  }

  return rankResults(items, term)
    .slice(0, limit)
    .map((item) => ({
      appId: item.id,
      name: item.name,
      thumbnail: item.tiny_image ?? null,
    }));
}

/**
 * The storefront searched for DISCOVERY, as opposed to for pricing.
 *
 * The US catalogue is the broadest generally available one. It is not
 * universal, which is why searchApps() falls back to the server's own country.
 */
const SEARCH_COUNTRY = 'US';

async function rawSearch(country, term, fetchOptions) {
  const url = new URL('/api/storesearch/', STORE);
  url.searchParams.set('term', term);
  url.searchParams.set('l', 'english');
  url.searchParams.set('cc', country);

  const payload = await searchCache.wrap(
    `search:${country}:${term}`,
    () => fetchJson(url, fetchOptions),
  );
  return payload?.items ?? [];
}

/**
 * Puts base games above their add-ons.
 *
 * Steam returns DLC interleaved with games, and searching a title whose base
 * game is unavailable leaves a list made entirely of its DLC — which reads as
 * "this game does not exist" rather than "you cannot buy it here". Even where
 * the base game IS present, "Helldivers 2" should outrank "Helldivers 2 -
 * TR-117 Alpha Commander Armor Set".
 *
 * Exported for testing: the ordering is the whole fix, and it is pure.
 */
export function rankResults(items, term) {
  const query = term.trim().toLowerCase();

  const score = (item) => {
    const name = String(item.name ?? '').toLowerCase();
    let value = 0;
    // Steam labels these; treat a missing type as an ordinary app rather than
    // demoting everything on an endpoint that stops sending the field.
    if (item.type && item.type !== 'app' && item.type !== 'game') value -= 4;
    // A separator usually introduces an edition, a pack or a DLC name.
    if (/\s[-–—:]\s/.test(name)) value -= 2;
    if (name === query) value += 4;
    else if (name.startsWith(query)) value += 2;
    return value;
  };

  // Sort is stable in Node, so equal scores keep Steam's own relevance order.
  return [...items].sort((a, b) => score(b) - score(a));
}

/** Full store details for one app id, or null when Steam has nothing. */
export async function getAppDetails(guildId, appId) {
  const country = getSetting(guildId, 'priceCountry');
  let entry = await appDetails(appId, country);

  // A game the local store does not carry can come back with no data at all.
  // Returning null there would report "nothing matched", which is the same
  // wrong answer as before by a different route — the game exists, it is just
  // not for sale here. Fetch the details from the discovery storefront and let
  // the caller say so.
  const availableLocally = Boolean(entry);
  if (!entry && country !== SEARCH_COUNTRY) {
    entry = await appDetails(appId, SEARCH_COUNTRY);
  }
  if (!entry) return null;

  const data = entry;
  const price = data.price_overview;

  return {
    appId,
    availableLocally,
    name: data.name,
    description: data.short_description ?? null,
    headerImage: data.header_image ?? null,
    isFree: Boolean(data.is_free),
    // Steam returns money as integer minor units (1999 = $19.99).
    //
    // Suppressed entirely when the details came from the fallback storefront:
    // that is another country's price, and showing it under a local heading
    // would be worse than showing none. The regional comparison reports it
    // properly, labelled with the country it belongs to.
    price: price && availableLocally
      ? {
          discountPercent: price.discount_percent ?? 0,
          initial: price.initial_formatted || price.final_formatted,
          final: price.final_formatted,
          currency: price.currency,
          // The formatted strings are for humans; price watching needs to
          // COMPARE prices, and "$4.99" does not subtract. Steam sends money as
          // integer minor units (1999 = $19.99).
          amount: typeof price.final === 'number' ? price.final / 100 : null,
        }
      : null,
    developers: data.developers ?? [],
    publishers: data.publishers ?? [],
    genres: (data.genres ?? []).map((genre) => genre.description),
    metacritic: data.metacritic?.score ?? null,
    releaseDate: data.release_date?.date ?? null,
    comingSoon: Boolean(data.release_date?.coming_soon),
    url: `${STORE}/app/${appId}/`,
  };
}

/** One storefront's data for an app, or null when it does not carry it. */
async function appDetails(appId, country) {
  const url = new URL('/api/appdetails', STORE);
  url.searchParams.set('appids', String(appId));
  url.searchParams.set('cc', country);
  url.searchParams.set('l', 'english');

  try {
    const payload = await detailsCache.wrap(`details:${country}:${appId}`, () =>
      fetchJson(url),
    );
    const entry = payload?.[String(appId)];
    return entry?.success && entry.data ? entry.data : null;
  } catch {
    return null;
  }
}

/** Convenience: search by name and return details for the best match. */
export async function lookupGame(guildId, term) {
  const [first] = await searchApps(guildId, term, 1);
  if (!first) return null;
  return getAppDetails(guildId, first.appId);
}

/**
 * The same game's price in every comparison region.
 *
 * Steam's storefront takes a `cc` parameter and answers with that country's
 * price, so cross-region comparison needs no third-party service and no
 * account — which matters, because avoiding a signup is the whole reason this
 * exists alongside the IsThereAnyDeal path.
 *
 * `filters=price_overview` keeps each response tiny; without it Steam sends the
 * full store page for every region, which is megabytes for one number.
 *
 * Requests are sequential and spaced. Sixteen parallel calls is exactly the
 * shape of traffic Steam's per-IP limit exists to stop, and a lookup nobody is
 * timing is the wrong place to be in a hurry.
 *
 * @returns {Promise<Array<{code, name, amount, currency, formatted, discountPercent}>>}
 *   one entry per region that sells the game. Regions that do not sell it are
 *   absent rather than null — "not for sale here" is the answer, not a gap.
 */
export async function getRegionalPrices(appId, { spacingMs = 120 } = {}) {
  const found = [];

  for (const region of REGIONS) {
    const price = await regionalPrice(appId, region.code);
    if (price) found.push({ ...region, ...price });
    if (spacingMs) await new Promise((resolve) => setTimeout(resolve, spacingMs));
  }

  return found;
}

async function regionalPrice(appId, code) {
  const url = new URL('/api/appdetails', STORE);
  url.searchParams.set('appids', String(appId));
  url.searchParams.set('cc', code);
  url.searchParams.set('filters', 'price_overview');

  try {
    const payload = await regionCache.wrap(`region:${appId}:${code}`, () =>
      fetchJson(url, { timeoutMs: 5_000, retries: 0 }),
    );
    const price = payload?.[String(appId)]?.data?.price_overview;
    if (!price || typeof price.final !== 'number') return null;

    return {
      amount: price.final / 100,
      currency: price.currency,
      formatted: price.final_formatted,
      discountPercent: price.discount_percent ?? 0,
    };
  } catch {
    // One unreachable region must not lose the other fifteen.
    return null;
  }
}
