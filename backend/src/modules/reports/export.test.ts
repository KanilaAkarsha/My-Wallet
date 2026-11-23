import { describe, expect, it } from 'vitest';
import { csvCell, toCsv, toPdf } from './export.js';

describe('CSV export', () => {
  it('neutralises formula injection but keeps plain negative numbers', () => {
    expect(csvCell('=HYPERLINK("http://x")')).toBe(`"'=HYPERLINK(""http://x"")"`);
    expect(csvCell('+1+1')).toBe("'+1+1");
    expect(csvCell('@SUM(A1)')).toBe("'@SUM(A1)");
    expect(csvCell('-500.00')).toBe('-500.00');
    expect(csvCell('-cmd|calc')).toBe("'-cmd|calc");
  });
  it('quotes commas, quotes and newlines', () => {
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell('l1\nl2')).toBe('"l1\nl2"');
  });
  it('renders header + rows with CRLF and BOM', () => {
    const c = toCsv({ title: 't', columns: ['Date', 'Amount'], rows: [['2026-11-01', '100.00']] });
    expect(c.startsWith('﻿')).toBe(true);
    expect(c).toContain('Date,Amount\r\n2026-11-01,100.00\r\n');
  });
});

describe('PDF export', () => {
  it('produces a valid PDF buffer', async () => {
    const b = await toPdf({ title: 'Monthly', subtitle: 'LKR', columns: ['Month', 'Income', 'Expenses'], rows: Array.from({ length: 80 }, (_, i) => [`2026-${i}`, '1.00', '2.00']) });
    expect(b.subarray(0, 5).toString()).toBe('%PDF-');
    expect(b.length).toBeGreaterThan(1000);
  });
});
