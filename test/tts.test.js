import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { AudioPlayerStatus, StreamType } from '@discordjs/voice';
import { toSpeakableText } from '../src/tts/sanitize.js';
import { searchVoices, validateVoice, describeVoice, getVoices } from '../src/tts/voices.js';
import { GuildVoiceSession } from '../src/music/manager.js';

const message = (content, extra = {}) => ({
  content,
  attachments: { size: 0 },
  guild: {
    members: { cache: new Map([['1', { displayName: 'Nghia' }]]) },
    roles: { cache: new Map([['2', { name: 'admins' }]]) },
    channels: { cache: new Map([['3', { name: 'general' }]]) },
  },
  ...extra,
});

describe('toSpeakableText', () => {
  test('collapses URLs — nobody wants a URL read character by character', () => {
    assert.equal(toSpeakableText(message('see https://a.com/x?y=1 ok'), 300), 'see link ok');
  });
  test('resolves mentions to display names', () => {
    assert.equal(toSpeakableText(message('hi <@1>'), 300), 'hi Nghia');
    assert.equal(toSpeakableText(message('yo <@&2>'), 300), 'yo admins');
    assert.equal(toSpeakableText(message('in <#3>'), 300), 'in general');
  });
  test('falls back for unresolvable mentions', () => {
    assert.equal(toSpeakableText(message('hi <@999>'), 300), 'hi someone');
  });
  test('handles emoji, code and markdown', () => {
    assert.equal(toSpeakableText(message('nice <:kekw:123>'), 300), 'nice kekw');
    assert.equal(toSpeakableText(message('run ```js\nx=1\n```'), 300), 'run code block');
    assert.equal(toSpeakableText(message('use `npm start`'), 300), 'use npm start');
    assert.equal(toSpeakableText(message('**bold** _it_'), 300), 'bold it');
  });
  test('tames repeated punctuation', () => {
    assert.equal(toSpeakableText(message('what????'), 300), 'what?');
  });
  test('describes attachment-only messages', () => {
    assert.equal(toSpeakableText(message('', { attachments: { size: 1 } }), 300), 'sent an attachment');
    assert.equal(toSpeakableText(message('', { attachments: { size: 3 } }), 300), 'sent 3 attachments');
  });
  test('returns empty for nothing worth speaking', () => {
    assert.equal(toSpeakableText(message('   '), 300), '');
  });
  test('truncates over the limit', () => {
    assert.match(toSpeakableText(message('a'.repeat(500)), 10), /message truncated$/);
  });
});

describe('voice catalogue', () => {
  test('has a usable offline fallback', () => {
    assert.ok(getVoices().length > 20);
    assert.ok(getVoices().some((v) => v.shortName === 'vi-VN-HoaiMyNeural'));
  });
  test('searches across name and language', () => {
    assert.deepEqual(searchVoices('viet').map((v) => v.shortName),
      ['vi-VN-HoaiMyNeural', 'vi-VN-NamMinhNeural']);
  });
  test('respects Discord 25-choice cap', () => {
    assert.ok(searchVoices('').length <= 25);
  });
  test('labels fit the 100-char choice limit', () => {
    for (const v of getVoices()) assert.ok(describeVoice(v).length <= 100);
  });
  test('accepts a known voice case-insensitively', () => {
    assert.equal(validateVoice('en-us-guyneural').voice, 'en-US-GuyNeural');
  });
  test('accepts a plausible unlisted voice while offline, flagged uncertain', () => {
    const result = validateVoice('pt-BR-FranciscaNeural');
    assert.equal(result.ok, true);
    assert.equal(result.certain, false);
  });
  test('rejects nonsense', () => {
    assert.equal(validateVoice('not a voice').ok, false);
    assert.equal(validateVoice('').ok, false);
  });
});

describe('music/TTS ducking', () => {
  /** A session wired to fakes so nothing touches Discord or the network. */
  function makeSession() {
    const session = new GuildVoiceSession({ id: 'g-duck' });
    const state = { subscribed: null, played: [], musicPaused: false };
    session.connection = {
      joinConfig: { channelId: 'vc1' },
      state: { status: 'ready' },
      subscribe(player) {
        state.subscribed = player === session.player ? 'music' : 'tts';
        return { unsubscribe() {} };
      },
      destroy() {},
    };
    session.subscribeTo(session.player);
    session.enableTts('vc1');
    session.synthesize = async () => ({
      stream: Readable.from([Buffer.alloc(0)]),
      inputType: StreamType.Arbitrary,
      cleanup: () => {},
    });
    session.ttsPlayer.play = () => state.played.push('tts');
    session.player.pause = () => { state.musicPaused = true; return true; };
    session.player.unpause = () => { state.musicPaused = false; return true; };
    // A getter-only stub would break destroy(), which lets the real
    // AudioPlayer assign to .state — so keep it writable.
    let musicState = { status: AudioPlayerStatus.Playing };
    Object.defineProperty(session.player, 'state', {
      get: () => musicState,
      set: (next) => { musicState = next; },
      configurable: true,
    });
    return { session, state };
  }

  test('ducks music, speaks, then restores it', async () => {
    const { session, state } = makeSession();
    assert.equal(state.subscribed, 'music');

    await session.speak('hello');
    assert.equal(state.musicPaused, true, 'music should pause');
    assert.equal(state.subscribed, 'tts', 'connection should switch to TTS');
    assert.equal(session.speaking, true);
    assert.equal(state.played.length, 1);

    await session.drainSpeech(); // queue empty -> finish
    assert.equal(state.musicPaused, false, 'music should resume');
    assert.equal(state.subscribed, 'music', 'connection should return to music');
    assert.equal(session.speaking, false);
  });

  test('queues lines that arrive mid-speech instead of overlapping', async () => {
    const { session, state } = makeSession();
    await session.speak('one');
    await session.speak('two');
    await session.speak('three');
    assert.equal(state.played.length, 1, 'only the first should be playing');
    assert.equal(session.ttsQueue.length, 2);

    await session.drainSpeech();
    await session.drainSpeech();
    assert.equal(state.played.length, 3);
  });

  test('drops the oldest line when the queue is full', async () => {
    const { session } = makeSession();
    session.speaking = true; // hold the drain so the queue builds
    for (let i = 0; i < 9; i++) await session.speak(`m${i}`);
    assert.equal(session.ttsQueue.length, 5, 'capped at the configured maximum');
    assert.equal(session.ttsQueue.at(-1), 'm8', 'newest kept');
    assert.equal(session.ttsQueue[0], 'm4', 'oldest dropped');
  });

  test('a destroyed session stops speaking', async () => {
    const { session, state } = makeSession();
    session.destroy();
    await session.speak('should be ignored');
    assert.equal(state.played.length, 0);
  });
});
