/**
 * IsThereAnyDeal API v2/v3 client — cross-store price comparison.
 * Docs: https://docs.isthereanydeal.com/
 *
 * Get a free key at https://isthereanydeal.com/apps/my/ and set ITAD_API_KEY.
 * Without a key every call here is skipped and /deals falls back to Steam only.
 */
import { getSetting } from '../db/guild-settings.js';
import { createCache, fetchJson } from '../lib/http.js';

const BASE = 'https://api.isthereanydeal.com';

// Store prices change on a daily-ish cadence; 15 minutes is plenty fresh for a
// friend group and keeps repeat lookups off the API.
const cache = createCache({ ttlMs: 15 * 60 * 1000 });

export const isConfigured = (guildId) => Boolean(getSetting(guildId, 'itadApiKey'));

function authHeaders(guildId) {
  return { 'ITAD-API-Key': getSetting(guildId, 'itadApiKey') };
}

/** Searches games by title. Returns [{ id, slug, title, type, assets }]. */
export async function searchGames(guildId, title, results = 5) {
  const url = new URL('/games/search/v1', BASE);
  url.searchParams.set('title', title);
  url.searchParams.set('results', String(results));
  // Cache key includes the guild: different servers may use different keys
  // and different countries.
  return cache.wrap(`search:${guildId}:${title}:${results}`, () =>
    fetchJson(url, { headers: authHeaders(guildId) }),
  );
}

/**
 * Current deals plus historical lows for one game id.
 * Returns { deals: [...], historyLow: {...} } or null when ITAD knows nothing.
 */
export async function getPrices(guildId, gameId) {
  const url = new URL('/games/prices/v3', BASE);
  const country = getSetting(guildId, 'priceCountry');
  url.searchParams.set('country', country);
  // Cap how many shop rows come back — the embed shows a handful at most.
  url.searchParams.set('capacity', '8');

  const payload = await cache.wrap(`prices:${gameId}:${country}`, () =>
    fetchJson(url, {
      method: 'POST',
      headers: { ...authHeaders(guildId), 'Content-Type': 'application/json' },
      body: JSON.stringify([gameId]),
    }),
  );

  const entry = Array.isArray(payload) ? payload[0] : null;
  if (!entry) return null;

  return {
    deals: (entry.deals ?? []).map((deal) => ({
      shop: deal.shop?.name ?? 'Unknown store',
      price: deal.price?.amount ?? null,
      regular: deal.regular?.amount ?? null,
      currency: deal.price?.currency ?? 'USD',
      cut: deal.cut ?? 0,
      url: deal.url ?? null,
    })),
    historyLow: entry.historyLow?.all
      ? {
          amount: entry.historyLow.all.amount,
          currency: entry.historyLow.all.currency,
        }
      : null,
  };
}

/**
 * Convenience wrapper: title in, best-match game plus its prices out.
 * Prefers an exact (case-insensitive) title match over ITAD's first hit, which
 * otherwise tends to surface DLC and soundtracks ahead of the base game.
 */
export async function lookupDeals(guildId, title) {
  const results = await searchGames(guildId, title, 8);
  if (!Array.isArray(results) || results.length === 0) return null;

  const lower = title.trim().toLowerCase();
  const game =
    results.find((r) => r.title?.toLowerCase() === lower) ??
    results.find((r) => r.type === 'game') ??
    results[0];

  const prices = await getPrices(guildId, game.id);
  return { game, prices };
}
