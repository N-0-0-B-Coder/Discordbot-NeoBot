import {
  AudioPlayerStatus,
  NoSubscriberBehavior,
  VoiceConnectionStatus,
  createAudioPlayer,
  createAudioResource,
  entersState,
  joinVoiceChannel,
  generateDependencyReport,
} from '@discordjs/voice';
import { config } from '../lib/config.js';
import { log } from '../lib/logger.js';
import { createTrackStream } from './source.js';
import { synthesize } from '../tts/engine.js';
import { getSetting, getTtsVoice } from '../db/guild-settings.js';

/** One session per guild, keyed by guild id. */
const sessions = new Map();

/**
 * Owns a guild's single voice connection and everything that plays through it.
 *
 * Discord allows exactly ONE voice connection per guild, so music and TTS have
 * to share. They cannot share one AudioPlayer, though: `play()` replaces the
 * current resource, so playing a TTS clip on the music player would destroy the
 * track and make "resume where it left off" impossible.
 *
 * So: two players, and the connection's subscription is switched between them.
 * Ducking a track becomes pause -> switch to TTS -> speak -> switch back ->
 * unpause, and the music resource survives untouched because a paused player
 * stops consuming its stream (back-pressure stalls yt-dlp, which resumes fine).
 */
export class GuildVoiceSession {
  constructor(guild) {
    this.guild = guild;
    this.queue = [];
    this.current = null;
    this.connection = null;
    this.subscription = null;
    this.textChannel = null;
    this.idleTimer = null;
    this.currentCleanup = null;
    this.destroyed = false;

    // --- TTS state ---
    this.ttsEnabled = false;
    // Voice channel whose built-in text chat is being read aloud.
    this.ttsChannelId = null;
    this.ttsQueue = [];
    // Resolved from guild settings when TTS is enabled, and updated live by
    // /tts-voice so a change takes effect on the very next line spoken.
    this.ttsVoice = null;
    this.speaking = false;
    this.ducked = false;
    this.ttsCleanup = null;
    // Latched so a systemic speech failure is announced once, not per line.
    this.ttsProblemReported = false;
    // Held as an instance property so tests can substitute a synthesiser
    // without a network round-trip to the Edge service.
    this.synthesize = synthesize;

    this.player = createAudioPlayer({
      behaviors: {
        // Keep decoding while nobody is listening rather than pausing forever;
        // Pause would leave the queue wedged if the last human blips out.
        noSubscriber: NoSubscriberBehavior.Play,
      },
    });

    this.ttsPlayer = createAudioPlayer({
      // TTS must never play to nobody — if it is not subscribed, it is because
      // music holds the connection, and the clip should wait.
      behaviors: { noSubscriber: NoSubscriberBehavior.Pause },
    });

    this.player.on(AudioPlayerStatus.Idle, () => {
      // While ducked the music player is paused, not idle, so an Idle here is
      // always a genuine end-of-track.
      this.releaseCurrentStream();
      this.playNext().catch((err) => log.error('playNext failed:', err));
    });

    this.player.on('error', (err) => {
      log.error(`Audio error on "${this.current?.title}":`, err);
      this.announce(`⚠️ Playback failed for **${this.current?.title}**, skipping.`);
      this.releaseCurrentStream();
      this.playNext().catch((nextErr) => log.error('playNext failed:', nextErr));
    });

    this.ttsPlayer.on(AudioPlayerStatus.Idle, () => {
      this.releaseTtsStream();
      this.drainSpeech().catch((err) => log.error('drainSpeech failed:', err));
    });

    this.ttsPlayer.on('error', (err) => {
      log.warn('TTS playback error:', err);
      this.releaseTtsStream();
      this.drainSpeech().catch((nextErr) => log.error('drainSpeech failed:', nextErr));
    });
  }

