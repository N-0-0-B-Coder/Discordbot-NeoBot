import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PermissionFlagsBits } from 'discord.js';
import { loadCommands, loadComponents } from '../src/lib/loaders.js';

const src = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');
const commands = await loadCommands(join(src, 'commands'));
const components = await loadComponents(join(src, 'components'));

async function allSourceFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...(await allSourceFiles(full)));
    else if (entry.name.endsWith('.js')) files.push(full);
  }
  return files;
}

describe('command payloads', () => {
  test('every command builds a valid payload', () => {
    // discord.js validates names, lengths and option shapes inside toJSON(),
    // so this catches most registration failures without contacting Discord.
    for (const [name, command] of commands) {
      assert.doesNotThrow(() => command.data.toJSON(), `/${name} failed to build`);
    }
  });

  test('no duplicate command names', () => {
    const names = [...commands.values()].map((c) => c.data.toJSON().name);
    assert.equal(new Set(names).size, names.length);
  });

  test('required options come before optional ones', () => {
    // Discord rejects a required option that follows an optional one.
    for (const [name, command] of commands) {
      const options = command.data.toJSON().options ?? [];
      let seenOptional = false;
      for (const option of options) {
        if (option.type === 1 || option.type === 2) continue; // sub-command / group
        if (option.required) {
          assert.ok(
            !seenOptional,
            `/${name}: required "${option.name}" follows an optional one`,
          );
        } else {
          seenOptional = true;
        }
      }
    }
  });

  test('options declaring autocomplete have a handler', () => {
    for (const [name, command] of commands) {
      const json = JSON.stringify(command.data.toJSON().options ?? []);
      if (json.includes('"autocomplete":true')) {
        assert.equal(
          typeof command.autocomplete,
          'function',
          `/${name} declares autocomplete but exports no handler`,
        );
      }
    }
  });

  test('moderation and config commands are permission-gated', () => {
    const gated = {
      ban: PermissionFlagsBits.BanMembers,
      kick: PermissionFlagsBits.KickMembers,
      timeout: PermissionFlagsBits.ModerateMembers,
      purge: PermissionFlagsBits.ManageMessages,
      config: PermissionFlagsBits.ManageGuild,
    };
    for (const [name, permission] of Object.entries(gated)) {
      const json = commands.get(name).data.toJSON();
      assert.equal(
        json.default_member_permissions,
        String(permission),
        `/${name} is not gated correctly`,
      );
    }
  });
});

describe('codebase conventions', () => {
  test('nothing uses the deprecated ephemeral flag', async () => {
    // discord.js v14.16+ deprecates `ephemeral: true` in favour of
    // `flags: MessageFlags.Ephemeral`. Easy to reintroduce by habit.
    for (const file of await allSourceFiles(src)) {
      const body = readFileSync(file, 'utf8');
      assert.ok(
        !/ephemeral:\s*true/.test(body),
        `${file} uses "ephemeral: true" — use flags: MessageFlags.Ephemeral`,
      );
    }
  });

  test('service calls that need a guild id are not called without one', async () => {
    // Guards the bug where isConfigured() lost its guildId argument and
    // silently reported on the environment key instead of the server's.
    for (const file of await allSourceFiles(join(src, 'commands'))) {
      const body = readFileSync(file, 'utf8');
      assert.ok(
        !/\bisConfigured\(\s*\)/.test(body),
        `${file} calls isConfigured() with no guild id`,
      );
    }
  });
});

describe('component handlers', () => {
  test('each exports an id and an execute', () => {
    for (const [id, module] of components) {
      assert.equal(typeof id, 'string');
      assert.equal(typeof module.execute, 'function');
    }
  });
});

describe('.env.example stays in sync with the code', () => {
  const root = join(src, '..');
  const template = readFileSync(join(root, '.env.example'), 'utf8');
  const configSource = readFileSync(join(src, 'lib', 'config.js'), 'utf8');

  // Every name config.js reads via required()/optional().
  const used = [
    ...configSource.matchAll(/(?:required|optional)\('([A-Z_]+)'/g),
  ].map((m) => m[1]);

  const documented = [...template.matchAll(/^([A-Z_]+)=/gm)].map((m) => m[1]);

  test('every variable the code reads is documented', () => {
    for (const name of new Set(used)) {
      assert.ok(
        documented.includes(name),
        `${name} is read by config.js but missing from .env.example`,
      );
    }
  });

  test('every documented variable is actually read', () => {
    for (const name of documented) {
      assert.ok(
        used.includes(name),
        `${name} is in .env.example but nothing reads it — stale entry`,
      );
    }
  });

  test('no secret is filled in', () => {
    // The template ships in the repo; the fields that carry a token, key or id
    // must always be blank in it.
    const mustBeBlank = [
      'DISCORD_TOKEN',
      'DISCORD_CLIENT_ID',
      'DISCORD_GUILD_ID',
      'ITAD_API_KEY',
      'ERROR_LOG_CHANNEL_ID',
      'OWNER_ID',
    ];
    for (const name of mustBeBlank) {
      const match = template.match(new RegExp(`^${name}=(.*)$`, 'm'));
      assert.ok(match, `${name} missing from .env.example`);
      assert.equal(
        match[1].trim(),
        '',
        `${name} has a value in .env.example — never commit a real one`,
      );
    }
  });
});
