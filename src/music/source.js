/**
 * Track resolution and audio streaming, backed by yt-dlp.
 *
 * The yt-dlp and ffmpeg binaries come from npm (`youtube-dl-exec` downloads
 * yt-dlp on install, `ffmpeg-static` ships a static build), so no system
 * packages are needed on the host.
 *
 * Heads-up, deliberately written down: pulling audio out of YouTube this way is
 * against YouTube's Terms of Service, and extraction breaks whenever YouTube
 * changes its player — expect to run `npx youtube-dl-exec-update` (or bump the
 * package) every few months when playback suddenly starts failing.
 */
import { spawn } from 'node:child_process';
import { StreamType } from '@discordjs/voice';
import ffmpegPath from 'ffmpeg-static';
import youtubedl from 'youtube-dl-exec';
import { log } from '../lib/logger.js';
import { config } from '../lib/config.js';

const URL_PATTERN = /^https?:\/\//i;
const PLAYLIST_PATTERN = /[?&]list=/i;

/** Shared yt-dlp flags: quiet, no colour, no interactive prompts. */
const BASE_FLAGS = {
  noWarnings: true,
  noCallHome: true,
  noCheckCertificates: true,
  preferFreeFormats: true,
  youtubeSkipDashManifest: true,
};

/**
 * Resolves a user query into one or more tracks.
 * Accepts a search phrase, a video URL, or a playlist URL.
 */
export async function resolveQuery(query, requestedBy) {
  const trimmed = query.trim();

  if (URL_PATTERN.test(trimmed) && PLAYLIST_PATTERN.test(trimmed)) {
    return resolvePlaylist(trimmed, requestedBy);
  }

  const target = URL_PATTERN.test(trimmed) ? trimmed : `ytsearch1:${trimmed}`;
  const info = await youtubedl(target, {
    ...BASE_FLAGS,
    dumpSingleJson: true,
    noPlaylist: true,
  });

  // A ytsearch: target comes back as a playlist with one entry.
  const entry = Array.isArray(info?.entries) ? info.entries[0] : info;
  if (!entry) return [];
  return [toTrack(entry, requestedBy)].filter(Boolean);
}

async function resolvePlaylist(url, requestedBy) {
  const info = await youtubedl(url, {
    ...BASE_FLAGS,
    dumpSingleJson: true,
    // Flat extraction avoids a network round-trip per video: a 50-track
    // playlist resolves in one call instead of fifty.
    flatPlaylist: true,
    playlistEnd: config.music.maxQueueLength,
  });
  const entries = Array.isArray(info?.entries) ? info.entries : [];
  return entries.map((entry) => toTrack(entry, requestedBy)).filter(Boolean);
}

function toTrack(entry, requestedBy) {
  if (!entry) return null;
  const url =
    entry.webpage_url ??
    entry.url ??
    (entry.id ? `https://www.youtube.com/watch?v=${entry.id}` : null);
  if (!url) return null;

  const duration = Number(entry.duration) || 0;
  return {
    title: entry.title ?? 'Unknown title',
    url,
    duration,
    // Flat playlist entries carry no thumbnail array, only a bare `thumbnails`
    // that may be missing entirely.
    thumbnail: entry.thumbnail ?? entry.thumbnails?.at(-1)?.url ?? null,
    uploader: entry.uploader ?? entry.channel ?? null,
    isLive: Boolean(entry.is_live),
    requestedBy,
  };
}

/**
 * Opens an Ogg/Opus stream for a track.
 *
 * Transcoding to Opus in ffmpeg means @discordjs/voice can pass the packets
 * straight through, so the bot needs no native opus encoder — which is what
 * keeps `npm install` free of build tools on a bare hosting container.
 *
 * Returns { stream, inputType, cleanup }.
 */
export function createTrackStream(track) {
  const ytdlpProcess = youtubedl.exec(
    track.url,
    {
      ...BASE_FLAGS,
      output: '-',
      format: 'bestaudio[ext=webm]/bestaudio/best',
      quiet: true,
      limitRate: '2M',
    },
    { stdio: ['ignore', 'pipe', 'pipe'] },
  );

  const ffmpegProcess = spawn(
    ffmpegPath,
    [
      '-hide_banner',
      '-loglevel', 'error',
      '-i', 'pipe:0',
      '-analyzeduration', '0',
      '-vn',
      '-ar', '48000',
      '-ac', '2',
      '-c:a', 'libopus',
      '-b:a', '128k',
      '-f', 'ogg',
      'pipe:1',
    ],
    { stdio: ['pipe', 'pipe', 'pipe'] },
  );

  ytdlpProcess.stdout.pipe(ffmpegProcess.stdin);

  const cleanup = () => {
    ytdlpProcess.stdout?.unpipe?.(ffmpegProcess.stdin);
    for (const child of [ytdlpProcess, ffmpegProcess]) {
      if (child.exitCode === null && child.signalCode === null) {
        child.kill('SIGKILL');
      }
    }
  };

  // EPIPE is expected: killing yt-dlp mid-song tears down the ffmpeg stdin it
  // was writing into. Swallow it so it does not surface as a crash.
  const ignoreEpipe = (err) => {
    if (err?.code !== 'EPIPE') log.warn(`Stream error for "${track.title}":`, err);
  };
  ytdlpProcess.stdout.on('error', ignoreEpipe);
  ffmpegProcess.stdin.on('error', ignoreEpipe);
  ytdlpProcess.catch?.(() => {}); // youtube-dl-exec rejects on SIGKILL

  ytdlpProcess.stderr?.on('data', (chunk) => {
    log.debug(`yt-dlp: ${String(chunk).trim()}`);
  });
  ffmpegProcess.stderr.on('data', (chunk) => {
    log.debug(`ffmpeg: ${String(chunk).trim()}`);
  });
  ffmpegProcess.on('error', (err) => log.warn('ffmpeg failed to start:', err));

  return {
    stream: ffmpegProcess.stdout,
    inputType: StreamType.OggOpus,
    cleanup,
  };
}
