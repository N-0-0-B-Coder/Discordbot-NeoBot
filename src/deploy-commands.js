/**
 * Registers slash commands with Discord.
 *
 *   npm run deploy          -> registers to DISCORD_GUILD_ID (instant, for dev)
 *   npm run deploy:global   -> registers globally (can take up to an hour)
 *
 * Run this whenever you add, rename, or change the options of a command.
 * The bot itself does not register commands at startup, so a crash loop can
 * never wipe them.
 */
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { REST, Routes } from 'discord.js';
import { config } from './lib/config.js';
import { log } from './lib/logger.js';
import { loadCommands } from './lib/loaders.js';
import { closeDatabase } from './db/index.js';

const here = dirname(fileURLToPath(import.meta.url));
const global = process.argv.includes('--global');

const commands = await loadCommands(join(here, 'commands'));
const body = [...commands.values()].map((command) => command.data.toJSON());

if (!global && !config.guildId) {
  throw new Error(
    'DISCORD_GUILD_ID is not set. Set it for guild deploys, or pass --global.',
  );
}

const rest = new REST().setToken(config.token);
const route = global
  ? Routes.applicationCommands(config.clientId)
  : Routes.applicationGuildCommands(config.clientId, config.guildId);

try {
  const result = await rest.put(route, { body });
  log.info(
    `Registered ${result.length} command(s) ${
      global ? 'globally' : `to guild ${config.guildId}`
    }: ${result.map((c) => `/${c.name}`).join(', ')}`,
  );
} catch (err) {
  // Without this, a rejected PUT prints the entire request body — every command,
  // every option — burying the one line that says what actually went wrong.
  log.error(explain(err));
  // process.exit() forces teardown while better-sqlite3's native handles are
  // still open, which trips a libuv assertion on Windows
  // ("!(handle->flags & UV_HANDLE_CLOSING)") and buries the message above.
  // Setting exitCode lets Node unwind cleanly and still exit non-zero.
  process.exitCode = 1;
}

closeDatabase();

/** Turns a Discord API error into something you can act on. */
function explain(err) {
  const status = err?.status;
  const code = err?.code;

  if (code === 50001 || status === 403) {
    return [
      'Discord refused the registration: Missing Access (50001).',
      '',
      'The payload was fine — this is about how the bot was invited.',
      'Almost always one of:',
      '',
      '  1. The bot was added to the server WITHOUT the "applications.commands"',
      '     scope. A plain "bot" scope invite lets it join and talk, but not own',
      '     slash commands. Re-invite it with both scopes using the URL printed',
      '     by `npm run invite` — authorising again on the same server just adds',
      '     the missing scope; you do not need to kick it first.',
      '',
      `  2. The bot is not in guild ${config.guildId} at all, or that id is wrong.`,
      '     Right-click the server icon -> Copy Server ID (needs Developer Mode',
      '     in Discord settings) and compare it with DISCORD_GUILD_ID in .env.',
    ].join('\n');
  }

  if (status === 401) {
    return [
      'Discord rejected the token (401 Unauthorized).',
      'Check DISCORD_TOKEN in .env — it is the Bot token from the Bot tab,',
      'not the Client Secret and not the Public Key. Resetting the token in the',
      'Developer Portal invalidates the old one, so an old value here will fail.',
    ].join('\n');
  }

  if (status === 404) {
    return [
      'Discord could not find that application or guild (404).',
      `DISCORD_CLIENT_ID (${config.clientId}) must be the Application ID from`,
      'General Information, and DISCORD_GUILD_ID must be a server the bot is in.',
    ].join('\n');
  }

  if (status === 400) {
    // A 400 carries per-command detail worth showing, unlike the others.
    return [
      'Discord rejected the command definitions (400 Bad Request).',
      'The errors below are keyed by the index of the command in the payload:',
      JSON.stringify(err.rawError?.errors ?? err.rawError, null, 2),
    ].join('\n');
  }

  return `Command registration failed: ${err?.message ?? err}`;
}
