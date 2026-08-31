/**
 * The catalogue of voices `/tts-voice` offers.
 *
 * The authoritative list comes from the service itself, but autocomplete has a
 * 3-second budget and fires on every keystroke, so reads must never touch the
 * network. `getVoices()` is therefore pure and synchronous; `refreshVoices()`
 * is called explicitly at startup and on a daily timer. Until the first refresh
 * lands — or forever, if the service is unreachable — the curated fallback
 * below is used, which is enough to be useful on its own.
 */
import { log } from '../lib/logger.js';
import { listVoices } from './engine.js';

const REFRESH_INTERVAL_MS = 24 * 60 * 60 * 1000;

/**
 * Curated fallback. Vietnamese first (the server's language), then the
 * languages a friend group is most likely to reach for. These are standard Edge
 * neural voice ShortNames; the live list is authoritative and supersedes this
 * once fetched.
 */
const FALLBACK_VOICES = [
  ['vi-VN-HoaiMyNeural', 'Vietnamese', 'Female'],
  ['vi-VN-NamMinhNeural', 'Vietnamese', 'Male'],
  ['en-US-AriaNeural', 'English (US)', 'Female'],
  ['en-US-JennyNeural', 'English (US)', 'Female'],
  ['en-US-GuyNeural', 'English (US)', 'Male'],
  ['en-US-ChristopherNeural', 'English (US)', 'Male'],
  ['en-GB-SoniaNeural', 'English (UK)', 'Female'],
  ['en-GB-RyanNeural', 'English (UK)', 'Male'],
  ['en-AU-NatashaNeural', 'English (AU)', 'Female'],
  ['en-AU-WilliamNeural', 'English (AU)', 'Male'],
  ['ja-JP-NanamiNeural', 'Japanese', 'Female'],
  ['ja-JP-KeitaNeural', 'Japanese', 'Male'],
  ['ko-KR-SunHiNeural', 'Korean', 'Female'],
  ['ko-KR-InJoonNeural', 'Korean', 'Male'],
  ['zh-CN-XiaoxiaoNeural', 'Chinese', 'Female'],
  ['zh-CN-YunxiNeural', 'Chinese', 'Male'],
  ['th-TH-PremwadeeNeural', 'Thai', 'Female'],
  ['th-TH-NiwatNeural', 'Thai', 'Male'],
  ['id-ID-GadisNeural', 'Indonesian', 'Female'],
  ['fr-FR-DeniseNeural', 'French', 'Female'],
  ['fr-FR-HenriNeural', 'French', 'Male'],
  ['de-DE-KatjaNeural', 'German', 'Female'],
  ['de-DE-ConradNeural', 'German', 'Male'],
  ['es-ES-ElviraNeural', 'Spanish', 'Female'],
  ['es-ES-AlvaroNeural', 'Spanish', 'Male'],
].map(([shortName, language, gender]) => ({ shortName, language, gender }));

let cache = FALLBACK_VOICES;
let cacheIsLive = false;
let lastRefreshAt = 0;
let inFlight = null;

/** Voice ShortNames look like `vi-VN-HoaiMyNeural`. */
const SHORT_NAME_PATTERN = /^[a-z]{2,3}-[A-Z]{2,4}-[A-Za-z]+Neural$/;

function normalise(voice) {
  return {
    shortName: voice.ShortName,
    // FriendlyName is like "Microsoft HoaiMy Online (Natural) - Vietnamese".
    language: voice.Locale ?? '',
    gender: voice.Gender ?? '',
  };
}

/**
 * Refreshes the catalogue from the service. Never throws.
 *
 * Called explicitly at startup and on a timer, NOT lazily from getVoices():
 * a getter that quietly performs network I/O is a trap. It made `getVoices()`
 * unpredictably slow, kept the process alive while a request was pending, and
 * meant simply reading the list could reach the network from anywhere.
 */
export function refreshVoices() {
  if (inFlight || Date.now() - lastRefreshAt < REFRESH_INTERVAL_MS) return inFlight;

  inFlight = listVoices()
    .then((voices) => {
      if (Array.isArray(voices) && voices.length > 0) {
        cache = voices.map(normalise);
        cacheIsLive = true;
        log.info(`Loaded ${cache.length} TTS voices from the service.`);
      }
    })
    .catch((err) => {
      log.debug('Could not refresh the TTS voice list, using the built-in set:', err?.message ?? err);
    })
    .finally(() => {
      lastRefreshAt = Date.now();
      inFlight = null;
    });

  return inFlight;
}

export const REFRESH_EVERY_MS = REFRESH_INTERVAL_MS;

/**
 * The current catalogue. Pure and synchronous — safe to call from an
 * autocomplete handler, which has a 3-second budget and cannot afford I/O.
 */
export function getVoices() {
  return cache;
}

export function isLiveList() {
  return cacheIsLive;
}

/** Autocomplete search across short name, language and gender. */
export function searchVoices(query, limit = 25) {
  const voices = getVoices();
  const q = query.trim().toLowerCase();
  const matches = q
    ? voices.filter((v) =>
        `${v.shortName} ${v.language} ${v.gender}`.toLowerCase().includes(q),
      )
    : voices;
  return matches.slice(0, limit);
}

/**
 * Validates a voice name.
 * When the live list is loaded, membership is checked strictly. Otherwise only
 * the shape is checked — better to try an unknown-but-plausible voice than to
 * refuse a valid one because the catalogue could not be fetched.
 */
export function validateVoice(shortName) {
  const name = shortName.trim();
  const known = getVoices().some(
    (v) => v.shortName.toLowerCase() === name.toLowerCase(),
  );
  if (known) {
    const match = getVoices().find(
      (v) => v.shortName.toLowerCase() === name.toLowerCase(),
    );
    return { ok: true, voice: match.shortName, certain: true };
  }
  if (cacheIsLive) {
    return { ok: false, reason: 'not-found' };
  }
  if (SHORT_NAME_PATTERN.test(name)) {
    return { ok: true, voice: name, certain: false };
  }
  return { ok: false, reason: 'bad-shape' };
}

/** Human label for an autocomplete choice, capped to Discord's 100 chars. */
export function describeVoice(voice) {
  const parts = [voice.shortName];
  if (voice.language) parts.push(voice.language);
  if (voice.gender) parts.push(voice.gender);
  return parts.join(' · ').slice(0, 100);
}
