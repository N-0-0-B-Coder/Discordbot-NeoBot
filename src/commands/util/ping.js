import { MessageFlags, SlashCommandBuilder } from 'discord.js';
import { info } from '../../lib/embeds.js';

export const data = new SlashCommandBuilder()
  .setName('ping')
  .setDescription('Check that the bot is alive and see its gateway latency.');

export const guildOnly = false;

export async function execute(interaction) {
  const heartbeat = Math.round(interaction.client.ws.ping);
  const uptimeSeconds = Math.floor(interaction.client.uptime / 1000);
  await interaction.reply({
    embeds: [
      info(
        `🏓 Pong — gateway latency **${heartbeat}ms**, up for <t:${
          Math.floor(Date.now() / 1000) - uptimeSeconds
        }:R>.`,
      ),
    ],
    flags: MessageFlags.Ephemeral,
  });
}