  /** Joins (or moves to) a voice channel and subscribes the music player. */
  async connect(voiceChannel) {
    if (this.connection && this.connection.joinConfig.channelId === voiceChannel.id) {
      return this.connection;
    }

    this.connection = joinVoiceChannel({
      channelId: voiceChannel.id,
      guildId: voiceChannel.guild.id,
      adapterCreator: voiceChannel.guild.voiceAdapterCreator,
      selfDeaf: true,
    });

    const tracer = traceVoice(this.connection);

    this.connection.on(VoiceConnectionStatus.Disconnected, async () => {
      // A disconnect is ambiguous: it can be a region change (recoverable) or a
      // real kick/leave. Race the two states to tell them apart.
      try {
        await Promise.race([
          entersState(this.connection, VoiceConnectionStatus.Signalling, 5_000),
          entersState(this.connection, VoiceConnectionStatus.Connecting, 5_000),
        ]);
      } catch {
        this.destroy();
      }
    });

    this.subscribeTo(this.player);

    try {
      await entersState(this.connection, VoiceConnectionStatus.Ready, 20_000);
    } catch (err) {
      // "Never became Ready" is the single least informative voice failure, and
      // the state it got stuck in says which half broke. Signalling means
      // Discord never answered the join; Connecting means it answered but the
      // UDP handshake did not complete — the usual shape of a host that blocks
      // or NATs outbound UDP.
      const state = this.connection?.state?.status ?? 'destroyed';

      // Reaching Ready needs TWO gateway events: VOICE_STATE_UPDATE (our own
      // state, carrying session_id) and VOICE_SERVER_UPDATE (endpoint + token).
      // Whether our own voice state landed splits the remaining causes cleanly,
      // so record it rather than listing possibilities.
      const ownVoiceChannel = this.guild.members?.me?.voice?.channelId ?? null;
      const joined = ownVoiceChannel === voiceChannel.id;

      log.error(
        `[${this.guild.id}] Voice connection stalled in "${state}" after 20s ` +
          `(channel ${voiceChannel.id}). Own voice state: ` +
          `${joined ? 'PRESENT in the channel' : `absent (channelId=${ownVoiceChannel})`}.`,
      );
      log.error(`[${this.guild.id}] Path: ${tracer.path() || '(none recorded)'}`);
      log.error(voiceDiagnosis(state, joined, tracer));
      // The status alone is misleading (the handshake rewinds on retry), so
      // carry the phase too — that is what the user-facing message keys on.
      throw new VoiceConnectError(state, {
        cause: err,
        phase: tracer.phase,
        closeCode: tracer.closeCodes[0] ?? null,
      });
    }

    return this.connection;
  }

  /** Points the connection at one player, replacing any existing subscription. */
  subscribeTo(player) {
    if (!this.connection) return;
    this.subscription?.unsubscribe();
    this.subscription = this.connection.subscribe(player) ?? null;
  }

  get voiceChannelId() {
    return this.connection?.joinConfig.channelId ?? null;
  }

  // ---------------------------------------------------------------- music ---

  enqueue(tracks) {
    const room = config.music.maxQueueLength - this.queue.length;
    const accepted = tracks.slice(0, Math.max(room, 0));
    this.queue.push(...accepted);
    return { accepted: accepted.length, rejected: tracks.length - accepted.length };
  }

  get isPlaying() {
    return (
      this.player.state.status === AudioPlayerStatus.Playing ||
      this.player.state.status === AudioPlayerStatus.Paused ||
      this.player.state.status === AudioPlayerStatus.Buffering
    );
  }

  /** Starts the next track, or arms the idle timeout when the queue runs dry. */
  async playNext() {
    if (this.destroyed) return null;

    const next = this.queue.shift();
    if (!next) {
      this.current = null;
      this.armIdleTimeout();
      return null;
    }

    this.clearIdleTimeout();
    this.current = next;

    const { stream, inputType, cleanup } = createTrackStream(next);
    this.currentCleanup = cleanup;

    const resource = createAudioResource(stream, { inputType, inlineVolume: false });
    this.player.play(resource);

    // A track starting while TTS holds the connection must not steal it back —
    // the duck logic restores music when speech finishes.
    if (this.speaking) {
      this.player.pause(true);
      this.ducked = true;
    }

    log.info(`[${this.guild.id}] Now playing: ${next.title}`);
    return next;
  }

  skip() {
    const skipped = this.current;
    // Stopping fires Idle, which advances the queue through playNext().
    this.player.stop(true);
    return skipped;
  }

  pause() {
    return this.player.pause(true);
  }

  resume() {
    return this.player.unpause();
  }

  stop() {
    this.queue = [];
    this.current = null;
    this.ducked = false;
    this.player.stop(true);
    this.releaseCurrentStream();
  }

  releaseCurrentStream() {
    this.currentCleanup?.();
    this.currentCleanup = null;
  }

  // ------------------------------------------------------------------ tts ---

