/**
 * Configuration self-check.
 *
 *   npm run doctor
 *
 * Answers "why isn't this working?" without starting the bot. Uses REST only,
 * so it needs no gateway connection and no server membership — which matters,
 * because the problems it looks for are exactly the ones that stop the bot
 * getting that far.
 */
import { REST } from 'discord.js';
import { config } from './lib/config.js';
import { formatFindings, hasErrors, runPreflight } from './lib/preflight.js';
import { bold, green, red } from './lib/colors.js';

const rest = new REST().setToken(config.token);

console.log(bold('\nChecking the bot configuration…\n'));

const findings = await runPreflight(rest);
console.log(formatFindings(findings, { includeOk: true }));

if (hasErrors(findings)) {
  console.log('\nFix the [FAIL] items above, then run `npm run doctor` again.');
  console.log('Once it is clean: `npm run deploy` then `npm start`.\n');
  process.exitCode = 1;
} else {
  console.log('\nAll clear. Run `npm run deploy`, then `npm start`.\n');
}
