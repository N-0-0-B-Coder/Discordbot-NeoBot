/**
 * The shared "watch this game's price" option for /deals and /steam.
 *
 * Both commands already look a game up; watching is the same lookup repeated on
 * a schedule and reported to a channel. Making it an OPTION on the lookup
 * rather than a separate command means you never have to name the game twice,
 * and the thing you subscribe to is the thing you just saw.
 */
import { ChannelType, PermissionFlagsBits } from 'discord.js';
import { getSetting } from '../db/guild-settings.js';
import { addWatch, MAX_WATCHES_PER_GUILD } from '../db/price-watches.js';
import { log } from './logger.js';

/** Attach with `.addChannelOption(watchOption)`. */
export const watchOption = (option) =>
  option
    .setName('watch')
    .setDescription('Report future price changes for this game to a channel')
    .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement);

/**
 * Footer shared by both commands.
 *
 * Discord renders embed footers as PLAIN TEXT — no markdown, no links, and no
 * clickable command mentions — so `/config` here is a name to type, not a
 * button. Anything that needs to be clickable has to live in a field or the
 * description instead.
 */
export function priceFooter(guildId, sources) {
  const country = getSetting(guildId, 'priceCountry');
  return [
    `Price: ${country} — change with /config`,
    `Source: ${sources.length ? sources.join(' + ') : 'none'}`,
  ].join('\n');
}

/**
 * Acts on the `watch` option, if one was given.
 *
 * @returns {Promise<string|null>} a line for the embed, or null when the option
 *   was not used.
 */
export async function applyWatchOption(interaction, { source, ref, title }) {
  const channel = interaction.options.getChannel('watch');
  if (!channel) return null;

  // Setting up something that posts to a channel on its own schedule is a
  // server-configuration act, not a lookup — so it needs a permission the
  // lookup itself does not.
  if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageChannels)) {
    return 'Only members with **Manage Channels** can set up a price watch.';
  }

  if (!ref) {
    return 'I could not identify this game well enough to watch it.';
  }

  // A watch the bot cannot post into is worse than no watch: it fails silently
  // every sweep. Check now, while there is someone to tell.
  const me = interaction.guild.members.me;
  if (!channel.permissionsFor(me)?.has(PermissionFlagsBits.SendMessages)) {
    return `I cannot send messages in ${channel}, so I cannot report there.`;
  }

  const { watch, created, atLimit } = addWatch({
    guildId: interaction.guildId,
    channelId: channel.id,
    source,
    ref,
    title,
    createdBy: interaction.user.id,
  });

  if (atLimit) {
    return `This server already watches ${MAX_WATCHES_PER_GUILD} games — remove one with \`/pricewatch remove\` first.`;
  }

  log.info(
    `[${interaction.guildId}] Price watch ${created ? 'added' : 'moved'} for "${title}" -> #${channel.name}.`,
  );

  return created
    ? `Watching **${title}**. I will post in ${channel} when the price changes.`
    : `Already watching **${title}** — reports now go to ${channel}.`;
}

/** Exposed for the watch list command, so both render a watch the same way. */
export const describeWatch = (watch) =>
  `**${watch.title}** → <#${watch.channel_id}>` +
  (watch.last_amount === null ? ' (no price recorded yet)' : '');
