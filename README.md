# Discordbot-NeoBot

A Nghia's Discord Bot — text-to-speech, moderation, music, and game-sale lookups
for a friend group.

Built on **Node.js 20+ / discord.js v14**, everything driven by slash commands.

---

## Commands

| Command | What it does |
| --- | --- |
| `/tts-join` · `/tts-leave` | Sit in your voice channel and read its chat aloud |
| `/tts-voice` | Show, change or reset the speaking voice (autocompletes) |
| `/say <message>` | Discord's native client-side TTS (different thing — see below) |
| `/play <query>` | Queues audio from a search phrase, a video link, or a playlist link |
| `/queue [page]` · `/nowplaying` | See what is lined up and how far the current track is |
| `/skip` · `/pause` · `/resume` · `/stop` · `/leave` | Playback control |
| `/deals <game>` | Cheapest price across Steam, Epic, GOG, Humble and friends, plus the all-time low |
| `/steam <game>` | Steam store details for one game (autocompletes as you type) |
| `/warn` · `/warnings` · `/delwarn` | The infraction log |
| `/timeout` · `/untimeout` · `/kick` · `/ban` · `/unban` · `/purge` | Enforcement |
| `/config` | Per-server settings, private panel (Manage Server) |
| `/ping` · `/help` | Health check and command list |

Moderation commands are hidden from non-mods via Discord's
`default_member_permissions`, and re-check permissions *and* role hierarchy at
runtime — so a mod cannot act on someone ranked at or above them, and neither
can the bot.

---

## Setup

### 1. Prerequisites

Node.js **20.11 or newer**. No system `ffmpeg` or `yt-dlp` install is needed —
both binaries arrive through npm (`ffmpeg-static` and `youtube-dl-exec`).

```bash
winget install OpenJS.NodeJS.LTS
```

### 2. Create the Discord application