  /** Queues a line to be spoken. Safe to call rapidly. */
  async speak(text) {
    if (this.destroyed || !this.ttsEnabled) return;

    if (this.ttsQueue.length >= getSetting(this.guild.id, 'ttsMaxQueueLength')) {
      // Drop the oldest rather than the newest: in conversation the most recent
      // line is the one still worth hearing.
      this.ttsQueue.shift();
      log.debug(`[${this.guild.id}] TTS queue full, dropped the oldest line.`);
    }
    this.ttsQueue.push(text);
    this.clearIdleTimeout();

    if (!this.speaking) await this.drainSpeech();
  }

  /** Plays the next queued line, or hands the connection back to music. */
  async drainSpeech() {
    if (this.destroyed) return;

    const text = this.ttsQueue.shift();
    if (!text) {
      this.finishSpeaking();
      return;
    }

    // Duck music on the first line of a burst.
    if (!this.speaking) {
      this.speaking = true;
      if (this.player.state.status === AudioPlayerStatus.Playing) {
        this.player.pause(true);
        this.ducked = true;
      }
      this.subscribeTo(this.ttsPlayer);
    }

    try {
      const voice = this.ttsVoice ?? getTtsVoice(this.guild.id);
      const { stream, inputType, cleanup } = await this.synthesize(text, voice, {
        onProblem: (summary) => this.reportTtsProblem(summary),
      });
      this.ttsCleanup = cleanup;
      this.ttsPlayer.play(createAudioResource(stream, { inputType }));
    } catch (err) {
      log.warn(`[${this.guild.id}] TTS synthesis failed:`, err);
      // Skip this line and keep the queue moving rather than wedging.
      await this.drainSpeech();
    }
  }

  /**
   * Says out loud that speech failed, once per session.
   *
   * A failed synthesis is otherwise INVISIBLE: the line is skipped, the queue
   * moves on, and everyone sits watching a bot that joined the channel and says
   * nothing. Silence is the one outcome a voice feature must never produce
   * without explanation. Once per session, because the cause is almost always
   * systemic — a message per dropped line would be worse than the silence.
   */
  reportTtsProblem(summary) {
    if (this.ttsProblemReported) return;
    this.ttsProblemReported = true;
    log.warn(`[${this.guild.id}] Speech is failing: ${summary}`);
    this.announce(
      `I cannot speak right now — the text-to-speech service is not returning ` +
        `audio (${summary}). I will keep listening in case it recovers; the ` +
        `server log has the details.`,
    );
  }

  /** Restores music once the speech queue empties. */
  finishSpeaking() {
    this.speaking = false;
    this.releaseTtsStream();
    this.subscribeTo(this.player);
    if (this.ducked) {
      this.player.unpause();
      this.ducked = false;
    }
    if (!this.isPlaying && this.ttsQueue.length === 0) this.armIdleTimeout();
  }

  releaseTtsStream() {
    this.ttsCleanup?.();
    this.ttsCleanup = null;
  }

  enableTts(voiceChannelId) {
    this.ttsEnabled = true;
    this.ttsChannelId = voiceChannelId;
    this.ttsVoice = getTtsVoice(this.guild.id);
    this.clearIdleTimeout();
  }

  disableTts() {
    this.ttsEnabled = false;
    this.ttsChannelId = null;
    this.ttsQueue = [];
    this.ttsPlayer.stop(true);
    this.releaseTtsStream();
  }

  // -------------------------------------------------------------- lifecycle --

  armIdleTimeout() {
    this.clearIdleTimeout();
    // TTS mode means the bot is meant to sit there waiting for someone to type,
    // so an idle timeout would defeat the feature. Auto-leave when the channel
    // empties (voiceStateUpdate) still applies.
    if (this.ttsEnabled) return;

    this.idleTimer = setTimeout(() => {
      this.announce('👋 Nothing left in the queue — leaving the voice channel.');
      this.destroy();
    }, config.music.idleTimeoutMs);
    this.idleTimer.unref();
  }

  clearIdleTimeout() {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = null;
  }

  announce(content) {
    this.textChannel?.send({ content }).catch(() => {
      // The bot may have lost access to the channel; nothing useful to do.
    });
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    this.clearIdleTimeout();
    this.queue = [];
    this.ttsQueue = [];
    this.current = null;
    this.ttsEnabled = false;
    this.ttsChannelId = null;
    this.releaseCurrentStream();
    this.releaseTtsStream();
    this.player.stop(true);
    this.ttsPlayer.stop(true);
    try {
      this.subscription?.unsubscribe();
      if (this.connection?.state.status !== VoiceConnectionStatus.Destroyed) {
        this.connection?.destroy();
      }
    } catch (err) {
      log.warn('Failed to destroy voice connection:', err);
    }
    this.subscription = null;
    this.connection = null;
    sessions.delete(this.guild.id);
  }
}

