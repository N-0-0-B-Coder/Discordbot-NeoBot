import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import Database from 'better-sqlite3';
import { config } from '../lib/config.js';
import { log } from '../lib/logger.js';

const path = resolve(config.databasePath);
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

  CREATE TABLE IF NOT EXISTS guild_settings (
    guild_id   TEXT PRIMARY KEY,
    tts_voice  TEXT,
    updated_at INTEGER NOT NULL
  );
`);

log.info(`SQLite ready at ${path}`);

export function closeDatabase() {
  try {
    db.close();
  } catch (err) {
    log.warn('Failed to close database cleanly:', err);
  }
}
