import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { flag, REGIONS } from '../src/lib/regions.js';
import { toUsd } from '../src/services/fx.js';
import { rankResults } from '../src/services/steam.js';
import { countryName, resolveCountry, searchCountries } from '../src/lib/countries.js';
import { echoChoice, respondInTime } from '../src/lib/autocomplete.js';
import {
  attachRegionalPrices,
  describeRegionalPrices,
  notSoldHere,
} from '../src/lib/regional-prices.js';

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

describe('country names', () => {
  // Nobody knows their ISO code. Everything downstream needs one, so the
  // translation happens once and people only ever see the name.
  test('resolves a full name', () => {
    assert.equal(resolveCountry('Vietnam'), 'VN');
    assert.equal(resolveCountry('united states'), 'US');
  });

  test('still accepts a code', () => {
    assert.equal(resolveCountry('vn'), 'VN');
    assert.equal(resolveCountry('GB'), 'GB');
  });

  test('an unambiguous prefix resolves, an ambiguous one does not', () => {
    assert.equal(resolveCountry('viet'), 'VN');
    // "united" is three countries — guessing would be worse than refusing.
    assert.equal(resolveCountry('united'), null);
  });

  test('nonsense is refused rather than guessed', () => {
    assert.equal(resolveCountry('zzz'), null);
    assert.equal(resolveCountry(''), null);
    assert.equal(resolveCountry(null), null);
  });

  test('names beginning with the query come before names containing it', () => {
    // Typing "in" should offer India before Argentina.
    const names = searchCountries('in').map((c) => c.name);
    assert.ok(names.indexOf('India') < names.indexOf('Argentina'), names.slice(0, 5).join(', '));
  });

  test('never returns more than the 25-choice limit', () => {
    assert.ok(searchCountries('a').length <= 25);
    assert.ok(searchCountries('').length <= 25);
  });

  test('renders a readable name for a stored code', () => {
    assert.equal(countryName('VN'), 'Vietnam');
    assert.equal(countryName('vn'), 'Vietnam');
  });
});

describe('autocomplete deadline', () => {
  // Discord discards an autocomplete reply after 3 seconds and shows "Loading
  // options failed". Slow work must degrade to something usable, not to that.
  const interaction = (sent) => ({ respond: async (choices) => sent.push(choices) });

  test('slow work loses to the fallback rather than the deadline', async () => {
    const sent = [];
    const never = new Promise(() => {});
    await respondInTime(interaction(sent), never, {
      budgetMs: 30,
      fallback: echoChoice('helldivers 2'),
    });
    assert.equal(sent.length, 1, 'must always answer');
    assert.equal(sent[0][0].value, 'helldivers 2');
  });

  test('work that finishes in time wins', async () => {
    const sent = [];
    const fast = Promise.resolve([{ name: 'Terraria', value: '105600' }]);
    await respondInTime(interaction(sent), fast, {
      budgetMs: 500,
      fallback: echoChoice('terr'),
    });
    assert.equal(sent[0][0].value, '105600');
  });

  test('a rejected lookup still answers', async () => {
    const sent = [];
    await respondInTime(interaction(sent), Promise.reject(new Error('Steam down')), {
      budgetMs: 500,
      fallback: echoChoice('portal'),
    });
    assert.equal(sent[0][0].value, 'portal');
  });

  test('the 25-choice cap is enforced', async () => {
    const sent = [];
    const many = Array.from({ length: 40 }, (_, i) => ({ name: `g${i}`, value: `${i}` }));
    await respondInTime(interaction(sent), Promise.resolve(many), { budgetMs: 500 });
    assert.equal(sent[0].length, 25);
  });

  test('a dead interaction token does not throw', async () => {
    // Past the deadline the token is gone and respond() rejects. That must not
    // surface as a command failure.
    const dead = { respond: async () => { throw new Error('Unknown interaction'); } };
    await assert.doesNotReject(() =>
      respondInTime(dead, Promise.resolve([]), { budgetMs: 20, fallback: echoChoice('x') }),
    );
  });
});

describe('when the region comparison appears', () => {
  // The rule is shared by /steam and /deals, and it is subtler than it looks:
  // on request always, unprompted only when the local store has no price.
  const fakeEmbed = () => ({
    fields: [],
    addFields(field) {
      this.fields.push(field);
      return this;
    },
  });

  test('stays quiet on an ordinary lookup', async () => {
    const embed = fakeEmbed();
    const added = await attachRegionalPrices(embed, {
      appId: 105600,
      country: 'US',
      hasLocalPrice: true,
      requested: false,
    });
    assert.equal(added, false);
    assert.deepEqual(embed.fields, [], 'should not have called Steam at all');
  });

  test('explains itself when asked about a game Steam does not list', async () => {
    const embed = fakeEmbed();
    await attachRegionalPrices(embed, {
      appId: null,
      country: 'US',
      hasLocalPrice: true,
      requested: true,
    });
    assert.equal(embed.fields.length, 1);
    assert.match(embed.fields[0].value, /not listed there/);
  });

  test('says nothing about a non-Steam game nobody asked about', async () => {
    // An ITAD-only result with a local price should not volunteer an
    // explanation for a comparison that was never requested.
    const embed = fakeEmbed();
    const added = await attachRegionalPrices(embed, {
      appId: null,
      country: 'US',
      hasLocalPrice: false,
      requested: false,
    });
    assert.equal(added, false);
    assert.deepEqual(embed.fields, []);
  });
});
