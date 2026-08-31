import { EmbedBuilder, Events, PermissionFlagsBits } from 'discord.js';
import { COLORS } from '../lib/embeds.js';
import { log } from '../lib/logger.js';

export const name = Events.GuildCreate;

/**
 * Greets a new server and points the owner at /config.
 *
 * Nothing is blocked until they run it — every setting has a working default
 * and even the ITAD key is optional — so this is an invitation, not a gate.
 */
export async function execute(guild) {
  log.info(`Joined guild ${guild.name} (${guild.id}).`);

  const channel = findWelcomeChannel(guild);
  if (!channel) {
    log.warn(`No channel I can post in on joining ${guild.name}.`);
    return;
  }

  const embed = new EmbedBuilder()
    .setColor(COLORS.info)
    .setTitle('👋 Thanks for adding me')
    .setDescription(
      [
        'Before you start, someone with **Manage Server** should run **`/config`**',
        'to set this server up. The panel is private — only the person who runs it',
        'sees it.',
      ].join('\n'),
    )
    .addFields(
      {
        name: 'Worth setting',
        value: [
          '🔑 **IsThereAnyDeal API key** — unlocks cross-store prices in `/deals`',
          '🌍 **Price country** — so prices are in your currency',
          '🚨 **Error log channel** — run `/config` *in* the channel you want, then pick it',
        ].join('\n'),
      },
      {
        name: 'Everything else already works',
        value:
          'Sensible defaults are in place, so `/help` will show you around right now.',
      },
    )
    .setFooter({ text: 'Run /config in the channel you want errors reported to.' });

  try {
    await channel.send({
      content: `<@${guild.ownerId}>`,
      embeds: [embed],
      // Ping the owner, but never let a join message hit @everyone.
      allowedMentions: { users: [guild.ownerId] },
    });
  } catch (err) {
    log.warn(`Could not send the welcome message in ${guild.name}:`, err);
  }
}

/**
 * Picks where to say hello: the server's system channel if usable, otherwise
 * the first text channel the bot may actually post in.
 *
 * The system channel is what Discord calls the "default" channel, but it can be
 * unset or locked down, so it cannot be relied on alone.
 */
function findWelcomeChannel(guild) {
  const me = guild.members.me;
  const canPost = (channel) => {
    const perms = channel?.permissionsFor(me);
    return Boolean(
      perms?.has(PermissionFlagsBits.ViewChannel) &&
        perms.has(PermissionFlagsBits.SendMessages) &&
        perms.has(PermissionFlagsBits.EmbedLinks),
    );
  };

  if (canPost(guild.systemChannel)) return guild.systemChannel;

  return (
    guild.channels.cache
      .filter((channel) => channel.isTextBased() && canPost(channel))
      .sort((a, b) => a.rawPosition - b.rawPosition)
      .first() ?? null
  );
}
