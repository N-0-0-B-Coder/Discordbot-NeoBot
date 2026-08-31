import { Events } from 'discord.js';
import { getSetting } from '../db/guild-settings.js';
import { log } from '../lib/logger.js';
import { peekPlayer } from '../music/manager.js';
import { toSpeakableText } from '../tts/sanitize.js';

export const name = Events.MessageCreate;

/**
 * Reads the voice channel's built-in text chat aloud while TTS mode is on.
 *
 * A voice channel in Discord has its own text chat, and messages sent there
 * carry the voice channel's own id as `channel.id` — which is what makes
 * "chat in this voice room" a precise thing to match on, with no channel
 * pairing or naming convention needed.
 *
 * This is the one handler that needs the MESSAGE_CONTENT privileged intent.
 * Without it `message.content` arrives as an empty string and every message is
 * silently skipped by the `speakable` check below — the bot looks broken rather
 * than erroring, so check the intent first if TTS goes quiet.
 */
export async function execute(message) {
  // Ignore bots (including ourselves) — otherwise the bot's own announcements
  // would be read back, and two TTS bots in one channel would feed each other.
  if (message.author.bot || !message.inGuild()) return;

  const session = peekPlayer(message.guildId);
  if (!session?.ttsEnabled) return;

  // Only the chat belonging to the voice channel the bot is sitting in.
  if (message.channelId !== session.ttsChannelId) return;

  // Only people actually in the voice channel, per the chosen behaviour: a
  // lurker reading along in the chat should not be able to talk through the bot.
  const speakerChannelId = message.member?.voice?.channelId;
  if (!speakerChannelId || speakerChannelId !== session.voiceChannelId) return;

  const text = toSpeakableText(
    message,
    getSetting(message.guildId, 'ttsMaxMessageLength'),
  );
  if (!text) return;

  const spoken = getSetting(message.guildId, 'ttsAnnounceAuthor')
    ? `${message.member.displayName} says: ${text}`
    : text;

  try {
    await session.speak(spoken);
  } catch (err) {
    // Never let a TTS failure interfere with the chat itself.
    log.warn(`TTS failed for a message in ${message.guild.name}:`, err);
  }
}
