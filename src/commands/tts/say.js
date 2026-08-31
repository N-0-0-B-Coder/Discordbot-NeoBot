import {
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
} from 'discord.js';
import { error } from '../../lib/embeds.js';

export const data = new SlashCommandBuilder()
  .setName('say')
  .setDescription('Speak a message aloud using Discord\'s built-in text-to-speech.')
  .addStringOption((option) =>
    option
      .setName('message')
      .setDescription('What should I say?')
      .setRequired(true)
      .setMaxLength(200),
  );

export async function execute(interaction) {
  const message = interaction.options.getString('message', true);

  // Discord's native TTS costs nothing and needs no external API, but it is
  // gated on the bot having Send TTS Messages in this channel.
  const me = interaction.guild.members.me;
  const permissions = interaction.channel.permissionsFor(me);
  if (!permissions?.has(PermissionFlagsBits.SendTTSMessages)) {
    await interaction.reply({
      embeds: [
        error(
          'I need the **Send Text-to-Speech Messages** permission in this channel.',
        ),
      ],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  await interaction.reply({
    content: message,
    tts: true,
    // Never let a TTS payload ping the server: @everyone read aloud is exactly
    // the kind of thing a friend group would weaponise within the hour.
    allowedMentions: { parse: [] },
  });
}
