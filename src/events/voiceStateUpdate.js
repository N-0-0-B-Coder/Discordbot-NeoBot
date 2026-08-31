import { Events } from 'discord.js';
import { peekPlayer } from '../music/manager.js';
import { log } from '../lib/logger.js';

export const name = Events.VoiceStateUpdate;

/**
 * Leaves the voice channel once the last human walks out, so the bot is not
 * sitting alone in an empty channel burning a connection.
 */
export function execute(oldState, newState) {
  const player = peekPlayer(oldState.guild.id);
  if (!player?.connection) return;

  const channelId = player.connection.joinConfig.channelId;
  // Only react when somebody actually left the bot's channel.
  if (oldState.channelId !== channelId || newState.channelId === channelId) return;

  const channel = oldState.guild.channels.cache.get(channelId);
  if (!channel) return;

  const humans = channel.members.filter((member) => !member.user.bot).size;
  if (humans === 0) {
    log.info(`[${oldState.guild.id}] Voice channel emptied, disconnecting.`);
    player.announce('👋 Everyone left, so I am heading out too.');
    player.destroy();
  }
}
