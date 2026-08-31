/**
 * Turns a raw Discord message into something worth listening to.
 *
 * Reading raw message text aloud is unpleasant fast: a pasted URL becomes a
 * minute of "h-t-t-p-s-colon-slash-slash", a custom emoji becomes a numeric id,
 * and a code block becomes noise. Everything here exists because the naive
 * version is unusable.
 */

const PATTERNS = {
  // ```block``` and `inline` code
  codeBlock: /```[\s\S]*?```/g,
  inlineCode: /`([^`]+)`/g,
  url: /https?:\/\/\S+/gi,
  // <:name:id> and <a:name:id>
  customEmoji: /<a?:(\w+):\d+>/g,
  userMention: /<@!?(\d+)>/g,
  roleMention: /<@&(\d+)>/g,
  channelMention: /<#(\d+)>/g,
  // <t:1234567890:R>
  timestamp: /<t:\d+(?::[tTdDfFR])?>/g,
  // Markdown emphasis characters that should not be pronounced
  markdown: /[*_~|]{1,3}/g,
  // Repeated punctuation: "????!!!!" -> "?"
  repeatedPunctuation: /([!?.,])\1{1,}/g,
  whitespace: /\s+/g,
};

/**
 * @param {import('discord.js').Message} message
 * @param {number} maxLength
 * @returns {string} speakable text, or '' when there is nothing worth speaking
 */
export function toSpeakableText(message, maxLength) {
  let text = message.content ?? '';

  text = text
    .replace(PATTERNS.codeBlock, ' code block ')
    .replace(PATTERNS.inlineCode, '$1')
    .replace(PATTERNS.url, ' link ')
    .replace(PATTERNS.customEmoji, '$1')
    .replace(PATTERNS.timestamp, ' a time ');

  // Resolve mentions to display names using the caches Discord already gave us.
  text = text
    .replace(PATTERNS.userMention, (_, id) => {
      const member = message.guild?.members.cache.get(id);
      return member ? ` ${member.displayName} ` : ' someone ';
    })
    .replace(PATTERNS.roleMention, (_, id) => {
      const role = message.guild?.roles.cache.get(id);
      return role ? ` ${role.name} ` : ' a role ';
    })
    .replace(PATTERNS.channelMention, (_, id) => {
      const channel = message.guild?.channels.cache.get(id);
      return channel ? ` ${channel.name} ` : ' a channel ';
    });

  text = text
    .replace(PATTERNS.markdown, '')
    .replace(PATTERNS.repeatedPunctuation, '$1')
    .replace(PATTERNS.whitespace, ' ')
    .trim();

  // An attachment-only message has no content but is not nothing.
  if (!text && message.attachments.size > 0) {
    return message.attachments.size === 1
      ? 'sent an attachment'
      : `sent ${message.attachments.size} attachments`;
  }

  if (!text) return '';

  // Hard cap. Long messages are both unpleasant to sit through and the one case
  // where ducking could stall a paused music stream.
  if (text.length > maxLength) {
    return `${text.slice(0, maxLength)}… message truncated`;
  }
  return text;
}
