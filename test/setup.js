/**
 * Preloaded before every test run via `node --import ./test/setup.js`.
 *
 * src/lib/config.js throws on a missing DISCORD_TOKEN and src/db/index.js opens
 * the database at import time, so both need the environment in place *before*
 * any module under test is loaded. A `--import` hook is the only thing that
 * runs early enough; setting these inside a test file is too late, because ESM
 * hoists its imports above every statement.
 */
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const dbPath = join(tmpdir(), `neobot-test-${process.pid}.sqlite`);

// A throwaway database per run, so tests never touch data/neobot.sqlite.
for (const suffix of ['', '-wal', '-shm']) {
  rmSync(`${dbPath}${suffix}`, { force: true });
}

process.env.DATABASE_PATH = dbPath;
process.env.DISCORD_TOKEN = 'test-token';
process.env.DISCORD_CLIENT_ID = '000000000000000000';
process.env.DISCORD_GUILD_ID = '000000000000000000';
process.env.PRICE_COUNTRY = 'US';
process.env.TTS_VOICE = 'vi-VN-HoaiMyNeural';
process.env.LOG_LEVEL = 'error';

process.on('exit', () => {
  // better-sqlite3 still holds the handle at exit, and Windows refuses to
  // unlink an open file. Best-effort only: the next run deletes it, and these
  // live in the OS temp directory anyway.
  for (const suffix of ['', '-wal', '-shm']) {
    try {
      rmSync(`${dbPath}${suffix}`, { force: true });
    } catch {
      // Locked by our own process; harmless.
    }
  }
});
