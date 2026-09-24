/**
 * CSV parsing for the contacts import modal. Shared + unit-tested so
 * tag-column handling stays aligned with phone/name/email/company.
 */

/**
 * Synonym → canonical header lookup (onboarding audit finding C: this
 * used to require the EXACT header names below, so a real-world
 * export using "Teléfono"/"Celular"/"Correo" failed outright with no
 * explanation). Matched against a normalized header (lowercased,
 * accents stripped, non-alphanumerics removed), so "Teléfono",
 * "telefono", "Tel." and "phone_number" all resolve the same way.
 * Order matters only in that the FIRST canonical field whose synonym
 * list matches a given header wins — headers are otherwise matched
 * independently per field below.
 */
const HEADER_SYNONYMS: Record<'phone' | 'name' | 'email' | 'company' | 'tags', string[]> = {
  phone: ['phone', 'phonenumber', 'telefono', 'tel', 'celular', 'movil', 'whatsapp', 'numero', 'number'],
  name: ['name', 'fullname', 'nombre', 'cliente', 'contacto', 'contact'],
  email: ['email', 'correo', 'correoelectronico', 'mail', 'e-mail'],
  company: ['company', 'empresa', 'compania', 'negocio', 'organization', 'organizacion'],
  tags: ['tags', 'etiquetas', 'tag', 'etiqueta'],
};

function normalizeHeader(header: string): string {
  return header
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

/** Finds the first header whose normalized form matches one of
 *  `field`'s known synonyms. Returns -1 when none match, same
 *  contract as `Array.prototype.indexOf`. */
function findHeaderIndex(headers: string[], field: keyof typeof HEADER_SYNONYMS): number {
  const synonyms = HEADER_SYNONYMS[field].map(normalizeHeader);
  return headers.findIndex((h) => synonyms.includes(normalizeHeader(h)));
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
  const lines = text.trim().split(/\r?\n/);
  if (lines.length < 2) {
    return { rows: [], hasTagsColumn: false, hasCompanyColumn: false };
  }

  const headers = lines[0]
    .split(',')
    .map((h) => h.trim().toLowerCase().replace(/["']/g, ''));

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

    const values = parseCsvLine(line);
    const phone = values[phoneIdx]?.replace(/["']/g, '').trim();
    if (!phone) continue;

    rows.push({
      phone,
      name:
        nameIdx >= 0
          ? values[nameIdx]?.replace(/["']/g, '').trim() || undefined
          : undefined,
      email:
        emailIdx >= 0
          ? values[emailIdx]?.replace(/["']/g, '').trim() || undefined
          : undefined,
      company:
        companyIdx >= 0
          ? values[companyIdx]?.replace(/["']/g, '').trim() || undefined
          : undefined,
      tagNames:
        tagsIdx >= 0 ? parseTagCell(values[tagsIdx]?.replace(/["']/g, '')) : [],
    });
  }

  return {
    rows,
    hasTagsColumn: tagsIdx >= 0,
    hasCompanyColumn: companyIdx >= 0,
  };
}

/** Simple CSV line parse (handles quoted fields). */
function parseCsvLine(line: string): string[] {
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
