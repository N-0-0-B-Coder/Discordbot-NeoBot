/**
 * Startup self-check for the misconfigurations that fail *silently* or with a
 * misleading error.
 *
 * Every check here exists because it cost real debugging time:
 *
 *  - "Requires OAuth2 Code Grant" left on makes every invite fail at the final
 *    step with "Integration requires code grant". The bot then joins nothing,
 *    and `npm run deploy` reports "Missing Access", which points at scopes —
 *    the wrong place entirely.
 *  - A missing Message Content intent does not error. `message.content` simply
 *    arrives empty, so TTS never speaks and nothing explains why.
 *  - A bot in zero servers cannot have guild commands registered, which again
 *    surfaces as "Missing Access".
 *
 * All of it is answerable over REST, with no gateway connection, so the same
 * code serves `npm run doctor`, `npm start` and the deploy error path.
 */
import { execFile } from 'node:child_process';
import { createRequire } from 'node:module';
import { promisify } from 'node:util';
import ffmpegPath from 'ffmpeg-static';
import { ApplicationFlagsBitField, Routes } from 'discord.js';
import { config } from './config.js';
import { bold, green, red, yellow } from './colors.js';

const run = promisify(execFile);
const require = createRequire(import.meta.url);

/** @typedef {{ level: 'error'|'warn'|'ok', title: string, detail?: string, fix?: string }} Finding */

/**
 * Privileged intents this bot actually requests in src/index.js. Each maps to
 * two application flags: the plain one (granted after verification) and the
 * `...Limited` one (toggled in the portal, which is the normal state below the
 * verification threshold). Either counts as enabled.
 */
const REQUIRED_INTENTS = [
  {
    name: 'Server Members Intent',
    flags: ['GatewayGuildMembers', 'GatewayGuildMembersLimited'],
    usedFor: 'resolving members and comparing role hierarchy in moderation',
    symptom: 'the gateway refuses the connection with close code 4014',
  },
  {
    name: 'Message Content Intent',
    flags: ['GatewayMessageContent', 'GatewayMessageContentLimited'],
    usedFor: '/tts-join reading the voice channel chat aloud',
    symptom:
      'message.content arrives EMPTY instead of erroring, so TTS silently never speaks',
  },
];

/**
 * Runs every check. Never throws — a diagnostic that crashes is worse than none.
 *
 * @param {import('discord.js').REST} rest
 * @returns {Promise<Finding[]>}
 */
export async function runPreflight(rest) {
  const findings = [];

  const application = await fetchSafely(() => rest.get(Routes.currentApplication()));
  if (!application) {
    findings.push({
      level: 'warn',
      title: 'Could not read the application',
      detail: 'Skipped the configuration checks — is the token valid?',
    });
  } else {
    checkCodeGrant(application, findings);
    checkIntents(application, findings);
  }

  const guilds = await fetchSafely(() => rest.get(Routes.userGuilds()));
  if (guilds) checkGuilds(guilds, findings);

  await checkBinaries(findings);

  return findings;
}

/**
 * Confirms the bundled media binaries actually execute on THIS platform.
 *
 * They arrive through npm, so it is tempting to assume they work — but the
 * shape of what npm fetches differs per platform. On Linux `youtube-dl-exec`
 * downloads yt-dlp as a Python *zipapp*, which needs a system Python 3.9+;
 * on Windows it gets a self-contained .exe that does not. A deploy to a
 * Python-less image therefore installs cleanly and then fails on the first
 * /play, with an error nobody connects back to the build.
 *
 * Running each binary once at startup turns that into a line you can read.
 */
async function checkBinaries(findings) {
  await probe(findings, {
    label: 'yt-dlp',
    usedBy: '/play',
    resolve: () => require('youtube-dl-exec/src/constants.js').YOUTUBE_DL_PATH,
    args: ['--version'],
    hint:
      'On Linux this binary is a Python zipapp and needs python3 >= 3.9 on the\n' +
      '  host. nixpacks.toml installs it for Railway; other hosts need the same,\n' +
      '  or set YOUTUBE_DL_FILENAME=yt-dlp_linux to fetch the standalone build.',
  });

  await probe(findings, {
    label: 'ffmpeg',
    usedBy: 'all audio — music and TTS',
    resolve: () => ffmpegPath,
    args: ['-version'],
    hint: 'Reinstall dependencies so ffmpeg-static can fetch its binary.',
  });
}

