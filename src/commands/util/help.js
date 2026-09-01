import { EmbedBuilder, MessageFlags, SlashCommandBuilder } from 'discord.js';
import { COLORS } from '../../lib/embeds.js';

export const data = new SlashCommandBuilder()
  .setName('help')
  .setDescription('List everything NeoBot can do.');

export const guildOnly = false;

/**
 * Curated rather than generated from the loaded commands.
 *
 * A list built from `client.commands` would stay in sync for free, but it can
 * only ever say what each command is named — and the most useful thing about
 * this bot is a BEHAVIOUR rather than a command: once /tts-join runs, plain
 * chat is read aloud with nothing further typed. An auto-generated list would
 * describe the door and never mention the room.
 *
 * The cost is that this file has to be updated alongside a new command.
 */
const SECTIONS = [
  {
    name: '🔊 Text-to-speech — my main trick',
    value: [
      'Run `/tts-join` in a voice channel and I read **its own chat** aloud.',
      'No command per message — just type in the voice channel and I speak it.',
      '',
      '`/tts-join` — join and start reading',
      '`/tts-leave` — stop (I also leave on my own when the channel empties)',
      '`/tts-voice` — show, change or reset my voice (300+ to choose from)',
      "`/say` — Discord's own TTS, read by your client, not in voice",
    ].join('\n'),
  },
  {
    name: '🎵 Music',
    value: [
      '`/play` — search or paste a link to queue audio',
      '`/queue` `/nowplaying` — see what is lined up',
      '`/skip` `/pause` `/resume` `/stop` `/leave` — control playback',
      '',
      'Music and speech share one connection: a track **pauses while I speak**,',
      'then picks up exactly where it left off.',
    ].join('\n'),
  },
  {
    name: '🎮 Game deals',
    value: [
      '`/deals` — cheapest price across Steam, Epic, GOG, Humble and friends',
      '`/steam` — Steam store page details for one game',
      '',
      'Both take an optional **watch** channel: pick one and I post there',
      'whenever that price changes. `/pricewatch` lists and cancels them.',
    ].join('\n'),
  },
  {
    name: '🛡️ Moderation (mods only)',
    value: [
      '`/warn` `/warnings` `/delwarn` — the infraction log',
      '`/timeout` `/untimeout` `/kick` `/ban` `/unban` — enforcement',
      '`/purge` — bulk-delete recent messages',
    ].join('\n'),
  },
  {
    name: '⚙️ Setup',
    value: [
      '`/config` — server settings: deals API key, country, TTS limits and the',
      'error log channel. Needs **Manage Server**, and only you see the panel.',
    ].join('\n'),
  },
  {
    name: '🔧 Utilities',
    value: [
      '`/ping` — check I am alive, and how laggy my connection is',
      '`/help` — this list',
    ].join('\n'),
  },
];

export async function execute(interaction) {
  const embed = new EmbedBuilder()
    .setColor(COLORS.info)
    .setTitle('NeoBot commands')
    .setDescription(
      'Everything is a slash command — type `/` and Discord will filter as you go.\n' +
        'Only the two voice features need anything beyond typing the command.',
    )
    .addFields(SECTIONS)
    .setFooter({
      text: 'Only people in the voice channel get read aloud · Infraction records are deleted automatically after 30 days.',
    });

  await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
}
