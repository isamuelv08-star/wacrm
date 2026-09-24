/**
 * Tiny CSV primitives shared by every importer (contacts today, deals
 * as of the onboarding audit's Fase 3) — line splitting with quoted-
 * field support, and header normalization for synonym matching, so
 * neither drifts from the other.
 */

/** Simple CSV line parse (handles quoted fields). */
export function parseCsvLine(line: string): string[] {
  const values: string[] = [];
  let current = '';
  let inQuotes = false;

  for (const char of line) {
    if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === ',' && !inQuotes) {
      values.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  values.push(current.trim());
  return values;
}

/** Lowercases, strips accents and non-alphanumerics, so "Teléfono",
 *  "telefono", "Tel." and "phone_number" all normalize the same way
 *  for synonym matching against a fixed header list. */
export function normalizeHeader(header: string): string {
  return header
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

/** Finds the first header whose normalized form matches one of
 *  `synonyms` (already-normalized or not — normalized here). Returns
 *  -1 when none match, same contract as `Array.prototype.indexOf`. */
export function findHeaderIndex(headers: string[], synonyms: string[]): number {
  const normalizedSynonyms = synonyms.map(normalizeHeader);
  return headers.findIndex((h) => normalizedSynonyms.includes(normalizeHeader(h)));
}
