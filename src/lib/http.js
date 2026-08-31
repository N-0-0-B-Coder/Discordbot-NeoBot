import { log } from './logger.js';

const DEFAULT_TIMEOUT_MS = 8_000;
const DEFAULT_RETRIES = 2;
const BASE_BACKOFF_MS = 500;
const MAX_BACKOFF_MS = 8_000;

export class HttpError extends Error {
  constructor(status, url) {
    super(`HTTP ${status} from ${url}`);
    this.name = 'HttpError';
    this.status = status;
  }
}

/**
 * fetch + JSON with a hard timeout, retries and 429 handling.
 *
 * Third-party store APIs are the slowest thing this bot touches, and an
 * interaction that never resolves is worse than one that fails fast.
 *
 * The retry logic exists because RNBot had none — 69 files, zero handling of
 * 429 or transient failures, so any blip surfaced to the user as an outright
 * error. Retries here are deliberately conservative: only idempotent-safe
 * failures (429, 5xx, network/timeout), few attempts, and a total budget that
 * still fits inside Discord's 15-minute post-defer window with room to spare.
 */
export async function fetchJson(url, options = {}) {
  const {
    timeoutMs = DEFAULT_TIMEOUT_MS,
    retries = DEFAULT_RETRIES,
    ...init
  } = options;

  let lastError;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await attemptFetch(url, init, timeoutMs);
    } catch (err) {
      lastError = err;
      if (attempt === retries || !isRetryable(err)) throw err;

      // Honour Retry-After when the server sends one; otherwise back off
      // exponentially with jitter so parallel callers do not resynchronise.
      const waitMs =
        err.retryAfterMs ??
        Math.min(BASE_BACKOFF_MS * 2 ** attempt, MAX_BACKOFF_MS) +
          Math.random() * 250;

      log.debug(
        `${describe(err)} from ${String(url)} — retry ${attempt + 1}/${retries} in ${Math.round(waitMs)}ms`,
      );
      await sleep(waitMs);
    }
  }
  throw lastError;
}

async function attemptFetch(url, init, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      ...init,
      signal: controller.signal,
      headers: {
        'User-Agent': 'NeoBot (Discord bot; hobby project)',
        ...init.headers,
      },
    });
    if (!response.ok) {
      const error = new HttpError(response.status, url);
      if (response.status === 429) {
        // Retry-After is in seconds per the HTTP spec.
        const header = Number(response.headers.get('retry-after'));
        if (Number.isFinite(header) && header > 0) {
          error.retryAfterMs = Math.min(header * 1000, MAX_BACKOFF_MS);
        }
      }
      throw error;
    }
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

/** 429 and 5xx are worth retrying; 4xx (bad key, unknown game) never is. */
function isRetryable(err) {
  if (err instanceof HttpError) return err.status === 429 || err.status >= 500;
  // AbortError (our timeout) and network-level failures.
  return err?.name === 'AbortError' || err?.name === 'TypeError';
}

function describe(err) {
  if (err instanceof HttpError) return `HTTP ${err.status}`;
  return err?.name === 'AbortError' ? 'timeout' : (err?.name ?? 'error');
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Tiny in-process TTL cache. Store prices move slowly and a friend group will
 * happily look up the same game five times in a row, so this cuts most repeat
 * calls without pulling in a cache dependency.
 */
export function createCache({ ttlMs, maxEntries = 200 }) {
  const entries = new Map();

  return {
    async wrap(key, producer) {
      const hit = entries.get(key);
      if (hit && hit.expiresAt > Date.now()) {
        log.debug(`cache hit: ${key}`);
        return hit.value;
      }

      const value = await producer();
      // Map preserves insertion order, so the first key is the oldest.
      if (entries.size >= maxEntries) {
        entries.delete(entries.keys().next().value);
      }
      entries.set(key, { value, expiresAt: Date.now() + ttlMs });
      return value;
    },
  };
}
