import { existsSync } from 'node:fs';
import 'dotenv/config';

/**
 * Collected rather than thrown one at a time, so a fresh deployment learns
 * about every missing variable in one go instead of discovering them across
 * three failed restarts.
 */
const missing = [];

/** Reads a required variable, failing loudly at boot rather than at first use. */
function required(name) {
  const value = process.env[name]?.trim();
  if (!value) {
    missing.push(name);
    return '';
  }
  return value;
}

/**
 * Advice depends on where this is running. Telling someone on Railway to
 * "copy .env.example to .env" is useless — there is no file to edit, and the
 * fix is in the platform's dashboard.
 */
function explainMissing() {
  const names = missing.map((name) => `  - ${name}`).join('\n');
  const localEnvFile = existsSync(new URL('../../.env', import.meta.url));

  const advice = localEnvFile
    ? 'Your .env exists but does not set them. Fill them in there.'
    : [
        'No .env file was found, so this is probably a hosted deployment.',
        'Set these in your platform\'s variables, not in a file:',
        '',
        '  Railway  -> your service -> Variables -> New Variable',
        '',
        'Locally, copy .env.example to .env instead.',
      ].join('\n');

  return [
    `Missing ${missing.length} required environment variable(s):`,
    '',
    names,
    '',
    advice,
  ].join('\n');
}

function optional(name, fallback = null) {
  const value = process.env[name]?.trim();
  return value ? value : fallback;
}

/**
 * Where the database goes when DATABASE_PATH is not set.
 *
 * `./data` is right on a laptop and quietly catastrophic on a platform that
 * rebuilds the container on every deploy: the bot starts perfectly, and every
 * setting the server chose is gone. That happened here — a volume was attached
 * and mounted, and the bot wrote next to it instead of into it, because the two
 * were configured independently and nothing checked they agreed.
 *
 * Railway publishes the mount path, so prefer it. A default that cannot lose
 * data beats a default that needs a second variable to be safe.
 */
function defaultDatabasePath() {
  const volume = process.env.RAILWAY_VOLUME_MOUNT_PATH?.trim();
  return volume ? `${volume.replace(/\/+$/, '')}/neobot.sqlite` : './data/neobot.sqlite';
}

export const config = {
  token: required('DISCORD_TOKEN'),
  clientId: required('DISCORD_CLIENT_ID'),
  // Optional: when set, slash commands register to this guild only (instant).
  guildId: optional('DISCORD_GUILD_ID'),

  itadApiKey: optional('ITAD_API_KEY'),
  priceCountry: (optional('PRICE_COUNTRY', 'US')).toUpperCase(),

  databasePath: optional('DATABASE_PATH', defaultDatabasePath()),
  logLevel: optional('LOG_LEVEL', 'info'),

  // Where runtime errors get mirrored. On a hosted bot nobody reads stdout, so
  // without this a broken command fails in silence. (RNBot posted these to a
  // dedicated error-log thread — the one piece of its operational tooling worth
  // keeping.) Optional: unset means console only.
  errorLogChannelId: optional('ERROR_LOG_CHANNEL_ID'),
  // Pinged on error reports, if set. Your own Discord user id.
  ownerId: optional('OWNER_ID'),

  tts: {
    // Any Edge voice ShortName. Vietnamese default because that is what the
    // server speaks; vi-VN-NamMinhNeural is the male counterpart, and
    // en-US-AriaNeural / en-US-GuyNeural are the usual English picks.
    voice: optional('TTS_VOICE', 'vi-VN-HoaiMyNeural'),
    // Longer messages are unpleasant to sit through, and a long clip is the one
    // case where ducking could stall a paused music stream.
    maxMessageLength: Number(optional('TTS_MAX_MESSAGE_LENGTH', '300')),
    // Backlog cap. Past this the oldest queued line is dropped — in a live
    // conversation the newest line is the one still worth hearing.
    maxQueueLength: Number(optional('TTS_MAX_QUEUE_LENGTH', '5')),
    // Prefix each line with "<name> says:". On by default so a room can tell
    // who said what; per-server override lives in /config.
    announceAuthor: optional('TTS_ANNOUNCE_AUTHOR', 'true') !== 'false',
  },

  // Music guardrails. A friend-group bot does not need an unbounded queue.
  music: {
    maxQueueLength: 100,
    // Leave the voice channel after this long with nothing playing.
    idleTimeoutMs: 5 * 60 * 1000,
    // Refuse anything longer than this (live streams report 0 and are rejected).
    maxTrackDurationSec: 3 * 60 * 60,
  },
};

if (missing.length > 0) throw new Error(explainMissing());
