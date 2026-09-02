import { EmbedBuilder, MessageFlags, SlashCommandBuilder } from 'discord.js';
import { COLORS } from '../../lib/embeds.js';
import { mention } from '../../lib/command-mentions.js';

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
 * The cost is that this file has to be updated alongside a new command. A test
 * asserts every loaded command appears here.
 *
 * Built per invocation, not once at import, because `mention()` renders
 * clickable command chips from ids that are only known after login.
 */
function buildSections() {
  const m = mention;
  return [
    {
      name: '🔊 Text-to-speech — my main trick',
      value: [
        `Run ${m('tts-join')} in a voice channel and I read **its own chat** aloud.`,
        'No command per message — just type in the voice channel and I speak it.',
        '',
        `${m('tts-join')} — join and start reading`,
        `${m('tts-leave')} — stop (I also leave on my own when the channel empties)`,
        `${m('tts-voice show')} ${m('tts-voice set')} — 300+ voices to choose from`,
        `${m('say')} — Discord's own TTS, read by your client, not in voice`,
      ].join('\n'),
    },
    {
      name: '🎵 Music',
      value: [
        `${m('play')} — search or paste a link to queue audio`,
        `${m('queue')} ${m('nowplaying')} — see what is lined up`,
        `${m('skip')} ${m('pause')} ${m('resume')} ${m('stop')} ${m('leave')} — control playback`,
        '',
        'Music and speech share one connection: a track **pauses while I speak**,',
        'then picks up exactly where it left off.',
      ].join('\n'),
    },
    {
      name: '🎮 Game deals',
      value: [
        `${m('deals')} — cheapest price across Steam, Epic, GOG, Humble and friends`,
        `${m('steam')} — Steam store page details for one game`,
        '',
        'Both take an optional **watch** channel: pick one and I post there',
        `whenever that price changes. ${m('pricewatch list')} lists and cancels them.`,
        '',
        'Both also take **worldwide** — the same game priced across 16 countries,',
        'for when it is missing or dearer on your local store.',
      ].join('\n'),
    },
    {
      name: '🛡️ Moderation (mods only)',
      value: [
        `${m('warn')} ${m('warnings')} ${m('delwarn one')} — the infraction log`,
        `${m('timeout')} ${m('untimeout')} ${m('kick')} ${m('ban')} ${m('unban')} — enforcement`,
        `${m('purge')} — bulk-delete recent messages`,
      ].join('\n'),
    },
    {
      name: '⚙️ Setup',
      value: [
        `${m('config')} — server settings: deals API key, country, TTS limits and`,
        'the error log channel. Needs **Manage Server**, and only you see it.',
        '',
        `${m('config')} \`country:\` sets where prices come from — start typing a`,
        'country name and pick it from the list.',
      ].join('\n'),
    },
    {
      name: '🔧 Utilities',
      value: [
        `${m('ping')} — check I am alive, and how laggy my connection is`,
        `${m('help')} — this list`,
      ].join('\n'),
    },
  ];
}

export async function execute(interaction) {
  const embed = new EmbedBuilder()
    .setColor(COLORS.info)
    .setTitle('NeoBot commands')
    .setDescription(
      'Every command below is **clickable** — tap one to run it, no typing.\n' +
        'Only the two voice features need anything beyond that.',
    )
    .addFields(buildSections())
    .setFooter({
      text: 'Only people in the voice channel get read aloud · Infraction records are deleted automatically after 30 days.',
    });

  await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
}
