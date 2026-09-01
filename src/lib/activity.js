/**
 * One consistent line per thing the bot actually does.
 *
 * Until now a healthy run printed nothing between "logged in" and shutdown, so
 * a working session and a completely dead one looked identical in the log —
 * and every question about live behaviour ("did it even see the message?") had
 * to be answered by adding logging first and reproducing second. Voice made
 * that expensive: the interesting failures happen on a host you cannot attach a
 * debugger to.
 *
 * The format is fixed so the log stays greppable:
 *
 *     INFO  #bot-test-zone @Mango · /tts-join · channel: General
 *     INFO  #bot-test-zone @Mango · /tts-join done in 412ms
 *
 * Content is deliberately NOT logged at info level — messages read aloud are
 * summarised by length and previewed only under LOG_LEVEL=debug. A bot log that
 * quietly accumulates everything people said in a voice channel is not a thing
 * to build by default.
 */
import { log } from './logger.js';
import { dim, gray, highlight } from './colors.js';

/** Longest message preview written to a debug log. */
const PREVIEW_LIMIT = 80;

/**
 * Renders "#channel @user" for whoever triggered something.
 *
 * Every field is optional because this runs on the failure paths too, where the
 * interaction may be partially resolved — a logger that throws while explaining
 * an error is worse than no logger.
 */
function actor({ user, channel, guild } = {}) {
  const parts = [];
  if (channel) parts.push(gray(`#${channel}`));
  if (user) parts.push(gray(`@${user}`));
  if (!channel && !user && guild) parts.push(gray(`[${guild}]`));
  return parts.join(' ');
}

/**
 * Logs an action as it starts.
 *
 * @param {string} what    e.g. `/tts-join`, `button config:open`
 * @param {object} context {user, channel, guild, detail}
 */
export function logAction(what, { detail, ...where } = {}) {
  const prefix = actor(where);
  const suffix = detail ? dim(` · ${detail}`) : '';
  log.info(`${prefix} ${dim('·')} ${highlight(what)}${suffix}`.trim());
}

/** Logs the same action finishing, with how long it took. */
export function logDone(what, startedAt, where = {}) {
  const ms = Date.now() - startedAt;
  log.info(`${actor(where)} ${dim('·')} ${what} ${dim(`done in ${ms}ms`)}`.trim());
}

/**
 * Summarises message text for a log: a length at info, the words at debug.
 *
 * Returns the summary rather than logging it, so callers keep their own line
 * format and this stays the single place the privacy decision is made.
 */
export function describeText(text) {
  const summary = `${[...text].length} chars`;
  if (!text) return summary;
  const preview = text.length > PREVIEW_LIMIT ? `${text.slice(0, PREVIEW_LIMIT)}…` : text;
  log.debug(`  text: ${preview}`);
  return summary;
}

/**
 * Renders a command's arguments compactly: `voice: vi-VN-HoaiMy, limit: 5`.
 *
 * Discord shows command arguments to the whole channel anyway, so there is
 * nothing private here that the log is newly exposing — with one exception,
 * which is why the values of anything key-shaped are replaced.
 */
export function describeOptions(interaction) {
  const options = interaction.options?.data ?? [];
  if (options.length === 0) return '';

  const render = (option) => {
    // Subcommands carry their own nested options.
    if (option.options?.length) {
      return `${option.name} ${option.options.map(render).join(', ')}`;
    }
    const secret = /key|token|secret|password/i.test(option.name);
    return `${option.name}: ${secret ? '(hidden)' : option.value}`;
  };

  return options.map(render).join(', ');
}
