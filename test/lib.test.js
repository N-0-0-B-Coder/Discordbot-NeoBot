import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { parseDuration, formatDurationMs } from '../src/lib/duration.js';
import { consume, release } from '../src/lib/cooldowns.js';
import { truncate, formatDuration } from '../src/lib/embeds.js';
import { paint, green, red, highlight } from '../src/lib/colors.js';
import { log } from '../src/lib/logger.js';
import { describeVoiceFailure } from '../src/music/diagnose.js';
import { describeOptions } from '../src/lib/activity.js';

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

describe('colours', () => {
  test('always returns the text, styled or not', () => {
    // Output is stripped when stdout is not a TTY (CI, piped logs, Railway),
    // so the only invariant worth asserting is that the text survives.
    for (const style of [green, red, highlight]) {
      assert.ok(style('hello').includes('hello'));
    }
  });

  test('an unknown style never throws', () => {
    // Colour is decoration; it must not be the thing that breaks a log call.
    assert.doesNotThrow(() => paint('not-a-real-colour', 'hello'));
    assert.ok(paint('not-a-real-colour', 'hello').includes('hello'));
  });

  test('non-string input is coerced', () => {
    assert.ok(paint('green', 42).includes('42'));
  });
});

describe('logger', () => {
  test('exposes every level including success', () => {
    for (const level of ['error', 'warn', 'info', 'success', 'debug']) {
      assert.equal(typeof log[level], 'function', `log.${level} missing`);
    }
  });

  test('logging does not throw at any level', () => {
    assert.doesNotThrow(() => {
      log.debug('debug line');
      log.success('success line');
    });
  });
});

describe('describeVoiceFailure', () => {
  // The connection status rewinds to "signalling" on every retry, so keying the
  // message on it alone blamed a second bot instance for a failure that had
  // demonstrably got past signalling. The phase is the honest signal.
  test('a UDP-phase failure is not blamed on a second instance', () => {
    const message = describeVoiceFailure({ state: 'signalling', phase: 2 }, 'voice');
    assert.ok(message.includes('UDP'));
    assert.ok(!message.includes('second copy'));
  });

  test('a rejected session names the close code', () => {
    const message = describeVoiceFailure(
      { state: 'signalling', phase: 1, closeCode: 4006 },
      'voice',
    );
    assert.ok(message.includes('4006'));
  });

  test('4017 names the real cause instead of blaming a second instance', () => {
    // The failure that started all this: DAVE was not supported, but the
    // message told users a second bot was running on the same token.
    const message = describeVoiceFailure(
      { state: 'signalling', phase: 1, closeCode: 4017 },
      'voice',
    );
    assert.ok(message.includes('end-to-end encryption'));
    assert.ok(!message.includes('second copy'));
  });

  test('falls back to the status when no phase was recorded', () => {
    const message = describeVoiceFailure({ state: 'signalling' }, 'voice');
    assert.ok(message.includes('voice server'));
  });
});

describe('describeOptions', () => {
  test('renders arguments compactly', () => {
    const line = describeOptions({
      options: { data: [{ name: 'voice', value: 'vi-VN-HoaiMyNeural' }] },
    });
    assert.equal(line, 'voice: vi-VN-HoaiMyNeural');
  });

  test('never writes a key-shaped value to the log', () => {
    const line = describeOptions({
      options: { data: [{ name: 'api_key', value: 'super-secret-value' }] },
    });
    assert.ok(!line.includes('super-secret-value'));
    assert.ok(line.includes('hidden'));
  });

  test('flattens subcommand options', () => {
    const line = describeOptions({
      options: { data: [{ name: 'set', options: [{ name: 'country', value: 'VN' }] }] },
    });
    assert.equal(line, 'set country: VN');
  });

  test('an interaction with no options renders nothing', () => {
    assert.equal(describeOptions({}), '');
  });
});
