import { EmbedBuilder, MessageFlags, SlashCommandBuilder } from 'discord.js';
import { COLORS } from '../../lib/embeds.js';

export const data = new SlashCommandBuilder()
  .setName('help')
  .setDescription('List everything NeoBot can do.');

export const guildOnly = false;

const SECTIONS = [
  {
    name: '🔊 Text-to-speech',
    value: [
      '`/tts-join` — I join your voice channel and read its chat aloud',
      '`/tts-leave` — stop reading',
      '`/tts-voice` — show, change or reset the voice I speak in',
      '`/say` — Discord\'s own TTS, read by your client (not in voice)',
    ].join('\n'),
  },
  {
    name: '🎵 Music',
    value: [
      '`/play` — search or paste a link to queue audio',
      '`/queue` `/nowplaying` — see what is lined up',
      '`/skip` `/pause` `/resume` `/stop` `/leave` — control playback',
    ].join('\n'),
  },
  {
    name: '🎮 Game deals',
    value: [
      '`/deals` — cheapest price across Steam, Epic, GOG, Humble and friends',
      '`/steam` — Steam store page details for one game',
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
];

export async function execute(interaction) {
  const embed = new EmbedBuilder()
    .setColor(COLORS.info)
    .setTitle('NeoBot commands')
    .setDescription(
      'Everything is a slash command — type `/` and Discord will filter as you go.',
    )
    .addFields(SECTIONS)
    .setFooter({ text: 'Infraction records are deleted automatically after 30 days.' });

  await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
}
