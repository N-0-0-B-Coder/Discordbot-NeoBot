import { ActivityType, Events } from 'discord.js';
import { log } from '../lib/logger.js';
import { REFRESH_EVERY_MS, refreshVoices } from '../tts/voices.js';

export const name = Events.ClientReady;
export const once = true;

export function execute(client) {
  log.info(`Logged in as ${client.user.tag} (${client.user.id}).`);
  log.info(`Serving ${client.guilds.cache.size} guild(s).`);
  client.user.setActivity('/help', { type: ActivityType.Listening });

  // Warm the TTS voice catalogue once, then keep it fresh on a timer. Doing it
  // here rather than lazily keeps /tts-voice autocomplete purely in-memory.
  refreshVoices();
  setInterval(refreshVoices, REFRESH_EVERY_MS).unref();
}
