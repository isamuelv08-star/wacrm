import { parseCsvLine, findHeaderIndex } from '@/lib/import/csv-utils';

/**
 * CSV parsing for the onboarding wizard's deals/opportunities import
 * (onboarding audit finding D.4 — no importer existed anywhere in the
 * product before this). Deliberately minimal compared to contacts:
 * a deal needs a phone (to match or create the contact it belongs
 * to), a title, and an optional value — everything else (pipeline,
 * stage, currency, owner) is supplied by the caller, not the file,
 * since a fresh account only has one pipeline/stage to put these in
 * at this point in onboarding.
 */

export interface ParsedDealRow {
  phone: string;
  title: string;
  /** Contact display name, if the file has one — used only when a
   *  new contact has to be created for this phone. */
  contactName?: string;
  /** Parsed as a plain number; missing/unparseable → 0, same
   *  "never guess a price" posture as the rest of this app. */
  value: number;
}

const HEADER_SYNONYMS = {
  phone: ['phone', 'phonenumber', 'telefono', 'tel', 'celular', 'movil', 'whatsapp', 'numero', 'number'],
  title: ['title', 'deal', 'oportunidad', 'nombre', 'titulo', 'producto', 'product', 'name'],
  contactName: ['contactname', 'cliente', 'contacto', 'contact', 'customername'],
  value: ['value', 'valor', 'monto', 'amount', 'precio', 'price', 'total'],
};

export interface ParseDealCsvResult {
  rows: ParsedDealRow[];
  hasValueColumn: boolean;
}

export function parseDealCsv(text: string): ParseDealCsvResult {
  const lines = text.trim().split(/\r?\n/);
  if (lines.length < 2) return { rows: [], hasValueColumn: false };

  const headers = lines[0].split(',').map((h) => h.trim().replace(/["']/g, ''));

  const phoneIdx = findHeaderIndex(headers, HEADER_SYNONYMS.phone);
  if (phoneIdx === -1) return { rows: [], hasValueColumn: false };

  const titleIdx = findHeaderIndex(headers, HEADER_SYNONYMS.title);
  const contactNameIdx = findHeaderIndex(headers, HEADER_SYNONYMS.contactName);
  const valueIdx = findHeaderIndex(headers, HEADER_SYNONYMS.value);

  const rows: ParsedDealRow[] = [];

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    const values = parseCsvLine(line);
    const phone = values[phoneIdx]?.replace(/["']/g, '').trim();
    if (!phone) continue;

    const contactName =
      contactNameIdx >= 0 ? values[contactNameIdx]?.replace(/["']/g, '').trim() || undefined : undefined;
    const rawTitle = titleIdx >= 0 ? values[titleIdx]?.replace(/["']/g, '').trim() : '';
    const rawValue = valueIdx >= 0 ? values[valueIdx]?.replace(/["'$,]/g, '').trim() : '';
    const parsedValue = Number(rawValue);

    rows.push({
      phone,
      // A row with no title column (or a blank cell) falls back to
      // the contact's own name — same "never leave a deal untitled"
      // posture as webhook-processor.ts's own ensureLeadDeal.
      title: rawTitle || contactName || phone,
      contactName,
      value: Number.isFinite(parsedValue) && parsedValue >= 0 ? parsedValue : 0,
    });
  }

  return { rows, hasValueColumn: valueIdx >= 0 };
}