async function probe(findings, { label, usedBy, resolve, args, hint }) {
  let binary;
  try {
    binary = resolve();
  } catch {
    binary = null;
  }

  if (!binary) {
    findings.push({
      level: 'error',
      title: `${label} is missing`,
      detail: `Needed by ${usedBy}.`,
      fix: hint,
    });
    return;
  }

  try {
    // A version flag is the cheapest thing that proves it can actually run.
    const { stdout } = await run(binary, args, { timeout: 10_000 });
    const version = String(stdout).trim().split('\n')[0].slice(0, 60);
    findings.push({ level: 'ok', title: `${label} runs (${version})` });
  } catch (err) {
    findings.push({
      level: 'error',
      title: `${label} will not run`,
      detail: `Needed by ${usedBy}.\n  ${String(err.message).split('\n')[0]}`,
      fix: hint,
    });
  }
}

function checkCodeGrant(application, findings) {
  if (!application.bot_require_code_grant) {
    findings.push({ level: 'ok', title: 'OAuth2 code grant is off (correct)' });
    return;
  }

  findings.push({
    level: 'error',
    title: '"Requires OAuth2 Code Grant" is ENABLED',
    detail:
      'Every invite will fail at the last step with "Integration requires code\n' +
      '  grant", so the bot can never join a server. That setting expects a web\n' +
      '  server to exchange an OAuth2 code for a token; this bot has none and\n' +
      '  does not need one.',
    fix: 'Developer Portal -> your app -> Bot -> turn OFF "Requires OAuth2 Code Grant", then save.',
  });
}

function checkIntents(application, findings) {
  const flags = new ApplicationFlagsBitField(application.flags ?? 0);

  for (const intent of REQUIRED_INTENTS) {
    const enabled = intent.flags.some((flag) => flags.has(flag));
    if (enabled) {
      findings.push({ level: 'ok', title: `${intent.name} is enabled` });
      continue;
    }
    findings.push({
      level: 'error',
      title: `${intent.name} is NOT enabled`,
      detail: `Needed for ${intent.usedFor}.\n  Without it, ${intent.symptom}.`,
      fix: `Developer Portal -> your app -> Bot -> Privileged Gateway Intents -> enable "${intent.name}".`,
    });
  }
}

function checkGuilds(guilds, findings) {
  if (guilds.length === 0) {
    findings.push({
      level: 'error',
      title: 'The bot is not in any server',
      detail:
        'Guild commands can only be registered for a server the bot has joined,\n' +
        '  so `npm run deploy` will fail with "Missing Access" until it joins one.',
      fix: 'Run `npm run invite`, open the URL, pick your server and complete the authorisation.',
    });
    return;
  }

  findings.push({
    level: 'ok',
    title: `In ${guilds.length} server(s): ${guilds.map((g) => g.name).join(', ')}`,
  });

  if (!config.guildId) return;

  if (!guilds.some((g) => g.id === config.guildId)) {
    findings.push({
      level: 'error',
      title: `Not in the guild DISCORD_GUILD_ID points at (${config.guildId})`,
      detail: `It is in:\n${guilds.map((g) => `    ${g.id}  ${g.name}`).join('\n')}`,
      fix: 'Set DISCORD_GUILD_ID in .env to one of those ids, or invite the bot to the server you meant.',
    });
  }
}

async function fetchSafely(request) {
  try {
    return await request();
  } catch {
    return null;
  }
}

/** Renders findings for a terminal. Returns the text, or '' when all clear. */
export function formatFindings(findings, { includeOk = false } = {}) {
  const problems = findings.filter((f) => f.level !== 'ok');
  const shown = includeOk ? findings : problems;
  if (shown.length === 0) return '';

  const lines = [];
  for (const finding of shown) {
    const marker =
      finding.level === 'error'
        ? red(bold('[FAIL]'))
        : finding.level === 'warn'
          ? yellow(bold('[WARN]'))
          : green('[ ok ]');
    lines.push(`${marker} ${finding.title}`);
    if (finding.detail) lines.push(`  ${finding.detail}`);
    if (finding.fix) lines.push(`  Fix: ${finding.fix}`);
    if (finding.detail || finding.fix) lines.push('');
  }
  return lines.join('\n').trimEnd();
}

export const hasErrors = (findings) => findings.some((f) => f.level === 'error');
