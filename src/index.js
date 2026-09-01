import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client, Collection, GatewayIntentBits } from 'discord.js';
import { config } from './lib/config.js';
import { log } from './lib/logger.js';
import { highlight } from './lib/colors.js';
import { loadCommands, loadComponents, loadEvents } from './lib/loaders.js';
import { closeDatabase } from './db/index.js';
import { purgeExpiredInfractions } from './db/infractions.js';
import { destroyAllPlayers } from './music/manager.js';
import { sweepPriceWatches } from './services/price-watch.js';
import { attachClient, report } from './lib/error-reporter.js';

const here = dirname(fileURLToPath(import.meta.url));

const client = new Client({
  intents: [
    // Guilds is required for slash commands and channel/role caching.
    GatewayIntentBits.Guilds,
    // GuildMembers is privileged — enable it in the Developer Portal, under
    // Bot → Privileged Gateway Intents. Moderation needs it to resolve members
    // and compare role positions.
    GatewayIntentBits.GuildMembers,
    // Voice state tracking: the music player and the TTS auto-leave both need
    // to know when a channel empties.
    GatewayIntentBits.GuildVoiceStates,
    // GuildMessages + MessageContent are required by the chat-to-speech feature
    // (/tts-join), which reads the voice channel's own text chat aloud. Both
    // must also be enabled in the Developer Portal under Privileged Gateway
    // Intents — MessageContent is privileged, and without it `message.content`
    // arrives EMPTY rather than erroring, so TTS just silently never speaks.
    //
    // This is a deliberate trade: the bot was originally slash-command-only and
    // needed no privileged intent at all. Reading arbitrary chat is what the
    // feature is, so there is no way around it. PRIVACY_POLICY.md already
    // declares message-content collection and a 30-day retention window.
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

// Give the error reporter a client so it can mirror failures into Discord.
attachClient(client);

client.commands = new Collection();
for (const [name, command] of await loadCommands(join(here, 'commands'))) {
  client.commands.set(name, command);
}
client.components = await loadComponents(join(here, 'components'));
await loadEvents(join(here, 'events'), client);

log.info(
  `Loaded ${highlight(client.commands.size)} commands and ${highlight(client.components.size)} component handler(s).`,
);

// Honour the 30-day retention window from PRIVACY_POLICY.md: sweep at boot,
// then once a day.
const RETENTION_SWEEP_MS = 24 * 60 * 60 * 1000;
function sweepRetention() {
  // Never let this throw out of the timer. RNBot's background jobs caught their
  // errors and then `break`-ed out of the loop, which killed the feature
  // permanently and silently until the next restart. A scheduled job must
  // survive its own failures — log, report, and stay scheduled.
  try {
    const removed = purgeExpiredInfractions(30);
    if (removed > 0) log.info(`Retention sweep removed ${removed} infraction(s).`);
  } catch (err) {
    report('retention sweep', err);
  }
}
sweepRetention();
const retentionTimer = setInterval(sweepRetention, RETENTION_SWEEP_MS);
retentionTimer.unref();

// Price watches: re-check saved games and report movement. Six hours is a
// compromise between noticing a sale and burning the ITAD quota — store prices
// change on a scale of days, and every watch costs one API call per sweep.
//
// NOT run at boot: a redeploy would then re-check everything at once, and on a
// platform that redeploys on every push that is both a burst of API calls and a
// burst of notifications. The first sweep happens six hours in.
const PRICE_SWEEP_MS = 6 * 60 * 60 * 1000;
const priceTimer = setInterval(() => {
  sweepPriceWatches(client).catch((err) => report('price watch sweep', err));
}, PRICE_SWEEP_MS);
priceTimer.unref();

let shuttingDown = false;
async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  log.info(`Received ${signal}, shutting down.`);
  clearInterval(retentionTimer);
  clearInterval(priceTimer);
  destroyAllPlayers();
  await client.destroy();
  closeDatabase();

  // Deliberately NOT process.exit(): forcing teardown while native handles are
  // open trips a libuv assertion on Windows. Let Node unwind on its own, but
  // keep a short unref'd fuse so a stuck handle cannot leave the process
  // hanging — a container would otherwise wait out its SIGTERM grace period
  // and get SIGKILLed anyway.
  setTimeout(() => process.exit(0), 2_000).unref();
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('unhandledRejection', (reason) => {
  report('unhandled promise rejection', reason);
});
process.on('uncaughtException', (err) => {
  report('uncaught exception', err);
});

await client.login(config.token);
