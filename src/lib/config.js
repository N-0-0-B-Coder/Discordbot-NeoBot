import 'dotenv/config';

/** Reads a required variable, failing loudly at boot rather than at first use. */
function required(name) {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(
      `Missing required environment variable ${name}. ` +
        'Copy .env.example to .env and fill it in.',
    );
  }
  return value;
}

function optional(name, fallback = null) {
  const value = process.env[name]?.trim();
  return value ? value : fallback;
}

export const config = {
  token: required('DISCORD_TOKEN'),
  clientId: required('DISCORD_CLIENT_ID'),
  // Optional: when set, slash commands register to this guild only (instant).
  guildId: optional('DISCORD_GUILD_ID'),

  itadApiKey: optional('ITAD_API_KEY'),
  priceCountry: (optional('PRICE_COUNTRY', 'US')).toUpperCase(),

  databasePath: optional('DATABASE_PATH', './data/neobot.sqlite'),
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