/** Thrown when a voice connection never reaches Ready, carrying the stuck state. */
export class VoiceConnectError extends Error {
  constructor(state, { phase = null, closeCode = null, ...options } = {}) {
    super(`Voice connection stalled in "${state}"`, options);
    this.name = 'VoiceConnectError';
    this.state = state;
    /** Deepest `@discordjs/voice` Networking phase reached, or null. */
    this.phase = phase;
    /** First voice websocket close code seen, or null. */
    this.closeCode = closeCode;
  }
}

/**
 * Maps the stuck connection state onto its likely cause.
 *
 * Voice is the one feature that can be perfectly configured on Discord's side
 * and still fail because of the network the bot runs on, so the log has to
 * tell those cases apart — otherwise every report looks identical and points
 * nowhere.
 */
function voiceDiagnosis(state, joined, tracer) {
  const report = generateDependencyReport();
  const { phase, closeCodes } = tracer;

  // The connection-level status is too coarse to diagnose anything: a failure
  // anywhere inside the voice handshake sends it back to Signalling, so all
  // four very different causes below end up looking identical. The networking
  // phase reached, plus the websocket close code, is what actually separates
  // them — see the PHASES table.
  if (phase !== null) {
    const closing = closeCodes.length
      ? `The voice websocket closed with code ${closeCodes.join(', then ')} (${describeCloseCode(closeCodes[0])}).`
      : 'The voice websocket never closed — it simply stopped progressing.';

    return [
      `Deepest phase reached: ${PHASES[phase]}. ${closing}`,
      '',
      ...phaseAdvice(phase, closeCodes[0]),
      report,
    ].join('\n');
  }

  if (state === VoiceConnectionStatus.Signalling) {
    // Split on whether our own voice state arrived. If the bot is visibly IN
    // the channel then Discord accepted the join and broadcast the state, so
    // the intent and the Connect permission are both demonstrably fine and the
    // only missing piece is VOICE_SERVER_UPDATE.
    const lines = joined
      ? [
          'Never left "signalling", and the bot IS in the channel — so Discord',
          'accepted the join and VOICE_STATE_UPDATE arrived, but',
          'VOICE_SERVER_UPDATE genuinely never did. The GuildVoiceStates intent',
          'and the Connect permission are therefore both fine.',
          '',
          'What is left, in order of likelihood:',
          '  1. A SECOND instance connected on the same token. Discord sends',
          '     the voice server reply to one session and the other waits.',
          '     Check for a local `npm start`, a second Railway service, or an',
          '     older deployment still running.',
          '  2. Outbound traffic to Discord voice endpoints is blocked so early',
          '     that the library never advances. Test by running the bot on a',
          '     different network.',
          '  3. A Discord voice-region incident — rare, clears on its own.',
          '     https://discordstatus.com',
        ]
      : [
          'Stuck at "signalling" and the bot never appeared in the channel, so',
          'Discord ignored the join entirely. Check that the bot can SEE the',
          'channel (View Channel) as well as Connect, that the channel is not',
          'full, and that the GuildVoiceStates intent is requested.',
        ];
    return [...lines, report].join('\n');
  }

  return report;
}

/**
 * The phases inside `@discordjs/voice`'s Networking state machine, in order.
 * The index IS the library's status code, so `PHASES[code]` names it.
 */
const PHASES = [
  'opening the voice websocket',
  'identifying (websocket open, credentials sent)',
  'UDP handshake (IP discovery)',
  'selecting the protocol/encryption mode',
  'ready',
  'resuming',
  'closed',
];

/**
 * Watches a connection and records how far the voice handshake actually got.
 *
 * `VoiceConnection` exposes only four coarse statuses, and it RETRIES: any
 * failure inside the handshake rewinds it to Signalling, so the state at
 * timeout describes the retry rather than the fault. The Networking instance
 * underneath has the detail — which phase it reached, and the websocket close
 * code — so this listens there and keeps the high-water mark.
 */
