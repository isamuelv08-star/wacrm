import { describe, expect, it } from 'vitest';
import { parseContactCsv, parseTagCell } from './parse-contact-csv';

describe('parseTagCell', () => {
  it('splits comma-separated tags and trims whitespace', () => {
    expect(parseTagCell(' VIP , Lead ,  ')).toEqual(['VIP', 'Lead']);
  });

  it('splits semicolon-separated tags', () => {
    expect(parseTagCell('VIP; Lead; Customer')).toEqual([
      'VIP',
      'Lead',
      'Customer',
    ]);
  });

  it('de-dupes case-insensitively', () => {
    expect(parseTagCell('vip, VIP, Lead')).toEqual(['vip', 'Lead']);
  });

  it('returns empty for blank values', () => {
    expect(parseTagCell('')).toEqual([]);
    expect(parseTagCell(undefined)).toEqual([]);
  });
});

describe('parseContactCsv', () => {
  it('parses optional tags column', () => {
    const csv = `phone,name,tags
+15551234567,Alice,"VIP, Lead"
+15559876543,Bob,Customer`;

    expect(parseContactCsv(csv)).toEqual({
      hasTagsColumn: true,
      hasCompanyColumn: false,
      rows: [
        {
          phone: '+15551234567',
          name: 'Alice',
          email: undefined,
          company: undefined,
          tagNames: ['VIP', 'Lead'],
        },
        {
          phone: '+15559876543',
          name: 'Bob',
          email: undefined,
          company: undefined,
          tagNames: ['Customer'],
        },
      ],
    });
  });

  it('returns empty tagNames when tags column is absent', () => {
    const csv = `phone,name
+15551234567,Alice`;

    expect(parseContactCsv(csv)).toEqual({
      hasTagsColumn: false,
      hasCompanyColumn: false,
      rows: [
        {
          phone: '+15551234567',
          name: 'Alice',
          email: undefined,
          company: undefined,
          tagNames: [],
        },
      ],
    });
  });

  // Onboarding audit finding C: a real-world export rarely uses the
  // exact English header names — this must still resolve them.
  it('detects Spanish/synonym headers (Teléfono, Nombre, Correo, Empresa, Etiquetas)', () => {
    const csv = `Teléfono,Nombre,Correo,Empresa,Etiquetas
+15551234567,Alicia,alicia@example.com,Acme,"VIP, Lead"`;

    expect(parseContactCsv(csv)).toEqual({
      hasTagsColumn: true,
      hasCompanyColumn: true,
      rows: [
        {
          phone: '+15551234567',
          name: 'Alicia',
          email: 'alicia@example.com',
          company: 'Acme',
          tagNames: ['VIP', 'Lead'],
        },
      ],
    });
  });

  it('detects other common phone synonyms (Celular, WhatsApp)', () => {
    expect(parseContactCsv(`Celular,Nombre\n+15551234567,Alice`).rows).toHaveLength(1);
    expect(parseContactCsv(`WhatsApp,Nombre\n+15551234567,Alice`).rows).toHaveLength(1);
  });

  it('still returns nothing when no header resembles a phone column', () => {
    const csv = `id,notes\n1,hello`;
    expect(parseContactCsv(csv)).toEqual({ rows: [], hasTagsColumn: false, hasCompanyColumn: false });
  });
});
