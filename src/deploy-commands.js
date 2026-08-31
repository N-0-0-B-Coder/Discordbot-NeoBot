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
import { highlight } from './lib/colors.js';
import { loadCommands } from './lib/loaders.js';
import { closeDatabase } from './db/index.js';

const here = dirname(fileURLToPath(import.meta.url));
const global = process.argv.includes('--global');
const clearGuild = process.argv.includes('--clear-guild');

const commands = await loadCommands(join(here, 'commands'));

// --clear-guild removes the guild-scoped copies by registering an empty set.
// Needed when moving to global: the two scopes are independent, so leaving the
// guild copies behind shows every command TWICE in that server.
const body = clearGuild ? [] : [...commands.values()].map((c) => c.data.toJSON());

if (!global && !config.guildId) {
  throw new Error(
    'DISCORD_GUILD_ID is not set. Set it for guild deploys, or pass --global.',
  );
}

const rest = new REST().setToken(config.token);
const route =
  global && !clearGuild
    ? Routes.applicationCommands(config.clientId)
    : Routes.applicationGuildCommands(config.clientId, config.guildId);

try {
  const result = await rest.put(route, { body });

  if (clearGuild) {
    log.success(
      `Cleared the guild-scoped commands from guild ${config.guildId}. ` +
        'Only the global set remains.',
    );
  } else {
    log.success(
      `Registered ${highlight(result.length)} command(s) ${
        global ? 'globally' : `to guild ${config.guildId}`
      }: ${result.map((c) => `/${c.name}`).join(', ')}`,
    );
  }

  if (global && !clearGuild) {
    log.info(
      'Global commands can take up to an hour to appear. Existing guild ' +
        'commands keep working in the meantime.',
    );
    await warnAboutDuplicates();
  }
} catch (err) {
  // Without this, a rejected PUT prints the entire request body — every command,
  // every option — burying the one line that says what actually went wrong.
  log.error(await explain(err));
  // process.exit() forces teardown while better-sqlite3's native handles are
  // still open, which trips a libuv assertion on Windows
  // ("!(handle->flags & UV_HANDLE_CLOSING)") and buries the message above.
  // Setting exitCode lets Node unwind cleanly and still exit non-zero.
  process.exitCode = 1;
}

closeDatabase();

/**
 * Turns a Discord API error into something you can act on.
 *
 * For a 403 it asks Discord which guilds the bot is actually in, rather than
 * listing possible causes and leaving you to guess. "Missing Access" has two
 * very different fixes and the guild list tells them apart definitively.
 */
async function explain(err) {
  const status = err?.status;
  const code = err?.code;

  if (code === 50001 || status === 403) {
    const guilds = await listGuilds();

    if (guilds === null) {
      return [
        'Discord refused the registration: Missing Access (50001).',
        `And I could not list the bot's servers to narrow it down. Check that`,
        'the bot is in the server and was invited with the applications.commands',
        'scope (`npm run invite`).',
      ].join('\n');
    }

    if (guilds.length === 0) {
      return [
        'Discord refused the registration: Missing Access (50001).',
        '',
        'Cause found: THE BOT IS NOT IN ANY SERVER.',
        '',
        'Guild commands can only be registered for a server the bot has joined,',
        'so this fails no matter what the scopes or permissions say.',
        '',
        'Fix: run `npm run invite`, open the URL, pick your server from the',
        'dropdown and click Authorise all the way through. You need the Manage',
        'Server permission on that server to add a bot to it.',
        '',
        'Then re-run `npm run deploy`.',
      ].join('\n');
    }

    const inTarget = guilds.some((g) => g.id === config.guildId);
    if (!inTarget) {
      return [
        'Discord refused the registration: Missing Access (50001).',
        '',
        `Cause found: the bot is NOT in guild ${config.guildId},`,
        'which is what DISCORD_GUILD_ID in .env points at.',
        '',
        'It IS in these servers:',
        ...guilds.map((g) => `  ${g.id}  ${g.name}`),
        '',
        'Either set DISCORD_GUILD_ID to one of the ids above, or invite the bot',
        'to the server you meant with `npm run invite`.',
      ].join('\n');
    }

    return [
      'Discord refused the registration: Missing Access (50001).',
      '',
      `The bot IS in guild ${config.guildId}, so this is the scope:`,
      'it was added without "applications.commands". That scope is what lets an',
      'app own slash commands in a guild — a bot-only invite joins and talks but',
      'cannot register commands.',
      '',
      'Fix: run `npm run invite` and authorise the SAME server again. That adds',
      'the missing scope; you do not need to kick the bot first.',
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

/**
 * After a global deploy, checks whether guild-scoped copies are still
 * registered — the two scopes are independent, and a server holding both shows
 * every command twice with no hint as to why.
 */
async function warnAboutDuplicates() {
  if (!config.guildId) return;

  let guildCommands;
  try {
    guildCommands = await rest.get(
      Routes.applicationGuildCommands(config.clientId, config.guildId),
    );
  } catch {
    // Not fatal — the global registration already succeeded.
    return;
  }

  if (!Array.isArray(guildCommands) || guildCommands.length === 0) return;

  log.warn(
    [
      `Guild ${config.guildId} still has ${guildCommands.length} guild-scoped ` +
        'command(s) registered.',
      '',
      'Command scopes are independent, so that server will show every command',
      'TWICE once the global set propagates. Clear the guild copies with:',
      '',
      '    npm run deploy:clear-guild',
      '',
      'Keep them only if you deliberately want that server on a faster update',
      'loop than everyone else.',
    ].join('\n'),
  );
}

/**
 * The servers this bot is a member of, or null if even that call fails.
 * Uses the same REST client, so it needs no gateway connection.
 */
async function listGuilds() {
  try {
    const guilds = await rest.get(Routes.userGuilds());
    return guilds.map((g) => ({ id: g.id, name: g.name }));
  } catch {
    return null;
  }
}