function traceVoice(connection) {
  const path = [connection.state.status];
  const closeCodes = [];
  let phase = null;
  let watched = null;

  const push = (entry) => {
    if (path[path.length - 1] !== entry) path.push(entry);
  };

  connection.on('stateChange', (previous, next) => {
    const networking = next.networking ?? null;

    if (networking && networking !== watched) {
      watched = networking;
      networking.on('close', (code) => closeCodes.push(code ?? '(none)'));
      networking.on('error', (err) => push(`ws-error(${err?.message ?? err})`));
    }

    const code = networking?.state?.code;
    if (typeof code === 'number') {
      // 5 (resuming) and 6 (closed) are outcomes, not progress.
      if (code < 5 && (phase === null || code > phase)) phase = code;
      push(`${next.status}:${PHASES[code] ?? code}`);
    } else {
      push(next.status);
    }
  });

  return { closeCodes, path: () => path.join(' -> '), get phase() { return phase; } };
}

/** Voice websocket close codes, from Discord's voice gateway documentation. */
const CLOSE_CODES = {
  4001: 'unknown opcode',
  4002: 'failed to decode payload',
  4003: 'not authenticated',
  4004: 'authentication failed — the voice token was rejected',
  4005: 'already authenticated',
  4006: 'session is no longer valid',
  4009: 'session timed out',
  4011: 'server not found',
  4012: 'unknown protocol',
  4014: 'disconnected — channel deleted, kicked, or moved',
  4015: 'the voice server crashed',
  4016: 'unknown encryption mode',
  4017: 'this channel requires end-to-end encryption via the DAVE protocol',
  1006: 'the connection dropped without a close frame',
};

const describeCloseCode = (code) => CLOSE_CODES[code] ?? 'unrecognised close code';

/** What to check, given how far the handshake got and how it ended. */
function phaseAdvice(phase, closeCode) {
  if (phase >= 2) {
    return [
      'Discord answered and the credentials were accepted — so the gateway,',
      'the intents and the permissions are all fine. What failed is the UDP',
      'half: voice sends IP-discovery packets to a high port and waits for a',
      'reply. A host that blocks or does not route outbound UDP stops exactly',
      'here, while every text command keeps working.',
      '',
      'Confirm by running the bot on a different network. A VPS, Fly.io and',
      'Oracle Cloud all route UDP.',
    ];
  }

  if (phase === 1 && closeCode === 4017) {
    return [
      'Discord closed the session with 4017: the channel requires end-to-end',
      'encryption via the DAVE protocol, which this build cannot speak. Since',
      'the March 2026 enforcement every non-stage voice channel demands it, so',
      'the bot identifies with max_dave_protocol_version: 0 and is refused.',
      '',
      'Nothing about the network, the host, the intents or the permissions is',
      'involved. Fix it in one place:',
      '  @discordjs/voice must be >= 0.19, which depends on @snazzah/davey.',
      '  Earlier versions have no DAVE support at all — check the report below',
      '  for a "DAVE Libraries" section; if it is missing, that is the cause.',
    ];
  }

  if (phase === 1) {
    return [
      'The voice websocket OPENED and the credentials were sent, then Discord',
      'closed it. The network is therefore fine — this is a session problem,',
      'not an egress one.',
      '',
      closeCode === 4006 || closeCode === 4009
        ? [
            'Codes 4006/4009 mean the session Discord was told about is not the',
            'one identifying. In order of likelihood:',
            '  1. A SECOND instance on the same token — the other session owns',
            '     the voice state. Check for a local `npm start`, a second',
            '     deployment, or an older container still running.',
            '  2. The gateway reconnected between the join and the handshake,',
            '     so session_id went stale. Retrying the command usually works.',
          ].join('\n')
        : closeCode === 4004
          ? [
              'Code 4004 means the voice token itself was refused, which points',
              'at a stale VOICE_SERVER_UPDATE. Retry; if it persists, restart',
              'the bot so the gateway session is rebuilt.',
            ].join('\n')
          : 'Retry once, then check https://discordstatus.com for a voice incident.',
    ];
  }

  return [
    'The voice websocket never finished opening, so the bot could not reach',
    'the voice endpoint at all. That is DNS or outbound TCP/443 to a',
    '*.discord.media host — a firewall or proxy, not Discord.',
  ];
}

export function getPlayer(guild) {
  let session = sessions.get(guild.id);
  if (!session) {
    session = new GuildVoiceSession(guild);
    sessions.set(guild.id, session);
  }
  return session;
}

export function peekPlayer(guildId) {
  return sessions.get(guildId) ?? null;
}

export function destroyAllPlayers() {
  for (const session of [...sessions.values()]) session.destroy();
}
