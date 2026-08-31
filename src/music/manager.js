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
      log.error(
        `[${this.guild.id}] Voice connection stalled in "${state}" after 20s ` +
          `(channel ${voiceChannel.id}).`,
      );
      log.error(voiceDiagnosis(state));
      throw new VoiceConnectError(state, { cause: err });
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
      const { stream, inputType, cleanup } = await this.synthesize(text, voice);
      this.ttsCleanup = cleanup;
      this.ttsPlayer.play(createAudioResource(stream, { inputType }));
    } catch (err) {
      log.warn(`[${this.guild.id}] TTS synthesis failed:`, err);
      // Skip this line and keep the queue moving rather than wedging.
      await this.drainSpeech();
    }
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
  constructor(state, options) {
    super(`Voice connection stalled in "${state}"`, options);
    this.name = 'VoiceConnectError';
    this.state = state;
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
function voiceDiagnosis(state) {
  const report = generateDependencyReport();

  if (state === VoiceConnectionStatus.Signalling) {
    return [
      'Stuck at "signalling": the join was sent but Discord never replied with',
      'a voice server. That usually means the gateway is not delivering',
      'VOICE_SERVER_UPDATE / VOICE_STATE_UPDATE (check the GuildVoiceStates',
      'intent), or the bot lacks Connect on the channel.',
      report,
    ].join('\n');
  }

  if (state === VoiceConnectionStatus.Connecting) {
    return [
      'Stuck at "connecting": Discord answered, but the UDP handshake never',
      'completed. Voice needs OUTBOUND UDP to arbitrary high ports, which some',
      'hosting platforms block or NAT. This is the classic shape of a bot that',
      'works locally and fails once deployed.',
      report,
    ].join('\n');
  }

  return report;
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
