/**
 * Terminal colour, borrowed in spirit from RNBot.
 *
 * RNBot used chalk to colour its database status lines — green for connected,
 * cyan for connecting, gray for disconnected — so state was readable at a
 * glance instead of being buried in uniform text. Same idea here, with a
 * broader palette and no dependency: Node's built-in `util.styleText` covers
 * it, and unlike chalk v4 it needs no CJS interop in an ESM project.
 *
 * Colour is suppressed automatically when stdout is not a TTY (piped to a file,
 * or a hosting platform's log collector) and when NO_COLOR is set, so Railway
 * logs stay clean rather than full of escape codes.
 */
import { styleText } from 'node:util';

const OPTIONS = { validateStream: true, stream: process.stdout };

/**
 * Applies one or more styles. Falls back to the raw string if a style name is
 * not recognised — colour is decoration, and must never be the thing that
 * throws inside a log call.
 */
export function paint(styles, text) {
  try {
    return styleText(styles, String(text), OPTIONS);
  } catch {
    return String(text);
  }
}

export const red = (text) => paint('red', text);
export const green = (text) => paint('green', text);
export const yellow = (text) => paint('yellow', text);
export const cyan = (text) => paint('cyan', text);
export const gray = (text) => paint('gray', text);
export const bold = (text) => paint('bold', text);
export const dim = (text) => paint('dim', text);
export const underline = (text) => paint('underline', text);

/** Emphasis for a value the reader is meant to act on — a URL, an id, a count. */
export const highlight = (text) => paint(['cyan', 'bold'], text);
