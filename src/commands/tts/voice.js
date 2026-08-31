import { EmbedBuilder, MessageFlags, SlashCommandBuilder } from 'discord.js';
import { config } from '../../lib/config.js';
import { COLORS, error, success } from '../../lib/embeds.js';
import {
  clearTtsVoice,
  getTtsVoice,
  hasCustomTtsVoice,
  setTtsVoice,
} from '../../db/guild-settings.js';
import { peekPlayer } from '../../music/manager.js';
import {
  describeVoice,
  isLiveList,
  searchVoices,
  validateVoice,
} from '../../tts/voices.js';

export const data = new SlashCommandBuilder()
  .setName('tts-voice')
  .setDescription('Show or change the voice I use to read chat aloud.')
  .addSubcommand((sub) =>
    sub.setName('show').setDescription('Show the voice currently in use'),
  )
  .addSubcommand((sub) =>
    sub
      .setName('set')
      .setDescription('Pick a new voice for this server')
      .addStringOption((option) =>
        option
          .setName('voice')
          .setDescription('Start typing a language or name, e.g. "viet" or "aria"')
          .setRequired(true)
          .setAutocomplete(true),
      ),
  )
  .addSubcommand((sub) =>
    sub
      .setName('reset')
      .setDescription(`Go back to the default (${config.tts.voice})`),
  );

export async function autocomplete(interaction) {
  const query = interaction.options.getFocused();
  // searchVoices never blocks on the network — it serves a cached list and
  // refreshes behind the scenes, so this always answers inside the 3s budget.
  const choices = searchVoices(query, 25).map((voice) => ({
    name: describeVoice(voice),
    value: voice.shortName,
  }));
  await interaction.respond(choices);
}

export async function execute(interaction) {
  const sub = interaction.options.getSubcommand();
  const guildId = interaction.guildId;

  if (sub === 'show') {
    const current = getTtsVoice(guildId);
    const custom = hasCustomTtsVoice(guildId);
    await interaction.reply({
      embeds: [
        new EmbedBuilder()
          .setColor(COLORS.info)
          .setTitle('🔊 Current TTS voice')
          .setDescription(`**${current}**`)
          .setFooter({
            text: custom
              ? 'Set for this server. /tts-voice reset returns to the default.'
              : `Server default, from TTS_VOICE. Change it with /tts-voice set.`,
          }),
      ],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (sub === 'reset') {
    clearTtsVoice(guildId);
    applyToLiveSession(interaction, config.tts.voice);
    await interaction.reply({
      embeds: [success(`🔊 Voice reset to **${config.tts.voice}**.`)],
    });
    return;
  }

  // --- set ---
  const requested = interaction.options.getString('voice', true);
  const result = validateVoice(requested);

  if (!result.ok) {
    const message =
      result.reason === 'not-found'
        ? `**${requested}** is not a voice I know. Pick one from the suggestions as you type.`
        : `**${requested}** does not look like a voice name. They look like \`vi-VN-HoaiMyNeural\`.`;
    await interaction.reply({
      embeds: [error(message)],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  setTtsVoice(guildId, result.voice);
  applyToLiveSession(interaction, result.voice);

  const embed = new EmbedBuilder()
    .setColor(COLORS.success)
    .setTitle('🔊 Voice changed')
    .setDescription(`Now reading chat aloud as **${result.voice}**.`);

  // Be honest when the catalogue could not be fetched and the name was accepted
  // on shape alone — better than silently failing at the first message.
  if (!result.certain) {
    embed.addFields({
      name: 'Not verified',
      value:
        'I could not reach the voice list, so I accepted this on its name alone. ' +
        'If nothing is spoken, the voice probably does not exist — run `/tts-voice reset`.',
    });
  } else if (!isLiveList()) {
    embed.setFooter({ text: 'Chosen from the built-in list.' });
  }

  await interaction.reply({ embeds: [embed] });
}

/** Applies the change immediately if the bot is already speaking in this guild. */
function applyToLiveSession(interaction, voice) {
  const session = peekPlayer(interaction.guildId);
  if (session) session.ttsVoice = voice;
}
