/**
 * Invite URL generator, and a decoder for permission integers.
 *
 *   npm run invite                  print the URL that adds this bot to a server
 *   npm run invite -- <integer>     explain what a permissions integer grants
 *
 * The important part of the URL is `scope=bot applications.commands`. A
 * "bot"-only invite lets the bot join, read and talk — but slash command
 * registration then fails with `Missing Access (50001)`, because owning commands
 * in a guild is exactly what the second scope grants. Re-authorising a bot that
 * is already present adds the missing scope; no need to kick it first.
 */
import { PermissionsBitField, PermissionFlagsBits } from 'discord.js';
import { config } from './lib/config.js';

// Named rather than a magic number so it stays auditable — every entry should
// map to a feature, and anything unused should be removed.
const PERMISSIONS = [
  // Baseline messaging
  PermissionFlagsBits.ViewChannel,
  PermissionFlagsBits.SendMessages,
  PermissionFlagsBits.EmbedLinks,
  PermissionFlagsBits.ReadMessageHistory,
  // /say — Discord's native TTS
  PermissionFlagsBits.SendTTSMessages,
  // /purge
  PermissionFlagsBits.ManageMessages,
  // Music and TTS voice playback
  PermissionFlagsBits.Connect,
  PermissionFlagsBits.Speak,
  // Moderation
  PermissionFlagsBits.KickMembers,
  PermissionFlagsBits.BanMembers,
  PermissionFlagsBits.ModerateMembers,
];

const required = new PermissionsBitField(PERMISSIONS);

/** Permissions that meaningfully widen what a leaked bot token could do. */
const SENSITIVE = [
  'Administrator',
  'ManageGuild',
  'ManageRoles',
  'ManageChannels',
  'ManageWebhooks',
  'MentionEveryone',
  'ManageGuildExpressions',
  'MoveMembers',
  'ManageNicknames',
  'ManageEvents',
  'ManageThreads',
];

const argument = process.argv[2];
if (argument) {
  decode(argument);
} else {
  printInviteUrl();
}

function decode(raw) {
  let chosen;
  try {
    chosen = new PermissionsBitField(BigInt(raw));
  } catch {
    console.error(`\n"${raw}" is not a permissions integer.\n`);
    process.exitCode = 1;
    return;
  }

  const granted = new Set(chosen.toArray());
  const requiredNames = required.toArray();

  console.log(`\nPermissions integer: ${chosen.bitfield}`);
  console.log(`Grants ${granted.size} permission(s).\n`);

  console.log('Required by this bot:');
  for (const name of requiredNames) {
    console.log(`  ${granted.has(name) ? '[ok]     ' : '[MISSING]'} ${name}`);
  }

  const extra = [...granted].filter((name) => !requiredNames.includes(name)).sort();
  if (extra.length > 0) {
    console.log(`\nGranted but unused by this bot (${extra.length}):`);
    for (const name of extra) console.log(`  - ${name}`);
  }

  const risky = SENSITIVE.filter((name) => granted.has(name));
  if (risky.length > 0) {
    console.log('\nWorth reconsidering — unused, and each widens the blast');
    console.log('radius if the bot token ever leaks:');
    for (const name of risky) console.log(`  ! ${name}`);
  }

  console.log(`\nWhat this bot actually needs: ${required.bitfield}`);
  console.log('Run `npm run invite` with no argument for a URL using exactly that.\n');
}

function printInviteUrl() {
  const url = new URL('https://discord.com/oauth2/authorize');
  url.searchParams.set('client_id', config.clientId);
  url.searchParams.set('permissions', required.bitfield.toString());
  url.searchParams.set('scope', 'bot applications.commands');

  console.log('\nInvite URL — open this and pick your server:\n');
  console.log(`  ${url.toString()}\n`);
  console.log('Scopes      : bot, applications.commands');
  console.log(`Permissions : ${required.bitfield}`);
  for (const name of required.toArray()) console.log(`  - ${name}`);
  console.log(
    '\nAlready added the bot? Open this anyway and authorise the same server —\n' +
      'it grants the applications.commands scope without removing anything.\n',
  );
}
