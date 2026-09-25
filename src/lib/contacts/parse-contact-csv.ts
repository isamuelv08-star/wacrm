/**
 * CSV parsing for the contacts import modal. Shared + unit-tested so
 * tag-column handling stays aligned with phone/name/email/company.
 */

import {
  detectDelimiter,
  parseCsvLine,
  splitCsvRecords,
  findHeaderIndex as findHeaderIndexBySynonyms,
} from '@/lib/import/csv-utils';

/**
 * Synonym → canonical header lookup (onboarding audit finding C: this
 * used to require the EXACT header names below, so a real-world
 * export using "Teléfono"/"Celular"/"Correo" failed outright with no
 * explanation). Matched via findHeaderIndex's normalization
 * (lowercased, accents stripped, non-alphanumerics removed), so
 * "Teléfono", "telefono", "Tel." and "phone_number" all resolve the
 * same way. Shared with parse-deal-csv.ts's own HEADER_SYNONYMS via
 * csv-utils.ts's normalization, not this exact map — each importer
 * still owns its own field list since contacts and deals need
 * different columns.
 */
const HEADER_SYNONYMS: Record<'phone' | 'name' | 'email' | 'company' | 'tags', string[]> = {
  phone: ['phone', 'phonenumber', 'telefono', 'tel', 'celular', 'movil', 'whatsapp', 'numero', 'number'],
  name: ['name', 'fullname', 'nombre', 'cliente', 'contacto', 'contact'],
  email: ['email', 'correo', 'correoelectronico', 'mail', 'e-mail'],
  company: ['company', 'empresa', 'compania', 'negocio', 'organization', 'organizacion'],
  tags: ['tags', 'etiquetas', 'tag', 'etiqueta'],
};

function findHeaderIndex(headers: string[], field: keyof typeof HEADER_SYNONYMS): number {
  return findHeaderIndexBySynonyms(headers, HEADER_SYNONYMS[field]);
}

export interface ParsedContactRow {
  phone: string;
  name?: string;
  email?: string;
  company?: string;
  /** Tag names from the optional `tags` column (comma/semicolon separated). */
  tagNames: string[];
}

/** Split a CSV cell into unique tag names (case-insensitive de-dupe). */
export function parseTagCell(value: string | undefined): string[] {
  if (!value?.trim()) return [];

  const seen = new Set<string>();
  const names: string[] = [];

  for (const part of value.split(/[,;]/)) {
    const name = part.trim();
    if (!name) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    names.push(name);
  }

  return names;
}

export interface ParseContactCsvResult {
  rows: ParsedContactRow[];
  /** True when the CSV header includes a `tags` column. */
  hasTagsColumn: boolean;
  /** True when the CSV header includes a `company` column. */
  hasCompanyColumn: boolean;
}

export function parseContactCsv(text: string): ParseContactCsvResult {
  const lines = splitCsvRecords(text);
  if (lines.length < 2) {
    return { rows: [], hasTagsColumn: false, hasCompanyColumn: false };
  }

  const delimiter = detectDelimiter(lines[0]);
  const headers = parseCsvLine(lines[0], delimiter).map((h) => h.toLowerCase());

  const phoneIdx = findHeaderIndex(headers, 'phone');
  if (phoneIdx === -1) {
    return { rows: [], hasTagsColumn: false, hasCompanyColumn: false };
  }

  const nameIdx = findHeaderIndex(headers, 'name');
  const emailIdx = findHeaderIndex(headers, 'email');
  const companyIdx = findHeaderIndex(headers, 'company');
  const tagsIdx = findHeaderIndex(headers, 'tags');

  const rows: ParsedContactRow[] = [];

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    // Quotes are already consumed by parseCsvLine — apostrophes are
    // real data ("O'Brien") and are no longer stripped.
    const values = parseCsvLine(line, delimiter);
    const phone = values[phoneIdx]?.trim();
    if (!phone) continue;

    rows.push({
      phone,
      name: nameIdx >= 0 ? values[nameIdx]?.trim() || undefined : undefined,
      email: emailIdx >= 0 ? values[emailIdx]?.trim() || undefined : undefined,
      company: companyIdx >= 0 ? values[companyIdx]?.trim() || undefined : undefined,
      tagNames: tagsIdx >= 0 ? parseTagCell(values[tagsIdx]) : [],
    });
  }

  return {
    rows,
    hasTagsColumn: tagsIdx >= 0,
    hasCompanyColumn: companyIdx >= 0,
  };
}
