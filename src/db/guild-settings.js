import { db } from './index.js';
import { log } from '../lib/logger.js';
import { SETTINGS, SETTINGS_BY_KEY } from '../lib/guild-config.js';

/**
 * Adds any columns the settings schema declares but the table lacks.
 *
 * `CREATE TABLE IF NOT EXISTS` does nothing to a table that already exists, so
 * a database created before a setting was added would silently miss its column
 * and every read would throw. This closes that gap without a migration
 * framework: compare the declared columns against PRAGMA table_info and ALTER
 * in whatever is missing. Safe to run on every boot.
 */
function migrate() {
  const existing = new Set(
    db.prepare('PRAGMA table_info(guild_settings)').all().map((c) => c.name),
  );

  const SQL_TYPES = {
    string: 'TEXT',
    secret: 'TEXT',
    channel: 'TEXT',
    integer: 'INTEGER',
    boolean: 'INTEGER', // SQLite has no BOOLEAN; NULL means "inherit default"
  };

  for (const setting of SETTINGS) {
    if (existing.has(setting.column)) continue;
    const sqlType = SQL_TYPES[setting.type] ?? 'TEXT';
    db.exec(`ALTER TABLE guild_settings ADD COLUMN ${setting.column} ${sqlType}`);
    log.info(`Added guild_settings.${setting.column} (${sqlType}).`);
  }

  if (!existing.has('configured_at')) {
    db.exec('ALTER TABLE guild_settings ADD COLUMN configured_at INTEGER');
    log.info('Added guild_settings.configured_at (INTEGER).');
  }
}

migrate();

const columns = SETTINGS.map((s) => s.column);
const selectStmt = db.prepare(
  `SELECT ${columns.join(', ')}, configured_at FROM guild_settings WHERE guild_id = ?`,
);

// One prepared UPSERT per column, built once at load.
const upsertStmts = new Map(
  SETTINGS.map((s) => [
    s.key,
    db.prepare(`
      INSERT INTO guild_settings (guild_id, ${s.column}, updated_at)
      VALUES (@guildId, @value, @updatedAt)
      ON CONFLICT(guild_id) DO UPDATE SET
        ${s.column} = excluded.${s.column},
        updated_at = excluded.updated_at
    `),
  ]),
);

const markConfiguredStmt = db.prepare(`
  INSERT INTO guild_settings (guild_id, configured_at, updated_at)
  VALUES (@guildId, @now, @now)
  ON CONFLICT(guild_id) DO UPDATE SET configured_at = excluded.configured_at
`);

/** Raw stored row, or null. Values are undefined/null where unset. */
function readRow(guildId) {
  return selectStmt.get(guildId) ?? null;
}

/** Converts a stored column value into the setting's real type. */
function decode(setting, stored) {
  if (stored === null || stored === undefined) return null;
  if (setting.type === 'boolean') return Boolean(stored);
  return stored;
}

/** Converts a value into what SQLite should store. */
function encode(setting, value) {
  if (value === null || value === undefined) return null;
  if (setting.type === 'boolean') return value ? 1 : 0;
  return value;
}

/**
 * One setting's effective value: the guild's own choice, falling back to the
 * environment default. Never returns null except where the default itself is
 * unset (an unset API key or error channel is meaningful).
 */
export function getSetting(guildId, key) {
  const setting = SETTINGS_BY_KEY.get(key);
  if (!setting) throw new Error(`Unknown setting: ${key}`);
  const stored = decode(setting, readRow(guildId)?.[setting.column]);
  return stored ?? setting.envDefault();
}

/** True when the guild has explicitly set this one (vs inheriting the default). */
export function isOverridden(guildId, key) {
  const setting = SETTINGS_BY_KEY.get(key);
  const stored = readRow(guildId)?.[setting.column];
  return stored !== null && stored !== undefined;
}

/** Every setting's effective value plus whether it is overridden. */
export function getAllSettings(guildId) {
  const row = readRow(guildId);
  const result = {};
  for (const setting of SETTINGS) {
    const stored = decode(setting, row?.[setting.column]);
    result[setting.key] = {
      value: stored ?? setting.envDefault(),
      overridden: stored !== null && stored !== undefined,
    };
  }
  return result;
}

export function setSetting(guildId, key, value) {
  const setting = SETTINGS_BY_KEY.get(key);
  if (!setting) throw new Error(`Unknown setting: ${key}`);
  upsertStmts.get(key).run({
    guildId,
    value: encode(setting, value),
    updatedAt: Date.now(),
  });
}

/** Clears a guild's override so it follows the default again. */
export function resetSetting(guildId, key) {
  setSetting(guildId, key, null);
}

export function markConfigured(guildId) {
  const now = Date.now();
  markConfiguredStmt.run({ guildId, now });
}

export function isConfigured(guildId) {
  return Boolean(readRow(guildId)?.configured_at);
}

// --- Convenience wrappers used on hot paths -------------------------------

export const getTtsVoice = (guildId) => getSetting(guildId, 'ttsVoice');
export const setTtsVoice = (guildId, voice) => setSetting(guildId, 'ttsVoice', voice);
export const clearTtsVoice = (guildId) => resetSetting(guildId, 'ttsVoice');
export const hasCustomTtsVoice = (guildId) => isOverridden(guildId, 'ttsVoice');
