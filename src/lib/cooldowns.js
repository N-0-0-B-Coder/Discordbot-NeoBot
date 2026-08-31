/**
 * Per-user, per-command cooldowns.
 *
 * Ported from RNBot, which guarded its heaviest Torn API command with a
 * `cooldowns` Map and a 30-second timer. The reasoning holds here: a friend
 * group will absolutely spam `/deals` at each other, and the Steam storefront
 * is IP rate-limited (~200 requests / 5 min) — one person mashing a command
 * degrades it for everyone in the server.
 *
 * Deliberately in-memory: cooldowns are seconds long and a restart clearing
 * them is harmless. Nothing here belongs in the database.
 */
import { log } from './logger.js';

// key: `${commandName}:${userId}` -> timestamp (ms) when the cooldown expires
const expiries = new Map();

// Sweep stale entries so a busy server cannot grow this Map without bound.
const SWEEP_INTERVAL_MS = 10 * 60 * 1000;
const sweeper = setInterval(() => {
  const now = Date.now();
  let removed = 0;
  for (const [key, expiresAt] of expiries) {
    if (expiresAt <= now) {
      expiries.delete(key);
      removed++;
    }
  }
  if (removed > 0) log.debug(`Cooldown sweep cleared ${removed} entry/entries.`);
}, SWEEP_INTERVAL_MS);
sweeper.unref();

/**
 * Checks and starts a cooldown in one call.
 *
 * Returns 0 when the command may run (and arms the cooldown), or the number of
 * milliseconds remaining when it may not.
 */
export function consume(commandName, userId, cooldownMs) {
  if (!cooldownMs || cooldownMs <= 0) return 0;

  const key = `${commandName}:${userId}`;
  const now = Date.now();
  const expiresAt = expiries.get(key);

  if (expiresAt && expiresAt > now) return expiresAt - now;

  expiries.set(key, now + cooldownMs);
  return 0;
}

/** Clears a user's cooldown — used when a command bails before doing real work. */
export function release(commandName, userId) {
  expiries.delete(`${commandName}:${userId}`);
}
