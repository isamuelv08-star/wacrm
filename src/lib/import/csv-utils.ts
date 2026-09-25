/**
 * Tiny CSV primitives shared by every importer (contacts today, deals
 * as of the onboarding audit's Fase 3) — record splitting, field
 * parsing with quoted-field support, delimiter detection and header
 * normalization for synonym matching, so neither importer drifts from
 * the other.
 */

export type CsvDelimiter = ',' | ';' | '\t';

/**
 * Guess the delimiter from the header row. Excel in a Spanish/
 * Portuguese locale exports with `;` (the comma is the decimal
 * separator there) — splitting that on `,` read "Nombre;Teléfono" as a
 * single column, so the phone column was never found and the import
 * said "no valid rows".
 */
export function detectDelimiter(headerLine: string): CsvDelimiter {
  const counts: Record<CsvDelimiter, number> = { ',': 0, ';': 0, '\t': 0 };
  let inQuotes = false;
  for (const char of headerLine) {
    if (char === '"') inQuotes = !inQuotes;
    else if (!inQuotes && (char === ',' || char === ';' || char === '\t')) counts[char]++;
  }
  if (counts[';'] > counts[','] && counts[';'] >= counts['\t']) return ';';
  if (counts['\t'] > counts[','] && counts['\t'] > counts[';']) return '\t';
  return ',';
}

/**
 * Split CSV text into records, keeping newlines that sit inside a
 * quoted field (a multi-line address or note) as part of that field
 * instead of breaking the row in two. Blank records are dropped.
 */
export function splitCsvRecords(text: string): string[] {
  const records: string[] = [];
  let current = '';
  let inQuotes = false;
  const src = text.replace(/^﻿/, ''); // Excel's UTF-8 BOM

  for (let i = 0; i < src.length; i++) {
    const char = src[i];
    if (char === '"') {
      inQuotes = !inQuotes;
      current += char;
    } else if ((char === '\n' || char === '\r') && !inQuotes) {
      if (char === '\r' && src[i + 1] === '\n') i++;
      if (current.trim()) records.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  if (current.trim()) records.push(current);
  return records;
}

/**
 * Parse one CSV record into trimmed fields. Handles quoted fields and
 * RFC 4180 escaped quotes (`""` inside a quoted field is a literal `"`).
 */
export function parseCsvLine(line: string, delimiter: CsvDelimiter = ','): string[] {
  const values: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === delimiter && !inQuotes) {
      values.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  values.push(current.trim());
  return values;
}

/**
 * Parse a money cell written in either convention: "1,234.50" (en) or
 * "1.234,50" (es/pt), with or without a currency symbol. A lone
 * separator followed by exactly three digits ("1.234", "1,234") is a
 * thousands separator; followed by one or two digits it is the decimal
 * mark ("1,5" → 1.5). Returns NaN when nothing numeric is left.
 *
 * The old parser just deleted "$" and "," — so "1.234,50" became
 * 1.2345 and "1,5" became 15.
 */
export function parseMoney(raw: string): number {
  let s = raw.replace(/[^\d.,-]/g, '');
  if (!s || !/\d/.test(s)) return NaN;

  const lastDot = s.lastIndexOf('.');
  const lastComma = s.lastIndexOf(',');

  if (lastDot >= 0 && lastComma >= 0) {
    // Both present: whichever comes last is the decimal mark.
    const decimal = lastDot > lastComma ? '.' : ',';
    const thousands = decimal === '.' ? ',' : '.';
    s = s.split(thousands).join('').replace(decimal, '.');
  } else if (lastDot >= 0 || lastComma >= 0) {
    const sep = lastDot >= 0 ? '.' : ',';
    const parts = s.split(sep);
    const tail = parts[parts.length - 1];
    const isThousands = parts.length > 2 || tail.length === 3;
    s = isThousands ? parts.join('') : parts.join('.');
  }

  return Number(s);
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