1. Open the [Developer Portal](https://discord.com/developers/applications) and
   create an application.
2. **Bot → Reset Token** → copy it into `DISCORD_TOKEN`.
3. **Bot → Privileged Gateway Intents** → enable **Server Members Intent**
   **and Message Content Intent**. Message Content is required by `/tts-join`,
   which reads the voice channel's chat aloud. Without it `message.content`
   arrives **empty** rather than erroring, so TTS silently never speaks — check
   this first if it goes quiet.
4. **General Information** → copy the Application ID into `DISCORD_CLIENT_ID`.
   **Leave "Interactions Endpoint URL" empty.** Filling it in switches the app to
   HTTP-webhook delivery, and the two methods are mutually exclusive — the
   gateway would stop receiving `INTERACTION_CREATE` entirely and every command
   would time out with "The application did not respond", with nothing in the
   bot's own logs to explain why. This bot needs the gateway for voice.
5. Invite the bot with the right scopes:

   ```bash
   npm run invite
   ```

   That prints a URL with the exact permissions this bot uses and — critically —
   **both** the `bot` and `applications.commands` scopes. A `bot`-only invite
   looks fine (it joins, it can talk) but slash command registration then fails
   with `Missing Access (50001)`, because owning commands in a guild is what the
   second scope grants. If the bot is already in the server, open the URL anyway
   and authorise the same server — that adds the missing scope without removing
   anything, and no kick is needed.

### 3. Configure and run

```bash
npm install
cp .env.example .env   # then fill in the three required values
npm run doctor         # verifies the token, intents, invite and membership
npm run deploy         # registers slash commands to DISCORD_GUILD_ID (instant)
npm start
```

`.env.example` documents every variable, where to get it, and which ones a
server can override at runtime with `/config`. `.env` itself is gitignored and
must never be committed.

If `npm run deploy` fails, it prints one explanatory message rather than the
whole payload: `Missing Access (50001)` means the invite scopes (above), `401`
means the token is wrong, `404` means the application or guild id is wrong, and
`400` lists which command Discord rejected and why.

Re-run `npm run deploy` whenever a command's name, description, or options
change.

### Guild vs global registration

**Guild** (`npm run deploy`) registers into `DISCORD_GUILD_ID` and appears
instantly — right for development. **Global** (`npm run deploy:global`) reaches
every server the bot is in, and can take up to an hour to propagate.

Registration targets your *application*, not a deployment, so it is a one-off
command you run from anywhere with the token — **there is nothing to configure
on Railway for this.** Running `npm run deploy:global` on your laptop has
exactly the same effect as running it in a container. It deliberately does not
run at startup: a crash-looping container would re-register on every restart
and burn the daily quota, and a `PUT` is a full replace, so a partial load
would silently delete commands.

**The two scopes are independent**, which is the trap when switching. Register
globally while the guild copies still exist and that server shows every command
**twice**, with nothing to explain why. `deploy:global` now checks for leftovers
and tells you; clear them with:

```bash
npm run deploy:clear-guild
```

Keep both only if you want your test server on a faster update loop than
everyone else — a common and deliberate setup while developing.

### 4. Set the server up

Run **`/config`** in the server. Everything works on defaults without it, but
two things are worth setting: a free
[IsThereAnyDeal key](https://isthereanydeal.com/apps/my/) to turn `/deals` from
Steam-only into cross-store comparison, and your country code for local pricing.
Run it *inside* the channel you want errors reported to, then pick "Error log
channel".

---

## Testing

```bash
npm test
```

66 tests via Node's built-in runner — no test framework dependency. They cover
everything reachable without Discord: command payload validation, the settings
schema and its migration, TTS text sanitising, the music/TTS ducking state
machine, HTTP retry and cache behaviour, cooldowns, and duration parsing.
`npm run test:watch` reruns on change.

A few exist specifically to stop bugs from coming back:

- `fetchJson` gives up inside Discord's 3-second autocomplete budget
- nothing uses the deprecated `ephemeral: true`
- `isConfigured()` is never called without a guild id
- required command options never follow optional ones
- the ITAD key never renders unmasked in the `/config` panel

Tests run against a throwaway SQLite file in the OS temp directory, so they
never touch `data/neobot.sqlite`.

### Continuous integration

`.github/workflows/ci.yml` runs on every push and pull request: `npm ci`, a
syntax check over every file, the test suite, and a probe that the bundled
`yt-dlp` and `ffmpeg` binaries actually execute. It runs on Node 22 and 24 —
22 being the floor in `engines`, 24 being what Railway provisions.

It runs on Linux, so it exercises the same platform path as a deploy. Note the
limit though: GitHub's runners ship Python, so CI would **not** have caught the
Railway build failure, whose cause was a minimal image without it. CI catches
code regressions; the startup check in the bot catches host differences.

### What tests cannot cover

Everything that needs a live gateway connection: whether the bot logs in,
whether commands register, whether audio actually reaches a voice channel,
whether the Edge TTS and Steam/ITAD services answer. Those need a real test
server — see below.

### Manual checklist for a test server

Make a private Discord server, invite the bot, and work down this list:

| Check | How | Watch for |
| --- | --- | --- |
| Login | `npm start` | "Logged in as …" in the console |
| Registration | `npm run deploy` | Lists every command; they appear after retyping `/` |
| Basic | `/ping`, `/help` | Replies within a second |
| Config | `/config` | Panel is private; change a value; reopen and confirm it stuck |
| Config restart | Restart, `/config` again | The value survived (it is in SQLite, not memory) |
| Game deals | `/deals hades` | Prices appear; without an ITAD key it says Steam-only |
| Autocomplete | Type `/steam hol` slowly | Suggestions appear while typing |
| Cooldown | Run `/deals` twice quickly | Second is refused with a timestamp |
| Music | Join voice, `/play lofi` | Audio plays; `/queue`, `/skip`, `/stop` behave |
| TTS | `/tts-join`, then type in the voice channel's chat | Bot speaks it |
| TTS filtering | Type from *outside* the voice channel | Ignored |
| Ducking | Start music, then type in the voice chat | Music pauses, speech plays, music resumes |
| Auto-leave | Everyone leaves voice | Bot disconnects on its own |
| Voice change | `/tts-voice set` → pick one | Next spoken line uses it |
| Moderation | `/warn` yourself from an alt, `/warnings` | Logged; hierarchy refusals make sense |
| Errors | Set an error channel in `/config`, force a failure | Report appears with a stack trace |

The two riskiest paths are **TTS ducking** and **auto-leave**, because both are
timing-dependent and only the state machine is unit-tested — the real voice
connection is not.

---

## Deployment (Railway)

1. Push this repo to GitHub, then **New Project → Deploy from GitHub repo**.
2. Add every variable from your local `.env` under **Variables**.
3. **Add a volume, and make `DATABASE_PATH` match its mount path.** Both halves
   are required and neither is enough alone: a volume mounted at `/data` while
   the bot still writes to the default `./data` means the volume sits there
   empty while the real database is rebuilt with the container every deploy.
   Mount at `/data` and set `DATABASE_PATH=/data/neobot.sqlite`.

   The startup log now says which happened, so you never have to guess:

   ```
   INFO  SQLite ready at /data/neobot.sqlite (existing database)
   ```

   `(NEW database)` on anything but a first run means the last deploy's
   `/config` settings and infractions are gone. The startup check calls that
   out as an error when it detects a hosting platform.
4. `railway.json` sets the start command and restart policy; `nixpacks.toml`
   handles the build.
5. If a **Start Command** is set in the service's dashboard settings, it
   silently overrides `railway.json`. Leave it empty.

**The start command runs `node src/index.js`, not `npm start`**, so that
SIGTERM reaches the app. With npm in between, the signal stopped there and the
process was killed outright — the graceful shutdown never ran, so the bot never
left its voice channel and SQLite was never closed cleanly. The giveaway in the
deploy log is npm reporting its own death as a failure:

```
npm error signal SIGTERM
```

A clean shutdown logs `Received SIGTERM, shutting down.` instead.

### Why `nixpacks.toml` exists

**Python.** `youtube-dl-exec` will not install without Python 3.9+, and on
Linux that is not a formality: it downloads the release asset named `yt-dlp`,
which is a Python *zipapp* (~3 MB) needing a system Python to run. Windows gets
`yt-dlp.exe`, which is self-contained — so this only ever appears on deploy.
Skipping the check with `YOUTUBE_DL_SKIP_PYTHON_CHECK` would let the build pass
and then fail on the first `/play`. `nixpacks.toml` installs `python3` instead.

**Set these two as Railway service variables:**

```
YOUTUBE_DL_SKIP_PYTHON_CHECK=1
YOUTUBE_DL_FILENAME=yt-dlp_linux
```

That fetches the 40 MB standalone build, which embeds its own Python. Both are
needed at **runtime** as well as build time, because the package resolves the
binary's path from them — and nixpacks `[variables]` do **not** reach the
runtime environment, which is why putting them there alone did not work.

**No build step.** Nixpacks otherwise picks up `npm run deploy` as the build
command. Registering slash commands during a build needs `DISCORD_TOKEN` at
build time, re-registers on every deploy, and makes a Discord outage fail the
build. Registration stays a deliberate manual step — run `npm run deploy`
locally when a command changes.

After deploying, check the logs: startup runs the same checks as `npm run
doctor`, including whether `yt-dlp` and `ffmpeg` actually execute on the host.

Run `npm run deploy` once locally (or as a one-off Railway command) after the
first deploy — the bot never registers commands at startup, so a crash loop can
never wipe them.

### Price watches

`/deals` and `/steam` both take an optional **watch** channel. Picking one saves
the game and reports to that channel whenever the price moves — `/pricewatch`
lists and cancels them (Manage Channels required for both).

Three rules the implementation is built around:

- **The first check never announces.** It records the price, so creating a watch
  cannot immediately report a "change" from nothing to the current price.
- **A watch pointing at a deleted channel is dropped**, not retried forever with
  nowhere to report.
- **An unreadable price is not a change.** A store outage records nothing and
  keeps the last known price, so it can never announce "now free".

The sweep runs every 6 hours, spaced 1.5s per game, and deliberately **not at
boot** — on a platform that redeploys on every push, a boot sweep would be a
burst of API calls and notifications each time. One API call per watch per
sweep, capped at 25 watches per server.

### Voice: DAVE encryption is required (this cost an evening)

**Symptom.** The bot joins the voice channel, never reaches Ready, and aborts
after 20 seconds. Every other feature works perfectly.

**Cause.** Discord made end-to-end encryption — the **DAVE protocol** —
mandatory on all non-stage voice channels on 2 March 2026. `@discordjs/voice`
0.18 has no DAVE support at all, so it identifies with
`max_dave_protocol_version: 0` and the voice websocket is closed immediately
with **close code 4017**. The fix is `@discordjs/voice` >= 0.19, which depends
on `@snazzah/davey` (prebuilt binaries, no toolchain). `npm run doctor` checks
it:

```
[ ok ] Voice E2EE available (DAVE protocol v1)
```

**Why it looked like a hosting problem.** `VoiceConnection` exposes four coarse
statuses and it *retries*, so any failure inside the handshake rewinds it to
`signalling`. The status at the timeout describes the retry, not the fault.
That produced four confident wrong diagnoses in a row — the last one being
"Railway does not route outbound UDP", which was wrong and is now retracted.
Railway carries voice fine.

**What the log tells you now.** The failure path is traced at the level that
actually distinguishes causes — the deepest `Networking` phase reached, plus
the websocket close code:

| Deepest phase | Means |
| --- | --- |
| opening the websocket | cannot reach the voice endpoint — DNS or outbound TCP/443 |
| identifying | Discord closed the session — **read the close code** (4017 = DAVE, 4006 = second instance on the same token, 4004 = token refused) |
| UDP handshake | IP discovery got no reply — *this* is the genuine blocked-UDP case |
| selecting protocol | encryption negotiation failed |

**The lesson worth keeping.** When a diagnosis blames the environment,
reproduce it in a different environment before acting on it. One local
`npm start` on a home connection falsified every host-related hypothesis in a
single step — and it should have been the first test, not the last.

**Only ever run one instance.** Two copies on one token both receive every
command and fight over voice. Note that a local `npm start` while Railway is
deployed *is* two instances: they race for each interaction and the loser logs
`40060 Interaction has already been acknowledged`. Stop the service before
testing locally.

**On Replit:** workable, but the free tier sleeps on inactivity and a sleeping
bot drops its gateway connection. It has the same UDP question besides.

---

## Project layout

```
src/
  index.js              client bootstrap, intents, retention sweep, shutdown
  deploy-commands.js    slash-command registration (run manually)
  commands/             one file per command, grouped by feature
  events/               ready, interactionCreate, messageCreate,
                        voiceStateUpdate, guildCreate
  components/           customId-routed handlers (the /config panel)
  music/
    source.js           yt-dlp -> ffmpeg -> Ogg/Opus stream
    manager.js          per-guild voice session: music queue + TTS + ducking
    guards.js           voice-channel and same-channel checks
  tts/
    engine.js           Edge TTS -> ffmpeg -> Ogg/Opus stream
    sanitize.js         message text -> something worth listening to
  services/
    itad.js             IsThereAnyDeal (cross-store prices, all-time lows)
    steam.js            Steam storefront (search, details, prices)
  db/                   SQLite schema and infraction queries
  lib/                  config, guild-config schema, logging, embeds,
                        HTTP + cache, cooldowns, error reporting
```

---

## Configuration

Two layers. `.env` sets **bot-wide defaults**; `/config` sets **per-server
overrides** that live in SQLite and win where present. A server that never runs
`/config` works fine on the defaults.

`/config` opens a private panel — only the person who ran it sees it, which
matters because the panel shows the ITAD key's last four characters. Pick a
setting from the menu and it either opens a text box, toggles, or uses the
current channel:

| Setting | How it is set | Default |
| --- | --- | --- |
| IsThereAnyDeal API key | Private text box | from `ITAD_API_KEY` |
| Price country | Text box, two letters | from `PRICE_COUNTRY` |
| TTS max message length | Text box, 50–1000 | 300 characters |
| TTS max queue length | Text box, 1–20 | 5 lines |
| Announce who is speaking | Toggles on selection | **on** |
| Error log channel | Uses the channel you ran `/config` in | from `ERROR_LOG_CHANNEL_ID` |
| TTS voice | `/tts-voice` (it has autocomplete) | from `TTS_VOICE` |

Leaving a text box **blank clears the override**, so the server follows the
default again. "Reset everything to defaults" does that for all of them.

**The API key is collected in a modal, never as a command option.** Discord
shows a slash command's filled arguments to the whole channel, so an option
would publish the key. It is stored in plain text in SQLite and only ever
displayed masked.

When the bot joins a server it posts once in the system channel (or the first
channel it can post in), pinging the owner to run `/config`. Nothing is blocked
before they do.

---

## Operational behaviour

Three things carried over from the previous bot (RNBot), which ran for five
months and taught them the hard way:

**Errors are mirrored into Discord.** Set `ERROR_LOG_CHANNEL_ID` (and optionally
`OWNER_ID` to get pinged) and any command failure, unhandled rejection, or
uncaught exception posts there with a stack trace and the user/guild/channel it
came from. On a hosted bot nobody reads stdout, so without this a command that
started failing yesterday goes unnoticed until somebody complains. Identical
errors are collapsed to one message per 5 minutes so a failure loop cannot spam
the channel.

**Per-user cooldowns** on the commands that hit rate-limited third parties —
`/deals` 10s, `/steam` 8s, `/play` 5s. Steam's storefront is IP rate-limited and
that budget is shared by everyone in the server. A command exports `cooldownMs`
to opt in; `release()` refunds it when the command bails without doing work.

**Retries with backoff.** `fetchJson` retries twice on 429 and 5xx, honours a
`Retry-After` header, and never retries a 4xx (a bad key or unknown game will
not fix itself). Network timeouts and aborts are retried too.

**Background jobs survive their own failures.** The retention sweep catches and
reports rather than throwing out of its timer — the previous bot's jobs caught
their errors then `break`-ed out of the loop, which killed the feature silently
until the next restart.

---

## Two different TTS features

They share a name and do unrelated things:

**`/say` — Discord native TTS.** Sends a message with the `tts` flag. Discord's
*client* reads it aloud on each listener's own machine, and only for people who
have TTS switched on in their settings. Free, no engine involved. It does not
play into a voice channel.

**`/tts-join` — the bot speaks in voice.** The bot joins your voice channel and
reads that channel's built-in chat aloud through the voice connection, so
everyone connected hears it regardless of their settings. This needs a real
speech engine: Microsoft Edge's read-aloud service via `msedge-tts`, no key and
no signup, but the same grey area as `yt-dlp` — unofficial use of an endpoint
Edge uses for its own feature. If speech stops working entirely, try
`npm update msedge-tts` first.

How it behaves:

- Type in the **voice channel's own chat** (the chat bubble on the voice
  channel). Messages anywhere else are ignored — a voice channel's chat carries
  the voice channel's own id, so the match is exact with no channel pairing.
- **Only people currently connected to that voice channel** are read aloud, so
  someone reading along in the chat cannot talk through the bot.
- **Music ducks**: a playing track pauses, the line is spoken, the track resumes
  where it left off. Discord allows one voice connection per guild, so this is
  done with two audio players and the connection switching between them — a
  paused player stops consuming its stream, so the track survives untouched.
- The bot **leaves automatically when the last person leaves** the voice channel.
  There is no idle timeout while TTS is on: sitting quietly waiting for someone
  to type is the whole point.
- URLs become "link", custom emoji become their name, mentions become display
  names, and code blocks become "code block" — raw message text is unpleasant to
  listen to. Messages over `TTS_MAX_MESSAGE_LENGTH` are truncated.
- **Voice is picked with `/tts-voice set`**, autocompleting as you type a
  language or name. The choice is stored per server in SQLite, so it survives
  restarts, and takes effect on the very next line spoken — no reconnect
  needed. `/tts-voice show` reports the current one, `/tts-voice reset` returns
  to the `TTS_VOICE` default (`vi-VN-HoaiMyNeural`).
- The voice catalogue is fetched from the service and cached for a day, with a
  built-in list of ~25 common voices as a fallback. Autocomplete never waits on
  that fetch — it serves the cache and refreshes in the background, so it always
  answers inside Discord's 3-second budget.

**This is why the bot now needs the Message Content intent.** It was originally
slash-command-only and needed no privileged intent at all; reading arbitrary
chat is what the feature *is*, so there is no way around it. Enable it in the
Developer Portal — it is a free toggle below 10,000 users.

---

## Things worth knowing

**Music and YouTube's terms.** `/play` pulls audio with `yt-dlp`, which is
against YouTube's Terms of Service. It is what nearly every hobby music bot
does, and it is a deliberate, informed choice here rather than an oversight.
The practical cost is maintenance: when YouTube changes its player, extraction
breaks until yt-dlp catches up. If `/play` suddenly starts failing for
everything, update the extractor first:

```bash
npm update youtube-dl-exec
```

**Data retention.** `PRIVACY_POLICY.md` promises a 30-day deletion window, and
`src/index.js` enforces it — a sweep at boot and once a day thereafter. If you
change the retention promise in the policy, change `purgeExpiredInfractions`
with it.

**No opus native module.** ffmpeg transcodes to Ogg/Opus so `@discordjs/voice`
passes packets straight through. That is why the audio path needs no C++ build
toolchain, which matters on a bare hosting container.

**Keep `better-sqlite3` on v12+.** It is the one dependency with a native
binary. Version 12 publishes prebuilds for Node 24's ABI; version 11 does not,
so npm falls back to compiling from source and the install dies asking for
Visual Studio. If you ever see `gyp ERR! find VS`, the fix is a newer
`better-sqlite3`, not a C++ toolchain.

**Contact details.** `PRIVACY_POLICY.md` and `TERMS_OF_SERVICE.md` still carry
`[INSERT YOUR EMAIL ADDRESS]` placeholders. Fill those in before the bot goes
anywhere near a server you do not own.

---

## License

MIT — see [LICENSE](LICENSE).
