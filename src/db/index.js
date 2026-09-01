import { existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import Database from 'better-sqlite3';
import { config } from '../lib/config.js';
import { log } from '../lib/logger.js';

const path = resolve(config.databasePath);

/**
 * Whether this process created the database rather than opening an existing one.
 *
 * Checked BEFORE the file is opened, because better-sqlite3 creates it on
 * connect. On a hosted platform this is the difference between "the volume is
 * working" and "every setting this server chose is gone", and until now nothing
 * said which had happened — a fresh database looks exactly like a healthy one.
 */
export const databaseIsNew = !existsSync(path);

mkdirSync(dirname(path), { recursive: true });

export const db = new Database(path);

// WAL keeps reads from blocking the single writer, which matters once a music
// queue and a moderation command touch the file at the same time.
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS infractions (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id     TEXT    NOT NULL,
    user_id      TEXT    NOT NULL,
    moderator_id TEXT    NOT NULL,
    type         TEXT    NOT NULL CHECK (type IN ('warn','mute','kick','ban','unban')),
    reason       TEXT,
    created_at   INTEGER NOT NULL,
    expires_at   INTEGER
  );

  CREATE INDEX IF NOT EXISTS idx_infractions_lookup
    ON infractions (guild_id, user_id, created_at DESC);

  CREATE TABLE IF NOT EXISTS price_watches (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id      TEXT    NOT NULL,
    channel_id    TEXT    NOT NULL,
    source        TEXT    NOT NULL CHECK (source IN ('itad','steam')),
    ref           TEXT    NOT NULL,
    title         TEXT    NOT NULL,
    last_amount   REAL,
    last_currency TEXT,
    last_shop     TEXT,
    created_by    TEXT    NOT NULL,
    created_at    INTEGER NOT NULL,
    checked_at    INTEGER
  );

  -- One watch per game per server: asking twice moves the report channel
  -- rather than doubling the reports.
  CREATE UNIQUE INDEX IF NOT EXISTS idx_price_watches_game
    ON price_watches (guild_id, source, ref);

  CREATE TABLE IF NOT EXISTS guild_settings (
    guild_id   TEXT PRIMARY KEY,
    tts_voice  TEXT,
    updated_at INTEGER NOT NULL
  );
`);

log.info(`SQLite ready at ${path} ${databaseIsNew ? '(NEW database)' : '(existing database)'}`);

export function closeDatabase() {
  try {
    db.close();
  } catch (err) {
    log.warn('Failed to close database cleanly:', err);
  }
}
