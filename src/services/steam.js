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

const STORE = 'https://store.steampowered.com';

const searchCache = createCache({ ttlMs: 60 * 60 * 1000 });
const detailsCache = createCache({ ttlMs: 15 * 60 * 1000 });

/**
 * Searches the Steam store. Returns [{ appId, name, thumbnail }].
 *
 * `fetchOptions` exists for the autocomplete caller, which has a 3-second
 * budget and must override the default 8s timeout and 2 retries — those add up
 * to far longer than Discord will wait, and every retry after the deadline is
 * work nobody can receive.
 */
export async function searchApps(guildId, term, limit = 5, fetchOptions = {}) {
  const url = new URL('/api/storesearch/', STORE);
  url.searchParams.set('term', term);
  url.searchParams.set('l', 'english');
  url.searchParams.set('cc', getSetting(guildId, 'priceCountry'));

  const payload = await searchCache.wrap(
    `search:${guildId}:${term}`,
    () => fetchJson(url, fetchOptions),
  );

  return (payload?.items ?? []).slice(0, limit).map((item) => ({
    appId: item.id,
    name: item.name,
    thumbnail: item.tiny_image ?? null,
  }));
}

/** Full store details for one app id, or null when Steam has nothing. */
export async function getAppDetails(guildId, appId) {
  const url = new URL('/api/appdetails', STORE);
  url.searchParams.set('appids', String(appId));
  url.searchParams.set('cc', getSetting(guildId, 'priceCountry'));
  url.searchParams.set('l', 'english');

  const payload = await detailsCache.wrap(
    `details:${guildId}:${appId}`,
    () => fetchJson(url),
  );

  const entry = payload?.[String(appId)];
  if (!entry?.success || !entry.data) return null;

  const data = entry.data;
  const price = data.price_overview;

  return {
    appId,
    name: data.name,
    description: data.short_description ?? null,
    headerImage: data.header_image ?? null,
    isFree: Boolean(data.is_free),
    // Steam returns money as integer minor units (1999 = $19.99).
    price: price
      ? {
          discountPercent: price.discount_percent ?? 0,
          initial: price.initial_formatted || price.final_formatted,
          final: price.final_formatted,
          currency: price.currency,
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

/** Convenience: search by name and return details for the best match. */
export async function lookupGame(guildId, term) {
  const [first] = await searchApps(guildId, term, 1);
  if (!first) return null;
  return getAppDetails(guildId, first.appId);
}
