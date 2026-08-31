const UNITS = {
  s: 1000,
  m: 60 * 1000,
  h: 60 * 60 * 1000,
  d: 24 * 60 * 60 * 1000,
  w: 7 * 24 * 60 * 60 * 1000,
};

const TOKEN = /(\d+)\s*([smhdw])/gi;

/**
 * Parses "10m", "1h30m", "2d" into milliseconds.
 * Returns null when nothing parseable is found.
 */
export function parseDuration(input) {
  if (!input) return null;
  let total = 0;
  let matched = false;
  for (const [, amount, unit] of input.matchAll(TOKEN)) {
    total += Number(amount) * UNITS[unit.toLowerCase()];
    matched = true;
  }
  return matched ? total : null;
}

/** Renders milliseconds back as a compact "1d 2h 30m" string. */
export function formatDurationMs(ms) {
  if (!ms || ms <= 0) return '0s';
  const parts = [];
  let remaining = ms;
  for (const [unit, size] of [
    ['d', UNITS.d],
    ['h', UNITS.h],
    ['m', UNITS.m],
    ['s', UNITS.s],
  ]) {
    const value = Math.floor(remaining / size);
    if (value > 0) {
      parts.push(`${value}${unit}`);
      remaining -= value * size;
    }
  }
  return parts.join(' ');
}
