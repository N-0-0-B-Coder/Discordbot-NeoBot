import { PermissionFlagsBits } from 'discord.js';

/**
 * Discord's `default_member_permissions` already hides a command from members who
 * lack the permission, but server owners can re-grant it per-role and admins can
 * override it — so every mod command re-checks at runtime. On top of that,
 * Discord's role hierarchy means "has BanMembers" is not the same as "may ban
 * *this* member": you cannot act on someone at or above your own top role, and
 * neither can the bot.
 *
 * Returns null when the action is allowed, or a user-facing reason string.
 */
export function checkTarget({ interaction, target, permission, verb }) {
  const invoker = interaction.member;
  const me = interaction.guild.members.me;

  if (!invoker.permissions.has(permission)) {
    return `You need the **${permissionName(permission)}** permission to ${verb} members.`;
  }
  if (!me.permissions.has(permission)) {
    return `I need the **${permissionName(permission)}** permission to ${verb} members. Ask an admin to grant it to my role.`;
  }
  if (!target) {
    // The user left the server, or was only ever resolved as a raw user object.
    return null;
  }
  if (target.id === interaction.user.id) {
    return `You cannot ${verb} yourself.`;
  }
  if (target.id === interaction.client.user.id) {
    return `I am not going to ${verb} myself.`;
  }
  if (target.id === interaction.guild.ownerId) {
    return `I cannot ${verb} the server owner.`;
  }
  if (
    invoker.id !== interaction.guild.ownerId &&
    invoker.roles.highest.comparePositionTo(target.roles.highest) <= 0
  ) {
    return `You cannot ${verb} **${target.user.tag}** — their highest role is not below yours.`;
  }
  if (me.roles.highest.comparePositionTo(target.roles.highest) <= 0) {
    return `I cannot ${verb} **${target.user.tag}** — my role sits below theirs. Move my role higher in Server Settings → Roles.`;
  }
  return null;
}

const PERMISSION_NAMES = new Map([
  [PermissionFlagsBits.BanMembers, 'Ban Members'],
  [PermissionFlagsBits.KickMembers, 'Kick Members'],
  [PermissionFlagsBits.ModerateMembers, 'Timeout Members'],
  [PermissionFlagsBits.ManageMessages, 'Manage Messages'],
]);

function permissionName(permission) {
  return PERMISSION_NAMES.get(permission) ?? 'the required';
}
