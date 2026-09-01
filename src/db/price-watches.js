/**
 * Saved price watches: "tell #deals when Terraria changes price".
 *
 * A watch stores the last price it reported so the next check has something to
 * compare against. That comparison lives in the database rather than in memory
 * on purpose — the whole feature is worthless if a redeploy resets it and the
 * bot re-announces every game it is watching.
 */
import { db } from './index.js';

/** Hard cap per server. Each watch is an API call every sweep. */
export const MAX_WATCHES_PER_GUILD = 25;

const insert = db.prepare(`
  INSERT INTO price_watches
    (guild_id, channel_id, source, ref, title, created_by, created_at)
  VALUES
    (@guildId, @channelId, @source, @ref, @title, @createdBy, @createdAt)
  ON CONFLICT (guild_id, source, ref) DO UPDATE SET
    channel_id = @channelId,
    title      = @title
`);

const selectForGuild = db.prepare(`
  SELECT * FROM price_watches WHERE guild_id = ? ORDER BY created_at
`);

const selectAll = db.prepare('SELECT * FROM price_watches ORDER BY checked_at IS NOT NULL, checked_at');

const countForGuild = db.prepare(
  'SELECT COUNT(*) AS n FROM price_watches WHERE guild_id = ?',
);

const deleteOne = db.prepare('DELETE FROM price_watches WHERE guild_id = ? AND id = ?');

const deleteChannel = db.prepare('DELETE FROM price_watches WHERE channel_id = ?');

const recordPrice = db.prepare(`
  UPDATE price_watches
     SET last_amount = @amount, last_currency = @currency, last_shop = @shop,
         checked_at = @checkedAt
   WHERE id = @id
`);

const touch = db.prepare('UPDATE price_watches SET checked_at = ? WHERE id = ?');

/**
 * Creates a watch, or repoints an existing one at a new channel.
 *
 * Returns `{ watch, created }` so the caller can say "now watching" rather than
 * "moved to #channel" — a silent no-op on a repeated command is confusing.
 */
export function addWatch({ guildId, channelId, source, ref, title, createdBy }) {
  const existing = findWatch(guildId, source, ref);
  if (!existing && countForGuild.get(guildId).n >= MAX_WATCHES_PER_GUILD) {
    return { watch: null, created: false, atLimit: true };
  }

  insert.run({
    guildId,
    channelId,
    source,
    ref: String(ref),
    title,
    createdBy,
    createdAt: Date.now(),
  });

  return { watch: findWatch(guildId, source, ref), created: !existing, atLimit: false };
}

export function findWatch(guildId, source, ref) {
  return (
    db
      .prepare(
        'SELECT * FROM price_watches WHERE guild_id = ? AND source = ? AND ref = ?',
      )
      .get(guildId, source, String(ref)) ?? null
  );
}

export const listWatches = (guildId) => selectForGuild.all(guildId);

/** Every watch across every guild, least-recently-checked first. */
export const allWatches = () => selectAll.all();

export const removeWatch = (guildId, id) => deleteOne.run(guildId, id).changes > 0;

/** Drops watches pointing at a channel that no longer exists. */
export const removeWatchesForChannel = (channelId) => deleteChannel.run(channelId).changes;

export function recordCheck(id, price) {
  if (!price) {
    touch.run(Date.now(), id);
    return;
  }
  recordPrice.run({
    id,
    amount: price.amount,
    currency: price.currency ?? null,
    shop: price.shop ?? null,
    checkedAt: Date.now(),
  });
}
