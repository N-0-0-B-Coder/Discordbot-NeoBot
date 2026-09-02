/**
 * Currency conversion, so prices from different Steam regions can be compared.
 *
 * Steam quotes each region in its own currency. ₫239,000 against ₺249 against
 * $9.99 is three numbers that cannot be ranked, so a comparison feature is
 * useless without rates.
 *
 * open.er-api.com is used because it needs no account — which is the entire
 * point of this feature existing. Adding a keyed service here would reintroduce
 * exactly the signup step people wanted to avoid.
 *
 * Rates update daily and are cached for twelve hours. That is far more accuracy
 * than the job needs: this ranks store prices, it does not settle trades, and a
 * rate a few hours old cannot change which region is cheapest by any margin
 * worth acting on.
 */
import { createCache, fetchJson } from '../lib/http.js';
import { log } from '../lib/logger.js';

const RATES_URL = 'https://open.er-api.com/v6/latest/USD';
const cache = createCache({ ttlMs: 12 * 60 * 60 * 1000 });

/**
 * USD-based rates, or null when they cannot be fetched.
 *
 * Null is a first-class answer here rather than a thrown error: without rates
 * the caller can still show every region's native price, just unranked. Losing
 * the ordering is a much smaller failure than losing the whole command.
 */
export async function getRates() {
  try {
    const payload = await cache.wrap('usd', () => fetchJson(new URL(RATES_URL)));
    if (payload?.result !== 'success' || !payload.rates) return null;
    return payload.rates;
  } catch (err) {
    log.warn('Could not fetch exchange rates; regional prices stay unranked.', err);
    return null;
  }
}

/**
 * Converts an amount to USD.
 *
 * @returns {number|null} null when the currency is unknown to the rate table —
 *   better an unranked row than a confidently wrong number.
 */
export function toUsd(amount, currency, rates) {
  if (amount === null || amount === undefined || !rates) return null;
  if (!currency || currency === 'USD') return amount;

  const rate = rates[currency.toUpperCase()];
  if (!rate || rate <= 0) return null;
  return amount / rate;
}
