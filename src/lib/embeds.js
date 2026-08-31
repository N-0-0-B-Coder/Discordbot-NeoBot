import { EmbedBuilder } from 'discord.js';

export const COLORS = {
  success: 0x57f287,
  error: 0xed4245,
  info: 0x5865f2,
  warning: 0xfee75c,
  deal: 0x1b9e4b,
};

export const success = (description, title) =>
  base(COLORS.success, description, title);
export const error = (description, title) => base(COLORS.error, description, title);
export const info = (description, title) => base(COLORS.info, description, title);
export const warning = (description, title) =>
  base(COLORS.warning, description, title);

function base(color, description, title) {
  const embed = new EmbedBuilder().setColor(color).setDescription(description);
  if (title) embed.setTitle(title);
  return embed;
}

/** Trims a string to Discord's field/description limits without cutting mid-word. */
export function truncate(text, max) {
  if (!text || text.length <= max) return text;
  const cut = text.slice(0, max - 1);
  const lastSpace = cut.lastIndexOf(' ');
  return `${lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut}…`;
}

/** Formats seconds as m:ss, or h:mm:ss past an hour. */
export function formatDuration(totalSeconds) {
  if (!Number.isFinite(totalSeconds) || totalSeconds <= 0) return 'live';
  const seconds = Math.floor(totalSeconds % 60);
  const minutes = Math.floor((totalSeconds / 60) % 60);
  const hours = Math.floor(totalSeconds / 3600);
  const pad = (n) => String(n).padStart(2, '0');
  return hours > 0
    ? `${hours}:${pad(minutes)}:${pad(seconds)}`
    : `${minutes}:${pad(seconds)}`;
}
