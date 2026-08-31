import { ActivityType, Events } from 'discord.js';
import { log } from '../lib/logger.js';
import { highlight } from '../lib/colors.js';
import { REFRESH_EVERY_MS, refreshVoices } from '../tts/voices.js';
import { formatFindings, hasErrors, runPreflight } from '../lib/preflight.js';

export const name = Events.ClientReady;
export const once = true;

export async function execute(client) {
  log.success(`Logged in as ${highlight(client.user.tag)} (${client.user.id}).`);
  log.info(`Serving ${highlight(client.guilds.cache.size)} guild(s).`);
  client.user.setActivity('/help', { type: ActivityType.Listening });

  // Warm the TTS voice catalogue once, then keep it fresh on a timer. Doing it
  // here rather than lazily keeps /tts-voice autocomplete purely in-memory.
  refreshVoices();
  setInterval(refreshVoices, REFRESH_EVERY_MS).unref();

  // Self-check the configuration. Everything it looks for fails silently or
  // with a misleading error, so surfacing it at boot beats discovering it when
  // a command mysteriously does nothing. Never fatal: a running bot with one
  // broken feature is better than one that refuses to start.
  try {
    const findings = await runPreflight(client.rest);
    const report = formatFindings(findings);
    if (report) {
      log.warn(
        `Configuration problems found:

${report}

Run \`npm run doctor\` for the full check.`,
      );
    } else {
      log.success('Configuration check passed.');
    }
    if (hasErrors(findings)) {
      log.warn('The bot is running, but the failures above will break features.');
    }
  } catch (err) {
    log.debug('Preflight check could not run:', err);
  }
}
