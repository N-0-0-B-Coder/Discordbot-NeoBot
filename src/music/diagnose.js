/**
 * Turns a voice connection failure into something worth showing in Discord.
 *
 * The detailed diagnosis — including which state the connection stalled in and
 * the full dependency report — goes to the server log, in `manager.js`. This is
 * the short version for the person who ran the command: enough to know whether
 * to retry, ask an admin, or tell the operator.
 *
 * Reads `err.state` structurally rather than importing VoiceConnectError, so
 * this stays usable for any failure shape.
 */

/**
 * @param {unknown} err  the error thrown by GuildVoiceSession#connect
 * @param {string} channelName
 * @returns {string} a user-facing explanation
 */
export function describeVoiceFailure(err, channelName) {
  const state = err?.state;

  if (state === 'signalling') {
    return [
      `I joined **${channelName}** but Discord never sent me a voice server.`,
      '',
      'The most common cause is **a second copy of me running on the same',
      'token** — Discord replies to one of us and the other waits forever.',
      'Otherwise: check I can see the channel and that it is not full.',
      'The server log narrows it down further.',
    ].join('\n');
  }

  if (state === 'connecting') {
    return [
      `I reached **${channelName}** but the audio connection never completed.`,
      '',
      'Discord carries voice over UDP, and some hosting platforms block it.',
      'Text commands are unaffected. This one is for whoever runs the bot —',
      'the server log has the full diagnosis.',
    ].join('\n');
  }

  return `I could not connect to **${channelName}**.`;
}
