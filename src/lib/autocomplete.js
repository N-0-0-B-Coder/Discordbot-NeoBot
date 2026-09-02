/**
 * Answering autocomplete inside Discord's deadline, always.
 *
 * Discord gives an autocomplete interaction **3 seconds** and then discards the
 * reply — the user sees "Loading options failed", which reads like the bot is
 * broken rather than slow. Two things make that easy to hit:
 *
 *  - the work is a live third-party API call, and
 *  - a cold cache means no shortcut.
 *
 * Both were true when this was written: /steam ran up to TWO Steam searches at
 * 2 seconds each, which fits comfortably inside 4 seconds and not at all inside
 * 3. It looked guild-specific because a server that had already searched had a
 * warm cache and never paid the cost.
 *
 * So the deadline is enforced HERE rather than hoped for. Whatever the work has
 * produced by the budget is sent; if it has produced nothing, the fallback goes
 * instead — which keeps the command usable, because a fallback offering the
 * text already typed still lets someone press enter.
 */
import { log } from './logger.js';

/** Comfortably inside Discord's 3s, leaving room for the round trip. */
const DEFAULT_BUDGET_MS = 2_200;

/**
 * @param {import('discord.js').AutocompleteInteraction} interaction
 * @param {Promise<Array<{name: string, value: string}>>} work
 * @param {{budgetMs?: number, fallback?: Array, label?: string}} options
 */
export async function respondInTime(interaction, work, options = {}) {
  const { budgetMs = DEFAULT_BUDGET_MS, fallback = [], label = 'autocomplete' } = options;

  let timer;
  const deadline = new Promise((resolve) => {
    timer = setTimeout(() => resolve(null), budgetMs);
    // Never let a pending suggestion hold the process open at shutdown.
    timer.unref?.();
  });

  const choices = await Promise.race([
    work.catch((err) => {
      log.debug(`${label} failed:`, err);
      return null;
    }),
    deadline,
  ]);
  clearTimeout(timer);

  const answer = choices?.length ? choices : fallback;

  try {
    await interaction.respond(answer.slice(0, 25));
  } catch (err) {
    // Past the deadline the token is dead and responding throws. Nothing can
    // be done for the user at that point, and it is not worth a warning —
    // but it must not propagate as an unhandled command failure.
    log.debug(`${label} could not be delivered:`, err);
  }
}

/**
 * A choice that simply echoes what the user typed.
 *
 * The point is that a slow API still leaves a usable command: both /steam and
 * /deals accept free text and search for it, so handing the typed string back
 * costs nothing and beats an empty list.
 */
export function echoChoice(query) {
  const text = String(query ?? '').trim().slice(0, 100);
  return text ? [{ name: text, value: text }] : [];
}
