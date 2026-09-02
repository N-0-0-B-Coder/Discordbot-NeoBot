/**
 * Clickable slash-command mentions: `</tts-join:1234567890>`.
 *
 * Discord renders that as a blue chip you can click to run the command, the way
 * a channel mention works — and it is the only way to offer a command without
 * making someone type it. Writing `/tts-join` in backticks looks similar and
 * does nothing.
 *
 * The catch is the ID. It belongs to the REGISTERED command, so it exists only
 * after `npm run deploy` and is unknown to the source. Hence this cache: fetch
 * the registrations once at startup, keep name -> id, and render from that.
 *
 * Everything degrades to `/name` in backticks — before the fetch, in tests, and
 * for any command that is somehow not registered. A help message that silently
 * lost half its entries would be a poor trade for a nicer chip.
 */
import { log } from './logger.js';

/** name -> registered command id */
const ids = new Map();

/**
 * Loads the registered command ids.
 *
 * Both scopes are fetched because either may be in use: commands are global
 * here, but a guild-scoped copy takes precedence for that guild, so the guild
 * ids are read last and win.
 */
export async function refreshCommandMentions(client, guildId = null) {
  try {
    const global = await client.application.commands.fetch();
    for (const command of global.values()) ids.set(command.name, command.id);

    if (guildId) {
      const guild = await client.application.commands.fetch({ guildId });
      for (const command of guild.values()) ids.set(command.name, command.id);
    }

    log.debug(`Cached ${ids.size} command id(s) for clickable mentions.`);
  } catch (err) {
    // Never fatal — the fallback is readable, just not clickable.
    log.debug('Could not fetch command ids; mentions stay as plain text.', err);
  }
}

/**
 * Renders one command as a clickable mention.
 *
 * Accepts a subcommand path: `mention('pricewatch list')` produces
 * `</pricewatch list:ID>`, which Discord resolves against the ROOT command's
 * id — subcommands do not have ids of their own.
 *
 * @param {string} path e.g. 'help', 'tts-voice set', 'config'
 */
export function mention(path) {
  const [root] = path.split(' ');
  const id = ids.get(root);
  return id ? `</${path}:${id}>` : `\`/${path}\``;
}

/** Test seam: pretend a command is registered. */
export function setCommandId(name, id) {
  ids.set(name, id);
}

export function clearCommandIds() {
  ids.clear();
}
