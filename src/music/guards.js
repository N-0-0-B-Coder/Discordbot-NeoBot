import { ChannelType, PermissionFlagsBits } from 'discord.js';

/**
 * Verifies the invoker is in a voice channel the bot can actually join and
 * speak in. Returns { channel } on success, or { problem } with a message to
 * show the user.
 */
export function requireVoiceChannel(interaction) {
  const channel = interaction.member?.voice?.channel;
  if (!channel) {
    return { problem: 'Join a voice channel first, then run this again.' };
  }
  if (
    channel.type !== ChannelType.GuildVoice &&
    channel.type !== ChannelType.GuildStageVoice
  ) {
    return { problem: 'I can only play in a normal voice channel.' };
  }

  const me = interaction.guild.members.me;
  const permissions = channel.permissionsFor(me);
  if (!permissions?.has(PermissionFlagsBits.Connect)) {
    return { problem: `I am not allowed to connect to **${channel.name}**.` };
  }
  if (!permissions.has(PermissionFlagsBits.Speak)) {
    return { problem: `I am not allowed to speak in **${channel.name}**.` };
  }
  // A full channel rejects the bot silently otherwise. userLimit 0 means no cap,
  // and Move Members lets the bot bypass the cap.
  if (
    channel.userLimit > 0 &&
    channel.members.size >= channel.userLimit &&
    !me.permissions.has(PermissionFlagsBits.MoveMembers)
  ) {
    return { problem: `**${channel.name}** is full.` };
  }

  return { channel };
}

/**
 * Playback controls should only be usable by someone in the same channel as the
 * bot — otherwise anyone in the server can skip a song they cannot hear.
 */
export function requireSameChannel(interaction, player) {
  if (!player?.connection) {
    return { problem: 'I am not playing anything right now.' };
  }
  const botChannelId = player.connection.joinConfig.channelId;
  if (interaction.member?.voice?.channelId !== botChannelId) {
    return { problem: 'You need to be in my voice channel to control playback.' };
  }
  return {};
}
