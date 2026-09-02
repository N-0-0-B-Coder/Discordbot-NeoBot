/**
 * Country names <-> ISO 3166-1 alpha-2 codes.
 *
 * People know "Vietnam", not "VN". Every store API here wants the code, so the
 * translation has to happen somewhere; doing it once, here, keeps `VN` out of
 * the parts of the bot a person actually reads.
 *
 * Only the CODES are stored. The names come from `Intl.DisplayNames`, which
 * ships with Node — so this is a few hundred bytes rather than a 250-row table
 * that would need maintaining every time a country is renamed.
 */

/** ISO 3166-1 alpha-2, as one string to keep the source compact. */
const CODES =
  'AD AE AF AG AI AL AM AO AR AT AU AW AZ BA BB BD BE BF BG BH BI BJ BM BN BO BR BS BT BW BY BZ ' +
  'CA CD CF CG CH CI CL CM CN CO CR CU CV CY CZ DE DJ DK DM DO DZ EC EE EG ER ES ET FI FJ FM FR ' +
  'GA GB GD GE GH GI GL GM GN GQ GR GT GW GY HK HN HR HT HU ID IE IL IN IQ IR IS IT JM JO JP KE ' +
  'KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MG MH MK ML MM MN ' +
  'MO MR MT MU MV MW MX MY MZ NA NE NG NI NL NO NP NR NZ OM PA PE PG PH PK PL PR PS PT PW PY QA ' +
  'RO RS RU RW SA SB SC SD SE SG SI SK SL SM SN SO SR SS ST SV SY SZ TD TG TH TJ TL TM TN TO TR ' +
  'TT TV TW TZ UA UG US UY UZ VA VC VE VN VU WS YE ZA ZM ZW';

const display = new Intl.DisplayNames(['en'], { type: 'region' });

/** [{ code, name }], sorted by name. */
export const COUNTRIES = CODES.split(' ')
  .map((code) => ({ code, name: countryName(code) }))
  .sort((a, b) => a.name.localeCompare(b.name));

const BY_NAME = new Map(COUNTRIES.map((c) => [c.name.toLowerCase(), c.code]));
const VALID = new Set(COUNTRIES.map((c) => c.code));

/** "VN" -> "Vietnam". Falls back to the code so nothing renders as undefined. */
export function countryName(code) {
  try {
    return display.of(code.toUpperCase()) ?? code.toUpperCase();
  } catch {
    return String(code).toUpperCase();
  }
}

/**
 * Accepts whatever a person is likely to type and returns a code.
 *
 * Both directions matter: the autocomplete sends a code, but someone editing
 * the setting by hand may well type "Vietnam", and rejecting that would be
 * pedantry — the intent is unambiguous.
 *
 * @returns {string|null} the code, or null if it could not be resolved.
 */
export function resolveCountry(input) {
  const raw = String(input ?? '').trim();
  if (!raw) return null;

  const upper = raw.toUpperCase();
  if (VALID.has(upper)) return upper;

  const byName = BY_NAME.get(raw.toLowerCase());
  if (byName) return byName;

  // One unambiguous prefix match: "viet" -> Vietnam. Several matches means the
  // input genuinely does not identify a country, so it is refused rather than
  // guessed.
  const matches = COUNTRIES.filter((c) =>
    c.name.toLowerCase().startsWith(raw.toLowerCase()),
  );
  return matches.length === 1 ? matches[0].code : null;
}

/**
 * Countries matching a partial name, for autocomplete.
 *
 * Names that START with the query come first — typing "in" should offer India
 * before Finland, even though both contain it.
 */
export function searchCountries(query, limit = 25) {
  const needle = String(query ?? '').trim().toLowerCase();
  if (!needle) return COUNTRIES.slice(0, limit);

  const starts = [];
  const contains = [];
  for (const country of COUNTRIES) {
    const name = country.name.toLowerCase();
    if (name.startsWith(needle) || country.code.toLowerCase() === needle) {
      starts.push(country);
    } else if (name.includes(needle)) {
      contains.push(country);
    }
  }
  return [...starts, ...contains].slice(0, limit);
}
