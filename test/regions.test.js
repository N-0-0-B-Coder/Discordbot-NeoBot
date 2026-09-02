import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { flag, REGIONS } from '../src/lib/regions.js';
import { toUsd } from '../src/services/fx.js';
import { rankResults } from '../src/services/steam.js';
import { describeRegionalPrices, notSoldHere } from '../src/lib/regional-prices.js';

const RATES = { VND: 26007.44, TRY: 48.28, BRL: 5.18 };

describe('region flags', () => {
  test('builds a flag from any country code', () => {
    assert.equal(flag('VN'), '🇻🇳');
    assert.equal(flag('br'), '🇧🇷');
  });

  test('bad input never throws', () => {
    assert.equal(flag('nonsense'), '🏳️');
    assert.equal(flag(''), '🏳️');
  });

  test('every configured region has a usable code', () => {
    for (const region of REGIONS) {
      assert.match(region.code, /^[A-Z]{2}$/, `${region.name} has a bad code`);
    }
  });
});

describe('currency conversion', () => {
  test('converts to USD', () => {
    assert.equal(Math.round(toUsd(260074.4, 'VND', RATES)), 10);
  });

  test('USD passes through untouched', () => {
    assert.equal(toUsd(9.99, 'USD', RATES), 9.99);
  });

  test('an unknown currency returns null, not a wrong number', () => {
    // Better an unranked row than a confidently incorrect conversion.
    assert.equal(toUsd(500, 'XYZ', RATES), null);
  });

  test('missing rates return null rather than throwing', () => {
    assert.equal(toUsd(500, 'VND', null), null);
  });
});

describe('regional price comparison', () => {
  const regions = [
    { code: 'US', name: 'United States', amount: 9.99, currency: 'USD', formatted: '$9.99', discountPercent: 0 },
    { code: 'VN', name: 'Vietnam', amount: 102000, currency: 'VND', formatted: '₫102.000', discountPercent: 0 },
    { code: 'BR', name: 'Brazil', amount: 20.69, currency: 'BRL', formatted: 'R$20,69', discountPercent: 50 },
  ];

  test('orders by real value, not by the printed number', async () => {
    // ₫102.000 is the largest number and the cheapest price. Sorting on the
    // raw amount would put Vietnam last.
    const { lines, ranked, cheapest } = await describeRegionalPrices(regions, {
      limit: 3,
      rates: RATES,
    });
    assert.equal(ranked, true);
    assert.equal(cheapest.code, 'VN');
    assert.match(lines[0], /Vietnam/);
  });

  test('shows the native price and the conversion', async () => {
    const { lines } = await describeRegionalPrices(regions, { rates: RATES });
    const vietnam = lines.find((line) => line.includes('Vietnam'));
    assert.ok(vietnam.includes('₫102.000'), vietnam);
    assert.ok(vietnam.includes('≈ $'), 'should show a comparable value');
  });

  test('an empty region list is not an error', async () => {
    const { lines, cheapest } = await describeRegionalPrices([], { rates: RATES });
    assert.deepEqual(lines, []);
    assert.equal(cheapest, null);
  });
});

describe('not sold locally', () => {
  test('names where it can be bought instead', () => {
    const line = notSoldHere('VN', {
      code: 'US',
      name: 'United States',
      formatted: '$9.99',
    });
    assert.ok(line.includes('Not sold on the VN store'));
    assert.ok(line.includes('United States'));
    assert.ok(line.includes('$9.99'));
  });

  test('says so plainly when nowhere sells it', () => {
    const line = notSoldHere('VN', null);
    assert.ok(line.includes('could not find a region'));
  });
});

describe('search result ranking', () => {
  // Searching Vietnam for "Helldivers 2" returned only its armour-set DLC,
  // because the base game is not sold there. Two things were wrong: the search
  // was scoped to the local storefront, and DLC outranked games.
  const items = [
    { id: 2, name: 'HELLDIVERS™ 2 - TR-117 Alpha Commander Armor Set', type: 'dlc' },
    { id: 1, name: 'HELLDIVERS™ 2', type: 'app' },
    { id: 3, name: 'HELLDIVERS™ 2 - Super Citizen Edition', type: 'app' },
  ];

  test('the base game outranks its DLC and editions', () => {
    const [first] = rankResults(items, 'helldivers 2');
    assert.equal(first.id, 1, `got "${rankResults(items, 'helldivers 2')[0].name}"`);
  });

  test('DLC sinks below every plain app', () => {
    const ranked = rankResults(items, 'helldivers');
    assert.equal(ranked[ranked.length - 1].type, 'dlc');
  });

  test('an exact title match wins', () => {
    const ranked = rankResults(
      [{ id: 1, name: 'Terraria Soundtrack' }, { id: 2, name: 'Terraria' }],
      'terraria',
    );
    assert.equal(ranked[0].id, 2);
  });

  test('a missing type is treated as an app, not demoted', () => {
    // The endpoint is undocumented; losing the field must not reorder
    // everything into nonsense.
    const ranked = rankResults([{ id: 1, name: 'Portal 2' }], 'portal 2');
    assert.equal(ranked[0].id, 1);
  });

  test('ranking never mutates the input', () => {
    const original = [...items];
    rankResults(items, 'helldivers');
    assert.deepEqual(items, original);
  });
});
