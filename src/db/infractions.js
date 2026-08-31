import { db } from './index.js';

const insertStmt = db.prepare(`
  INSERT INTO infractions (guild_id, user_id, moderator_id, type, reason, created_at, expires_at)
  VALUES (@guildId, @userId, @moderatorId, @type, @reason, @createdAt, @expiresAt)
`);

const listStmt = db.prepare(`
  SELECT id, moderator_id AS moderatorId, type, reason, created_at AS createdAt,
         expires_at AS expiresAt
  FROM infractions
  WHERE guild_id = ? AND user_id = ?
  ORDER BY created_at DESC
  LIMIT ?
`);

const countStmt = db.prepare(`
  SELECT type, COUNT(*) AS count
  FROM infractions
  WHERE guild_id = ? AND user_id = ?
  GROUP BY type
`);

const deleteOneStmt = db.prepare(
  'DELETE FROM infractions WHERE id = ? AND guild_id = ?',
);

const deleteAllForUserStmt = db.prepare(
  'DELETE FROM infractions WHERE guild_id = ? AND user_id = ?',
);

const purgeOlderThanStmt = db.prepare(
  'DELETE FROM infractions WHERE created_at < ?',
);

/** Records an infraction and returns its row id. */
export function addInfraction({
  guildId,
  userId,
  moderatorId,
  type,
  reason = null,
  expiresAt = null,
}) {
  const result = insertStmt.run({
    guildId,
    userId,
    moderatorId,
    type,
    reason,
    createdAt: Date.now(),
    expiresAt,
  });
  return Number(result.lastInsertRowid);
}

export function listInfractions(guildId, userId, limit = 25) {
  return listStmt.all(guildId, userId, limit);
}

export function countInfractions(guildId, userId) {
  const counts = { warn: 0, mute: 0, kick: 0, ban: 0, unban: 0, total: 0 };
  for (const row of countStmt.all(guildId, userId)) {
    counts[row.type] = row.count;
    counts.total += row.count;
  }
  return counts;
}

export function deleteInfraction(guildId, id) {
  return deleteOneStmt.run(id, guildId).changes > 0;
}

export function clearInfractions(guildId, userId) {
  return deleteAllForUserStmt.run(guildId, userId).changes;
}

/**
 * Enforces the 30-day retention promised in PRIVACY_POLICY.md §3. Called on a
 * timer from src/index.js — the policy is a commitment, not a nice-to-have.
 */
export function purgeExpiredInfractions(retentionDays = 30) {
  const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
  return purgeOlderThanStmt.run(cutoff).changes;
}
