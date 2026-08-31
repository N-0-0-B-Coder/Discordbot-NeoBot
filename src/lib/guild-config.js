/**
 * The single source of truth for per-guild settings.
 *
 * Every setting is declared once here — its column, type, default, validation
 * and how it renders. The `/config` panel, its select menu, its modals, the
 * database migration and the accessors are all generated from this list, so
 * adding a setting means adding one entry and nothing else.
 */
import { config } from './config.js';

/** @typedef {'string'|'secret'|'integer'|'boolean'|'channel'} SettingType */

export const SETTINGS = [
  {
    key: 'itadApiKey',
    column: 'itad_api_key',
    type: 'secret',
    label: 'IsThereAnyDeal API key',
    emoji: '🔑',
    description: 'Unlocks cross-store prices in /deals',
    // Entered through a modal, never a command option: Discord shows a slash
    // command's arguments to the whole channel, which would leak the key.
    modalLabel: 'ITAD API key',
    placeholder: 'Paste the key from isthereanydeal.com/apps/my/',
    maxLength: 100,
    envDefault: () => config.itadApiKey,
    validate: (raw) => {
      const value = raw.trim();
      if (!value) return { ok: false, reason: 'Give a key, or clear it to unset.' };
      if (/\s/.test(value)) return { ok: false, reason: 'A key has no spaces in it.' };
      return { ok: true, value };
    },
    // Never render a secret back to the channel, even ephemerally.
    format: (value) => (value ? `set (…${String(value).slice(-4)})` : 'not set'),
  },
  {
    key: 'priceCountry',
    column: 'price_country',
    type: 'string',
    label: 'Price country',
    emoji: '🌍',
    description: 'Two-letter country code used for /deals and /steam pricing',
    modalLabel: 'Country code (e.g. VN, US, GB)',
    placeholder: 'VN',
    maxLength: 2,
    envDefault: () => config.priceCountry,
    validate: (raw) => {
      const value = raw.trim().toUpperCase();
      if (!/^[A-Z]{2}$/.test(value)) {
        return { ok: false, reason: 'Use exactly two letters, like `VN` or `US`.' };
      }
      return { ok: true, value };
    },
    format: (value) => `\`${value}\``,
  },
  {
    key: 'ttsMaxMessageLength',
    column: 'tts_max_message_length',
    type: 'integer',
    label: 'TTS max message length',
    emoji: '📏',
    description: 'Longer messages are truncated before being spoken',
    modalLabel: 'Characters (50–1000)',
    placeholder: '300',
    maxLength: 4,
    min: 50,
    max: 1000,
    envDefault: () => config.tts.maxMessageLength,
    format: (value) => `${value} characters`,
  },
  {
    key: 'ttsMaxQueueLength',
    column: 'tts_max_queue_length',
    type: 'integer',
    label: 'TTS max queue length',
    emoji: '📚',
    description: 'How many lines may back up before the oldest is dropped',
    modalLabel: 'Lines (1–20)',
    placeholder: '5',
    maxLength: 2,
    min: 1,
    max: 20,
    envDefault: () => config.tts.maxQueueLength,
    format: (value) => `${value} line${value === 1 ? '' : 's'}`,
  },
  {
    key: 'ttsAnnounceAuthor',
    column: 'tts_announce_author',
    type: 'boolean',
    label: 'Announce who is speaking',
    emoji: '🗣️',
    description: 'Prefix each spoken line with "<name> says:"',
    envDefault: () => config.tts.announceAuthor,
    format: (value) => (value ? 'on' : 'off'),
  },
  {
    key: 'errorLogChannelId',
    column: 'error_log_channel_id',
    type: 'channel',
    label: 'Error log channel',
    emoji: '🚨',
    description: 'Where runtime errors are reported',
    envDefault: () => config.errorLogChannelId,
    format: (value) => (value ? `<#${value}>` : 'not set'),
  },
  {
    key: 'ttsVoice',
    column: 'tts_voice',
    type: 'string',
    label: 'TTS voice',
    emoji: '🔊',
    // Managed by its own command, which has autocomplete over the voice
    // catalogue — a free-text modal would be a worse way to pick one.
    description: 'Change with /tts-voice',
    readOnlyInPanel: true,
    envDefault: () => config.tts.voice,
    format: (value) => `\`${value}\``,
  },
];

export const SETTINGS_BY_KEY = new Map(SETTINGS.map((s) => [s.key, s]));

/** Settings offered in the /config select menu. */
export const EDITABLE_SETTINGS = SETTINGS.filter((s) => !s.readOnlyInPanel);

/**
 * Validates and coerces a raw string for a setting.
 * Returns { ok: true, value } or { ok: false, reason }.
 */
export function coerce(setting, raw) {
  if (setting.validate) return setting.validate(raw);

  if (setting.type === 'integer') {
    const value = Number(String(raw).trim());
    if (!Number.isInteger(value)) {
      return { ok: false, reason: 'That is not a whole number.' };
    }
    if (value < setting.min || value > setting.max) {
      return {
        ok: false,
        reason: `Pick a number between ${setting.min} and ${setting.max}.`,
      };
    }
    return { ok: true, value };
  }

  const value = String(raw).trim();
  return value ? { ok: true, value } : { ok: false, reason: 'That cannot be empty.' };
}
