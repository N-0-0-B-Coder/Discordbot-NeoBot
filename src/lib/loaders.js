import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { log } from './logger.js';

/** Recursively collects every .js file under a directory. */
async function collectJsFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...(await collectJsFiles(full)));
    else if (entry.name.endsWith('.js')) files.push(full);
  }
  return files;
}

/**
 * Loads every command module under src/commands. Each must export `data`
 * (a SlashCommandBuilder) and `execute(interaction)`.
 */
export async function loadCommands(dir) {
  const commands = new Map();
  for (const file of await collectJsFiles(dir)) {
    const module = await import(pathToFileURL(file).href);
    if (!module.data || typeof module.execute !== 'function') {
      log.warn(`Skipping ${file}: missing "data" or "execute" export.`);
      continue;
    }
    commands.set(module.data.name, module);
    log.debug(`Loaded command /${module.data.name}`);
  }
  return commands;
}

/**
 * Loads every component handler under src/components. Each must export `id`
 * (a customId, or a customId prefix) and `execute(interaction)`.
 *
 * Deliberately the same recursive walk as commands and events. RNBot routed
 * components with a `switch` on folder name, which needed editing for every new
 * folder and shipped a missing `break` that quietly registered its bank buttons
 * as modals. Matching on the customId the component already carries removes the
 * whole category of mistake.
 */
export async function loadComponents(dir) {
  const components = new Map();
  for (const file of await collectJsFiles(dir)) {
    const module = await import(pathToFileURL(file).href);
    if (!module.id || typeof module.execute !== 'function') {
      log.warn(`Skipping ${file}: missing "id" or "execute" export.`);
      continue;
    }
    components.set(module.id, module);
    log.debug(`Loaded component ${module.id}`);
  }
  return components;
}

/**
 * Resolves a customId to its handler.
 *
 * Exact match first, then the longest registered prefix where the customId
 * continues with ':' — so `config:modal` handles `config:modal:priceCountry`
 * and components can carry context in their id. That matters because a
 * customId is capped at 100 characters and is the only state a component has:
 * module-level variables do not survive a restart, but the id does.
 */
export function findComponent(components, customId) {
  const exact = components.get(customId);
  if (exact) return exact;

  let best = null;
  let bestLength = -1;
  for (const [id, module] of components) {
    if (customId.startsWith(`${id}:`) && id.length > bestLength) {
      best = module;
      bestLength = id.length;
    }
  }
  return best;
}

/**
 * Loads every event module under src/events. Each must export `name` and
 * `execute(...args)`, optionally `once`.
 */
export async function loadEvents(dir, client) {
  for (const file of await collectJsFiles(dir)) {
    const module = await import(pathToFileURL(file).href);
    if (!module.name || typeof module.execute !== 'function') {
      log.warn(`Skipping ${file}: missing "name" or "execute" export.`);
      continue;
    }
    const handler = (...args) => module.execute(...args, client);
    if (module.once) client.once(module.name, handler);
    else client.on(module.name, handler);
    log.debug(`Bound event ${module.name}`);
  }
}
