/**
 * The Steam regions worth comparing.
 *
 * Not every country — each one is an API call, and Steam's storefront is IP
 * rate-limited. This is a spread: the majors people recognise, plus the regions
 * that have historically been cheap.
 *
 * "Historically" is doing work there. Steam moved Argentina and Turkey to USD
 * pricing in November 2023, which ended the two most famous cheap regions, so
 * they are kept here for completeness rather than as a promise.
 */
export const REGIONS = [
  { code: 'US', name: 'United States' },
  { code: 'GB', name: 'United Kingdom' },
  { code: 'DE', name: 'Germany' },
  { code: 'PL', name: 'Poland' },
  { code: 'RU', name: 'Russia' },
  { code: 'UA', name: 'Ukraine' },
  { code: 'KZ', name: 'Kazakhstan' },
  { code: 'TR', name: 'Türkiye' },
  { code: 'AR', name: 'Argentina' },
  { code: 'BR', name: 'Brazil' },
  { code: 'IN', name: 'India' },
  { code: 'ID', name: 'Indonesia' },
  { code: 'VN', name: 'Vietnam' },
  { code: 'PH', name: 'Philippines' },
  { code: 'JP', name: 'Japan' },
  { code: 'AU', name: 'Australia' },
];

export const REGION_NAMES = new Map(REGIONS.map((r) => [r.code, r.name]));

/**
 * Turns "VN" into 🇻🇳.
 *
 * Flag emoji are two regional-indicator codepoints, which sit a fixed distance
 * above the ASCII letters — so the flag for any country code is arithmetic, not
 * a lookup table of 250 entries.
 */
export function flag(code) {
  if (!/^[A-Za-z]{2}$/.test(code)) return '🏳️';
  const OFFSET = 0x1f1e6 - 'A'.charCodeAt(0);
  return String.fromCodePoint(
    ...[...code.toUpperCase()].map((c) => c.charCodeAt(0) + OFFSET),
  );
}
