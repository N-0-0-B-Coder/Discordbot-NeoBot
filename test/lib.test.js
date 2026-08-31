import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { parseDuration, formatDurationMs } from '../src/lib/duration.js';
import { consume, release } from '../src/lib/cooldowns.js';
import { truncate, formatDuration } from '../src/lib/embeds.js';

describe('parseDuration', () => {
  test('parses single units', () => {
    assert.equal(parseDuration('10m'), 600_000);
    assert.equal(parseDuration('2h'), 7_200_000);
    assert.equal(parseDuration('2d'), 172_800_000);
    assert.equal(parseDuration('30s'), 30_000);
  });
  test('parses compound durations', () => {
    assert.equal(parseDuration('1h30m'), 5_400_000);
    assert.equal(parseDuration('1d2h'), 93_600_000);
  });
  test('rejects junk', () => {
    assert.equal(parseDuration('banana'), null);
    assert.equal(parseDuration(''), null);
    assert.equal(parseDuration(null), null);
  });
});

describe('formatDurationMs', () => {
  test('renders compactly', () => {
    assert.equal(formatDurationMs(5_400_000), '1h 30m');
    assert.equal(formatDurationMs(0), '0s');
  });
});

describe('formatDuration (seconds -> clock)', () => {
  test('m:ss under an hour', () => assert.equal(formatDuration(125), '2:05'));
  test('h:mm:ss past an hour', () => assert.equal(formatDuration(3725), '1:02:05'));
  test('zero means live', () => assert.equal(formatDuration(0), 'live'));
});

describe('truncate', () => {
  test('leaves short text alone', () => assert.equal(truncate('hi', 10), 'hi'));
  test('adds an ellipsis when cutting', () => {
    const out = truncate('a'.repeat(50), 10);
    assert.equal(out.length, 10);
    assert.ok(out.endsWith('…'));
  });
});

describe('cooldowns', () => {
  test('first call passes, second is blocked', () => {
    assert.equal(consume('c1', 'u1', 1000), 0);
    assert.ok(consume('c1', 'u1', 1000) > 0);
  });
  test('cooldowns are per user', () => {
    consume('c2', 'u1', 1000);
    assert.equal(consume('c2', 'u2', 1000), 0);
  });
  test('cooldowns are per command', () => {
    consume('c3', 'u1', 1000);
    assert.equal(consume('c4', 'u1', 1000), 0);
  });
  test('release refunds', () => {
    consume('c5', 'u1', 1000);
    release('c5', 'u1');
    assert.equal(consume('c5', 'u1', 1000), 0);
  });
  test('zero or missing cooldown never blocks', () => {
    assert.equal(consume('c6', 'u1', 0), 0);
    assert.equal(consume('c6', 'u1', undefined), 0);
  });
});
