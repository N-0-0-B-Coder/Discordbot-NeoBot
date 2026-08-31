import { config } from './config.js';
import { bold, cyan, dim, gray, green, paint, red, yellow } from './colors.js';

const LEVELS = { error: 0, warn: 1, info: 2, debug: 3 };
const threshold = LEVELS[config.logLevel] ?? LEVELS.info;

/**
 * Colour per level, so severity is readable at a glance rather than something
 * you have to parse. `success` is not a threshold of its own — it logs at info
 * level and exists purely to mark the handful of milestone lines (logged in,
 * commands registered, checks passed) in green, the way RNBot marked its
 * database connection.
 */
const STYLES = {
  error: { label: 'ERROR', paint: red },
  warn: { label: 'WARN ', paint: yellow },
  info: { label: 'INFO ', paint: cyan },
  success: { label: 'OK   ', paint: green },
  debug: { label: 'DEBUG', paint: gray },
};

function emit(level, args) {
  const threshold_level = level === 'success' ? 'info' : level;
  if (LEVELS[threshold_level] > threshold) return;

  const style = STYLES[level];
  const stamp = dim(`[${new Date().toISOString()}]`);
  const label = style.paint(bold(style.label));
  const line = `${stamp} ${label}`;

  if (level === 'error') console.error(line, ...args);
  else if (level === 'warn') console.warn(line, ...args);
  else console.log(line, ...args);
}

export const log = {
  error: (...args) => emit('error', args),
  warn: (...args) => emit('warn', args),
  info: (...args) => emit('info', args),
  /** Milestone lines worth spotting in a wall of INFO. */
  success: (...args) => emit('success', args),
  debug: (...args) => emit('debug', args),
};

// Re-exported so callers can colour values inside a message without reaching
// past the logger for the colour module.
export { paint };
