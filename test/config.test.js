import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { db } from '../src/db/index.js';
import * as gs from '../src/db/guild-settings.js';
import { SETTINGS_BY_KEY, EDITABLE_SETTINGS, coerce } from '../src/lib/guild-config.js';
import { buildPanel, SELECT_ID } from '../src/components/config.js';
import { findComponent } from '../src/lib/loaders.js';

describe('schema migration', () => {
  test('adds every declared column to a pre-existing table', () => {
    // db/index.js creates guild_settings with only (guild_id, tts_voice,
    // updated_at). Importing guild-settings.js must ALTER in the rest —
    // CREATE TABLE IF NOT EXISTS silently skips a table that already exists.
    const columns = db
      .prepare('PRAGMA table_info(guild_settings)')
      .all()
      .map((c) => c.name);
    for (const key of [
      'itad_api_key',
      'price_country',
      'tts_max_message_length',
      'tts_max_queue_length',
      'tts_announce_author',
      'error_log_channel_id',
      'configured_at',
    ]) {
      assert.ok(columns.includes(key), `missing column ${key}`);
    }
  });
});

describe('per-guild settings', () => {
  test('inherits environment defaults when unset', () => {
    assert.equal(gs.getSetting('gA', 'priceCountry'), 'US');
    assert.equal(gs.getSetting('gA', 'ttsMaxMessageLength'), 300);
    assert.equal(gs.isOverridden('gA', 'priceCountry'), false);
  });

  test('announce-author defaults to on', () => {
    assert.equal(gs.getSetting('gA', 'ttsAnnounceAuthor'), true);
  });

  test('overrides persist and are isolated per guild', () => {
    gs.setSetting('gB', 'priceCountry', 'VN');
    assert.equal(gs.getSetting('gB', 'priceCountry'), 'VN');
    assert.equal(gs.isOverridden('gB', 'priceCountry'), true);
    assert.equal(gs.getSetting('gC', 'priceCountry'), 'US', 'other guilds unaffected');
  });

  test('boolean false is stored, not treated as unset', () => {
    // The trap: SQLite has no BOOLEAN, and NULL means "inherit the default".
    // false must stay distinguishable from never having been set.
    gs.setSetting('gD', 'ttsAnnounceAuthor', false);
    assert.equal(gs.getSetting('gD', 'ttsAnnounceAuthor'), false);
    assert.equal(gs.isOverridden('gD', 'ttsAnnounceAuthor'), true);
  });

  test('reset clears the override and keeps the configured flag', () => {
    gs.setSetting('gE', 'priceCountry', 'JP');
    gs.markConfigured('gE');
    gs.resetSetting('gE', 'priceCountry');
    assert.equal(gs.getSetting('gE', 'priceCountry'), 'US');
    assert.equal(gs.isOverridden('gE', 'priceCountry'), false);
    assert.equal(gs.isConfigured('gE'), true);
  });

  test('getAllSettings reports value and override state together', () => {
    gs.setSetting('gF', 'ttsMaxQueueLength', 12);
    const all = gs.getAllSettings('gF');
    assert.equal(all.ttsMaxQueueLength.value, 12);
    assert.equal(all.ttsMaxQueueLength.overridden, true);
    assert.equal(all.priceCountry.overridden, false);
  });
});

describe('setting validation', () => {
  const country = SETTINGS_BY_KEY.get('priceCountry');
  const length = SETTINGS_BY_KEY.get('ttsMaxMessageLength');
  const apiKey = SETTINGS_BY_KEY.get('itadApiKey');

  test('country is normalised to upper case', () => {
    assert.deepEqual(coerce(country, 'vn'), { ok: true, value: 'VN' });
  });

  test('country rejects anything but two letters', () => {
    assert.equal(coerce(country, 'vnm').ok, false);
    assert.equal(coerce(country, '1').ok, false);
  });

  test('integers are range-checked', () => {
    assert.deepEqual(coerce(length, '250'), { ok: true, value: 250 });
    assert.equal(coerce(length, '10').ok, false);
    assert.equal(coerce(length, '5000').ok, false);
    assert.equal(coerce(length, 'abc').ok, false);
  });

  test('api key is trimmed and must not contain spaces', () => {
    assert.deepEqual(coerce(apiKey, '  abc123  '), { ok: true, value: 'abc123' });
    assert.equal(coerce(apiKey, 'ab cd').ok, false);
  });

  test('api key is masked when displayed', () => {
    assert.equal(apiKey.format('abcdef123456'), 'set (…3456)');
    assert.equal(apiKey.format(null), 'not set');
  });
});

describe('config panel', () => {
  test('is ephemeral and never exposes the raw key', () => {
    gs.setSetting('gG', 'itadApiKey', 'supersecret9999');
    const panel = buildPanel({ id: 'gG', name: 'Test' });
    assert.equal(panel.flags, 64, 'MessageFlags.Ephemeral');
    const rendered = JSON.stringify(panel.embeds[0].toJSON());
    assert.ok(!rendered.includes('supersecret9999'), 'raw key must never render');
    assert.ok(rendered.includes('…9999'), 'masked form should render');
  });

  test('offers every editable setting plus reset-all', () => {
    const panel = buildPanel({ id: 'gG', name: 'Test' });
    const menu = panel.components[0].toJSON().components[0];
    assert.equal(menu.custom_id, SELECT_ID);
    assert.equal(menu.options.length, EDITABLE_SETTINGS.length + 1);
  });
});

describe('component routing', () => {
  const registry = new Map([
    ['config', { id: 'config' }],
    ['other', { id: 'other' }],
  ]);

  test('matches exactly', () => {
    assert.equal(findComponent(registry, 'config').id, 'config');
  });

  test('matches by prefix so ids can carry context', () => {
    assert.equal(findComponent(registry, 'config:select').id, 'config');
    assert.equal(findComponent(registry, 'config:modal:priceCountry').id, 'config');
  });

  test('does not match a partial word', () => {
    assert.equal(findComponent(registry, 'configuration'), null);
  });

  test('returns null for unknown ids', () => {
    assert.equal(findComponent(registry, 'nope'), null);
  });
});
