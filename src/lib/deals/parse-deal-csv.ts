import {
  detectDelimiter,
  findHeaderIndex,
  parseCsvLine,
  parseMoney,
  splitCsvRecords,
} from '@/lib/import/csv-utils';

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
  title: ['title', 'deal', 'oportunidad', 'negocio', 'titulo', 'producto', 'product'],
  /** Ambiguous: a person's name in a "Nombre,Teléfono,Valor" export, a
   *  deal title only when the file also names the contact separately. */
  name: ['nombre', 'name'],
  contactName: ['contactname', 'cliente', 'contacto', 'contact', 'customername'],
  value: ['value', 'valor', 'monto', 'amount', 'precio', 'price', 'total'],
};

export interface ParseDealCsvResult {
  rows: ParsedDealRow[];
  hasValueColumn: boolean;
}

export function parseDealCsv(text: string): ParseDealCsvResult {
  const lines = splitCsvRecords(text);
  if (lines.length < 2) return { rows: [], hasValueColumn: false };

  const delimiter = detectDelimiter(lines[0]);
  const headers = parseCsvLine(lines[0], delimiter);

  const phoneIdx = findHeaderIndex(headers, HEADER_SYNONYMS.phone);
  if (phoneIdx === -1) return { rows: [], hasValueColumn: false };

  // "Nombre" used to be read as the deal TITLE, so a plain
  // "Nombre,Teléfono,Valor" file created every new contact with no
  // name. It's the contact's name unless the file has its own contact
  // column; it's the title only when no explicit title column exists.
  const explicitTitleIdx = findHeaderIndex(headers, HEADER_SYNONYMS.title);
  const nameIdx = findHeaderIndex(headers, HEADER_SYNONYMS.name);
  const explicitContactIdx = findHeaderIndex(headers, HEADER_SYNONYMS.contactName);
  const contactNameIdx = explicitContactIdx >= 0 ? explicitContactIdx : nameIdx;
  const titleIdx =
    explicitTitleIdx >= 0 ? explicitTitleIdx : explicitContactIdx >= 0 ? nameIdx : -1;
  const valueIdx = findHeaderIndex(headers, HEADER_SYNONYMS.value);

  const rows: ParsedDealRow[] = [];

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    const values = parseCsvLine(line, delimiter);
    const phone = values[phoneIdx]?.trim();
    if (!phone) continue;

    const contactName =
      contactNameIdx >= 0 ? values[contactNameIdx]?.trim() || undefined : undefined;
    const rawTitle = titleIdx >= 0 ? values[titleIdx]?.trim() : '';
    // Both "1,234.50" and "1.234,50" — see parseMoney.
    const parsedValue = valueIdx >= 0 ? parseMoney(values[valueIdx] ?? '') : NaN;

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
