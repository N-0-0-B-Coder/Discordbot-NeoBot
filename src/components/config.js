/**
 * The interactive `/config` panel.
 *
 * Everything here is ephemeral — only the person who ran `/config` ever sees
 * it. That is not cosmetic: the ITAD API key is entered and echoed back through
 * this flow, and a public panel would leak it to the channel.
 *
 * Flow:
 *   /config              -> panel (embed + select menu)
 *   pick a setting       -> modal (text), instant toggle (boolean), or
 *                           "use this channel" (channel)
 *   submit / toggle      -> save, re-render the same ephemeral panel
 *
 * customIds are namespaced `config:*` so one handler file covers the whole
 * flow via prefix routing.
 */
import {
  ActionRowBuilder,
  EmbedBuilder,
  LabelBuilder,
  MessageFlags,
  ModalBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  TextInputBuilder,
  TextInputStyle,
} from 'discord.js';
import { COLORS } from '../lib/embeds.js';
import {
  EDITABLE_SETTINGS,
  SETTINGS,
  SETTINGS_BY_KEY,
  coerce,
} from '../lib/guild-config.js';
import {
  getAllSettings,
  isConfigured,
  markConfigured,
  resetSetting,
  setSetting,
} from '../db/guild-settings.js';

export const SELECT_ID = 'config:select';
const MODAL_PREFIX = 'config:modal';
const INPUT_ID = 'value';

/** Builds the panel: current values plus the picker. Reused after every change. */
export function buildPanel(guild, notice = null) {
  const settings = getAllSettings(guild.id);

  const embed = new EmbedBuilder()
    .setColor(notice?.error ? COLORS.error : COLORS.info)
    .setTitle(`⚙️ Configuration — ${guild.name}`)
    .setDescription(
      notice?.text ??
        'Pick a setting below to change it. Only you can see this panel.',
    );

  for (const setting of SETTINGS) {
    const { value, overridden } = settings[setting.key];
    embed.addFields({
      name: `${setting.emoji} ${setting.label}`,
      value: `${setting.format(value)}${overridden ? '' : ' *(default)*'}`,
      inline: true,
    });
  }

  embed.setFooter({
    text: isConfigured(guild.id)
      ? 'Values marked (default) follow the bot-wide setting.'
      : 'Not configured yet — change anything here to finish setup.',
  });

  const menu = new StringSelectMenuBuilder()
    .setCustomId(SELECT_ID)
    .setPlaceholder('Choose a setting to change…')
    .addOptions(
      ...EDITABLE_SETTINGS.map((setting) =>
        new StringSelectMenuOptionBuilder()
          .setLabel(setting.label)
          .setDescription(setting.description.slice(0, 100))
          .setValue(setting.key)
          .setEmoji(setting.emoji),
      ),
      new StringSelectMenuOptionBuilder()
        .setLabel('Reset everything to defaults')
        .setDescription('Clears every override for this server')
        .setValue('__reset_all')
        .setEmoji('♻️'),
    );

  return {
    embeds: [embed],
    components: [new ActionRowBuilder().addComponents(menu)],
    flags: MessageFlags.Ephemeral,
  };
}

/** Handles both the select menu and the modals it opens. */
export const id = 'config';

export async function execute(interaction) {
  if (interaction.isStringSelectMenu()) return handleSelect(interaction);
  if (interaction.isModalSubmit()) return handleModal(interaction);
}

async function handleSelect(interaction) {
  const choice = interaction.values[0];

  if (choice === '__reset_all') {
    for (const setting of SETTINGS) resetSetting(interaction.guildId, setting.key);
    await interaction.update(
      buildPanel(interaction.guild, { text: '♻️ Everything is back to defaults.' }),
    );
    return;
  }

  const setting = SETTINGS_BY_KEY.get(choice);
  if (!setting) return;

  // Booleans need no input — toggling is the whole interaction.
  if (setting.type === 'boolean') {
    const current = getAllSettings(interaction.guildId)[setting.key].value;
    setSetting(interaction.guildId, setting.key, !current);
    markConfigured(interaction.guildId);
    await interaction.update(
      buildPanel(interaction.guild, {
        text: `${setting.emoji} **${setting.label}** is now **${setting.format(!current)}**.`,
      }),
    );
    return;
  }

  // Channels come from where the command was run, per the requested behaviour:
  // run /config in the channel you want, and pick this.
  if (setting.type === 'channel') {
    setSetting(interaction.guildId, setting.key, interaction.channelId);
    markConfigured(interaction.guildId);
    await interaction.update(
      buildPanel(interaction.guild, {
        text: `${setting.emoji} **${setting.label}** set to <#${interaction.channelId}>.`,
      }),
    );
    return;
  }

  // Everything else takes text. A modal is the only private way to collect it —
  // a slash command option would be displayed to the whole channel, which for
  // the API key would mean leaking it.
  //
  // Modals no longer wrap their inputs in action rows: a Label component owns
  // the caption instead. That is why both TextInputBuilder#setLabel and
  // ModalBuilder#addComponents are deprecated — the label moved out of the
  // input and into a component of its own, which can also carry a description.
  const modal = new ModalBuilder()
    .setCustomId(`${MODAL_PREFIX}:${setting.key}`)
    .setTitle(setting.label.slice(0, 45))
    .setLabelComponents(
      new LabelBuilder()
        .setLabel(setting.modalLabel.slice(0, 45))
        .setTextInputComponent(
          new TextInputBuilder()
            .setCustomId(INPUT_ID)
            .setStyle(TextInputStyle.Short)
            .setPlaceholder(setting.placeholder ?? '')
            .setMaxLength(setting.maxLength ?? 100)
            // Blank means "clear this override and go back to the default".
            .setRequired(false),
        ),
    );

  // showModal must be the FIRST response to an interaction — it cannot follow a
  // defer or an update, so nothing above may acknowledge this one.
  await interaction.showModal(modal);
}

async function handleModal(interaction) {
  const key = interaction.customId.slice(`${MODAL_PREFIX}:`.length);
  const setting = SETTINGS_BY_KEY.get(key);
  if (!setting) return;

  const raw = interaction.fields.getTextInputValue(INPUT_ID);

  if (!raw.trim()) {
    resetSetting(interaction.guildId, key);
    await respond(interaction, {
      text: `${setting.emoji} **${setting.label}** reset to the default.`,
    });
    return;
  }

  const result = coerce(setting, raw);
  if (!result.ok) {
    await respond(interaction, {
      text: `⚠️ ${result.reason}\n**${setting.label}** was left unchanged.`,
      error: true,
    });
    return;
  }

  setSetting(interaction.guildId, key, result.value);
  markConfigured(interaction.guildId);
  await respond(interaction, {
    text: `${setting.emoji} **${setting.label}** is now ${setting.format(result.value)}.`,
  });
}

/**
 * Re-renders the panel after a modal.
 *
 * A modal opened from a message component can edit that message via update();
 * one opened straight from a command cannot, and needs a fresh reply instead.
 */
async function respond(interaction, notice) {
  const panel = buildPanel(interaction.guild, notice);
  if (interaction.isFromMessage()) {
    await interaction.update(panel);
  } else {
    await interaction.reply(panel);
  }
}
