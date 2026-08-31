/**
 * Text-to-speech synthesis via Microsoft Edge's read-aloud service.
 *
 * This is a different thing from Discord's native TTS that `/say` uses. Native
 * TTS is client-side: Discord's app reads the message aloud on each listener's
 * own machine, only for people who enabled it in their settings, and never into
 * a voice channel. To have the bot *speak in voice*, it has to produce actual
 * audio and stream it — which is what this does.
 *
 * No API key and no signup, but the same class of grey area as yt-dlp: it is an
 * unofficial use of an endpoint Edge uses for its own read-aloud feature. If TTS
 * suddenly stops working everywhere, this is the first thing to suspect, and
 * `npm update msedge-tts` is the first thing to try.
 */
import { spawn } from 'node:child_process';
import ffmpegPath from 'ffmpeg-static';
import { MsEdgeTTS, OUTPUT_FORMAT } from 'msedge-tts';
import { StreamType } from '@discordjs/voice';
import { config } from '../lib/config.js';
import { log } from '../lib/logger.js';

/**
 * Synthesises `text` and returns a Discord-ready Ogg/Opus stream.
 *
 * The service also offers a webm/opus output that looks like it would let us
 * skip ffmpeg entirely — but it is 24 kHz, and Discord's voice gateway expects
 * 48 kHz Opus packets, so those would play back distorted. Taking MP3 and
 * resampling through ffmpeg is the same path the music player uses and is known
 * to be correct.
 *
 * Returns { stream, inputType, cleanup }.
 */
export async function synthesize(text, voice = config.tts.voice) {
  const tts = new MsEdgeTTS();
  // Opens a WebSocket to the service. Done per utterance rather than pooled:
  // a stale socket is a far more annoying failure than a ~200ms handshake.
  await tts.setMetadata(voice, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3);

  const { audioStream } = tts.toStream(text);

  const ffmpegProcess = spawn(
    ffmpegPath,
    [
      '-hide_banner',
      '-loglevel', 'error',
      '-i', 'pipe:0',
      '-vn',
      '-ar', '48000',
      '-ac', '2',
      '-c:a', 'libopus',
      '-b:a', '96k',
      '-f', 'ogg',
      'pipe:1',
    ],
    { stdio: ['pipe', 'pipe', 'pipe'] },
  );

  audioStream.pipe(ffmpegProcess.stdin);

  const cleanup = () => {
    audioStream.unpipe?.(ffmpegProcess.stdin);
    audioStream.destroy?.();
    if (ffmpegProcess.exitCode === null && ffmpegProcess.signalCode === null) {
      ffmpegProcess.kill('SIGKILL');
    }
    try {
      tts.close();
    } catch {
      // Already closed, or never opened. Nothing useful to do.
    }
  };

  // EPIPE is expected when a clip is cut short — tearing down one end closes
  // the pipe the other was writing into.
  const ignoreEpipe = (err) => {
    if (err?.code !== 'EPIPE') log.warn('TTS stream error:', err);
  };
  audioStream.on('error', ignoreEpipe);
  ffmpegProcess.stdin.on('error', ignoreEpipe);
  ffmpegProcess.stderr.on('data', (chunk) => {
    log.debug(`ffmpeg (tts): ${String(chunk).trim()}`);
  });

  return { stream: ffmpegProcess.stdout, inputType: StreamType.OggOpus, cleanup };
}

/** Lists available voices, for `/tts-voice` autocomplete. */
export async function listVoices() {
  const tts = new MsEdgeTTS();
  try {
    return await tts.getVoices();
  } finally {
    try {
      tts.close();
    } catch {
      // getVoices uses plain HTTP, so there may be no socket to close.
    }
  }
}
