import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { db } from '../src/db/index.js';
import {
  addWatch,
  listWatches,
  removeWatch,
  recordCheck,
  MAX_WATCHES_PER_GUILD,
} from '../src/db/price-watches.js';
import { checkWatch } from '../src/services/price-watch.js';

const base = {
  guildId: 'g-watch',
  channelId: 'chan-1',
  source: 'steam',
  ref: '105600',
  title: 'Terraria',
  createdBy: 'u1',
};

beforeEach(() => {
  db.prepare('DELETE FROM price_watches').run();
});

describe('price watch storage', () => {
  test('adding the same game twice moves the channel instead of duplicating', () => {
    const first = addWatch(base);
    assert.equal(first.created, true);

    const second = addWatch({ ...base, channelId: 'chan-2' });
    assert.equal(second.created, false, 'second add should not report as new');

    const watches = listWatches(base.guildId);
    assert.equal(watches.length, 1);
    assert.equal(watches[0].channel_id, 'chan-2');
  });

  test('the per-guild cap is enforced', () => {
    for (let i = 0; i < MAX_WATCHES_PER_GUILD; i += 1) {
      addWatch({ ...base, ref: `app-${i}` });
    }
    const overflow = addWatch({ ...base, ref: 'one-too-many' });
    assert.equal(overflow.atLimit, true);
    assert.equal(listWatches(base.guildId).length, MAX_WATCHES_PER_GUILD);
  });

  test('removal is scoped to the guild that owns the watch', () => {
    const { watch } = addWatch(base);
    assert.equal(removeWatch('some-other-guild', watch.id), false);
    assert.equal(removeWatch(base.guildId, watch.id), true);
  });

  test('a watch survives a restart with its last price', () => {
    // The comparison lives in SQLite precisely so a redeploy does not make the
    // bot re-announce every game it watches.
    const { watch } = addWatch(base);
    recordCheck(watch.id, { amount: 4.99, currency: 'USD', shop: 'Steam' });

    const [reloaded] = listWatches(base.guildId);
    assert.equal(reloaded.last_amount, 4.99);
    assert.equal(reloaded.last_shop, 'Steam');
  });
});

describe('price watch checking', () => {
  /** A client whose channel accepts sends and records them. */
  function fakeClient(sent) {
    return {
      channels: {
        fetch: async () => ({
          isTextBased: () => true,
          send: async (payload) => sent.push(payload),
        }),
      },
    };
  }

  test('the first check records the price without announcing', async () => {
    // Otherwise creating a watch would instantly report a "change" from
    // nothing to the current price.
    const sent = [];
    const { watch } = addWatch(base);
    watch.last_amount = null;

    const outcome = await checkWatch(
      fakeClient(sent),
      { ...watch, last_amount: null },
      { lookup: async () => ({ amount: 4.99, currency: 'USD', shop: 'Steam' }) },
    );

    assert.equal(outcome, 'recorded');
    assert.equal(sent.length, 0, 'nothing should be announced on the first check');
  });

  test('a price drop is announced with the previous price', async () => {
    const sent = [];
    const { watch } = addWatch(base);
    recordCheck(watch.id, { amount: 9.99, currency: 'USD', shop: 'Steam' });
    const [stored] = listWatches(base.guildId);

    const outcome = await checkWatch(
      fakeClient(sent),
      stored,
      { lookup: async () => ({ amount: 4.99, currency: 'USD', shop: 'Steam', cut: 50 }) },
    );

    assert.equal(outcome, 'announced');
    assert.equal(sent.length, 1);
    const { description } = sent[0].embeds[0].data;
    assert.ok(description.includes('4.99'), description);
    assert.ok(description.includes('9.99'), 'should say what it was before');
  });

  test('an unchanged price says nothing at all', async () => {
    const sent = [];
    const { watch } = addWatch(base);
    recordCheck(watch.id, { amount: 4.99, currency: 'USD', shop: 'Steam' });
    const [stored] = listWatches(base.guildId);

    const outcome = await checkWatch(
      fakeClient(sent),
      stored,
      { lookup: async () => ({ amount: 4.99, currency: 'USD', shop: 'Steam' }) },
    );

    assert.equal(outcome, 'unchanged');
    assert.equal(sent.length, 0);
  });

  test('an unreadable price is not treated as a change to zero', async () => {
    // A store outage must not announce "now free".
    const sent = [];
    const { watch } = addWatch(base);
    recordCheck(watch.id, { amount: 4.99, currency: 'USD', shop: 'Steam' });
    const [stored] = listWatches(base.guildId);

    const outcome = await checkWatch(fakeClient(sent), stored, {
      lookup: async () => null,
    });

    assert.equal(outcome, 'unreadable');
    assert.equal(sent.length, 0);
    assert.equal(listWatches(base.guildId)[0].last_amount, 4.99, 'price should be kept');
  });

  test('a watch whose channel is gone is dropped, not retried forever', async () => {
    const { watch } = addWatch(base);
    const client = { channels: { fetch: async () => null } };

    const outcome = await checkWatch(client, watch);

    assert.equal(outcome, 'channel-gone');
    assert.equal(listWatches(base.guildId).length, 0);
  });
});
