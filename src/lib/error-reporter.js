/**
 * Mirrors runtime errors into a Discord channel.
 *
 * Ported from RNBot, which sent failures to a dedicated error-log thread and
 * pinged its owner. That is the right instinct for a bot on a hosted box: once
 * it is running on Railway nobody tails stdout, so a command that started
 * throwing yesterday goes unnoticed until somebody complains.
 *
 * Two things RNBot did NOT do, added here:
 *  - **Throttling.** RNBot reported every error unconditionally. A failure
 *    inside a loop would have hammered the channel and burned Discord rate
 *    limit. Identical errors here are collapsed into one message per window.
 *  - **Never throwing.** Reporting is best-effort. A failure to report an error
 *    must not itself become an error.
 */
import { EmbedBuilder } from 'discord.js';
import { config } from './config.js';
import { COLORS, truncate } from './embeds.js';
import { log } from './logger.js';
import { getSetting } from '../db/guild-settings.js';

const THROTTLE_MS = 5 * 60 * 1000;

// signature -> { lastSentAt, suppressed }
const recent = new Map();

let client = null;

/** Called once at startup so the reporter can resolve the channel later. */
export function attachClient(discordClient) {
  client = discordClient;
}

/**
 * Looked up lazily and defensively: the error reporter must work even when the
 * database is the thing that is broken, so a failure here degrades to the
 * environment default rather than throwing inside the error path.
 */
function resolveChannelId(guildId) {
  if (guildId) {
    try {
      return getSetting(guildId, 'errorLogChannelId') ?? config.errorLogChannelId;
    } catch {
      return config.errorLogChannelId;
    }
  }
  return config.errorLogChannelId;
}

/**
 * Reports an error to the configured channel. Always safe to call: it swallows
 * its own failures and returns nothing.
 *
 * @param {string} context  where it happened, e.g. "/play" or "retention sweep"
 * @param {unknown} error   the thrown value
 * @param {object} [meta]   extra key/value detail to include
 * @param {string} [guildId] report into this guild's configured channel
 */
export async function report(context, error, meta = {}, guildId = null) {
  // Console first — that path always works, even before login.
  log.error(`[${context}]`, error);

  // A guild's own channel wins; otherwise fall back to the bot-wide one from
  // the environment. Process-level errors (unhandled rejections) have no guild,
  // which is exactly what the fallback is for.
  const channelId = resolveChannelId(guildId);
  if (!channelId || !client?.isReady()) return;

  const message = error instanceof Error ? error.message : String(error);
  const signature = `${context}:${message}`;
  const now = Date.now();
  const seen = recent.get(signature);

  if (seen && now - seen.lastSentAt < THROTTLE_MS) {
    seen.suppressed++;
    return;
  }
  const suppressed = seen?.suppressed ?? 0;
  recent.set(signature, { lastSentAt: now, suppressed: 0 });

  try {
    const channel = await client.channels.fetch(channelId);
    if (!channel?.isTextBased()) return;

    const embed = new EmbedBuilder()
      .setColor(COLORS.error)
      .setTitle(`Error in ${truncate(context, 240)}`)
      .setDescription(`\`\`\`\n${truncate(message, 1000)}\n\`\`\``)
      .setTimestamp();

    const stack = error instanceof Error ? error.stack : null;
    if (stack) {
      embed.addFields({
        name: 'Stack',
        value: `\`\`\`\n${truncate(stack, 1000)}\n\`\`\``,
      });
    }
    for (const [key, value] of Object.entries(meta)) {
      embed.addFields({
        name: key,
        value: truncate(String(value), 300),
        inline: true,
      });
    }
    if (suppressed > 0) {
      embed.setFooter({
        text: `${suppressed} identical error(s) suppressed in the last ${
          THROTTLE_MS / 60000
        } minutes`,
      });
    }

    await channel.send({
      content: config.ownerId ? `<@${config.ownerId}>` : undefined,
      embeds: [embed],
      allowedMentions: config.ownerId
        ? { users: [config.ownerId] }
        : { parse: [] },
    });
  } catch (reportErr) {
    // Reporting failed. Log it and move on — never rethrow from here.
    log.warn('Could not deliver the error report:', reportErr);
  }
}
