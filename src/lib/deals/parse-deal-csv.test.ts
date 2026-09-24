import { describe, expect, it } from 'vitest';
import { parseDealCsv } from './parse-deal-csv';

describe('parseDealCsv', () => {
  it('parses phone, title and value', () => {
    const csv = `phone,title,value
+15551234567,Website redesign,1500
+15559876543,Consulting package,2500.50`;

    expect(parseDealCsv(csv)).toEqual({
      hasValueColumn: true,
      rows: [
        { phone: '+15551234567', title: 'Website redesign', contactName: undefined, value: 1500 },
        { phone: '+15559876543', title: 'Consulting package', contactName: undefined, value: 2500.5 },
      ],
    });
  });

  it('detects Spanish/synonym headers (Teléfono, Producto, Monto, Cliente)', () => {
    const csv = `Teléfono,Cliente,Producto,Monto
+15551234567,Alicia,Kit de facturación,350`;

    expect(parseDealCsv(csv)).toEqual({
      hasValueColumn: true,
      rows: [
        { phone: '+15551234567', title: 'Kit de facturación', contactName: 'Alicia', value: 350 },
      ],
    });
  });

  it('falls back the title to the contact name, then the phone, when no title column has a value', () => {
    const csv = `phone,cliente\n+15551234567,Alicia\n+15559876543,`;

    const { rows } = parseDealCsv(csv);
    expect(rows[0].title).toBe('Alicia');
    expect(rows[1].title).toBe('+15559876543');
  });

  it('strips currency symbols and thousands separators from the value column', () => {
    const csv = `phone,title,value\n+15551234567,Deal,"$1,500.00"`;
    expect(parseDealCsv(csv).rows[0].value).toBe(1500);
  });

  it('defaults an unparseable or negative value to 0', () => {
    const csv = `phone,title,value\n+15551234567,Deal,n/a\n+15559876543,Deal,-50`;
    const { rows } = parseDealCsv(csv);
    expect(rows[0].value).toBe(0);
    expect(rows[1].value).toBe(0);
  });

  it('returns nothing when no header resembles a phone column', () => {
    expect(parseDealCsv(`id,notes\n1,hello`)).toEqual({ rows: [], hasValueColumn: false });
  });

  it('skips rows with no phone', () => {
    const csv = `phone,title\n,Deal without a phone\n+15551234567,Real deal`;
    const { rows } = parseDealCsv(csv);
    expect(rows).toHaveLength(1);
    expect(rows[0].phone).toBe('+15551234567');
  });
});
