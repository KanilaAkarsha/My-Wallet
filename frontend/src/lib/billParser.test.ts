import { describe, expect, it } from 'vitest';
import { normalizeAmount, parseDate, parseReceiptText } from './billParser';

describe('normalizeAmount', () => {
  it('handles thousands, decimals and euro style', () => {
    expect(normalizeAmount('1,250.50')).toBe('1250.50');
    expect(normalizeAmount('Rs. 12,000')).toBe('12000.00');
    expect(normalizeAmount('1.250,50')).toBe('1250.50');
    expect(normalizeAmount('0')).toBeUndefined();
    expect(normalizeAmount('abc')).toBeUndefined();
  });
});

describe('parseDate', () => {
  it('parses day-first, ISO and month-name formats', () => {
    expect(parseDate('Date: 05/03/2026')).toBe('2026-03-05');
    expect(parseDate('2026-11-23 14:05')).toBe('2026-11-23');
    expect(parseDate('23 Nov 2026')).toBe('2026-11-23');
    expect(parseDate('Nov 3, 2026')).toBe('2026-11-03');
    expect(parseDate('25/12/26')).toBe('2026-12-25');
    expect(parseDate('12/25/2026')).toBe('2026-12-25'); // falls back to month-first when day-first is invalid
    expect(parseDate('31/02/2026')).toBeUndefined();
    expect(parseDate('no date')).toBeUndefined();
  });
});

describe('parseReceiptText', () => {
  const sample = `KEELLS SUPER - Nugegoda
Tel: 011 2 345 678
Date: 14/11/2026  Time 18:22
Milk Powder 400g        1,150.00
Bread                     180.00
Eggs x6                   420.00
Subtotal                1,750.00
VAT 0%                      0.00
Total Amount Due        1,750.00
Cash                    2,000.00
Change                    250.00`;
  it('extracts merchant, date, total, items, category', () => {
    const r = parseReceiptText(sample);
    expect(r.merchant).toMatch(/KEELLS/);
    expect(r.date).toBe('2026-11-14');
    expect(r.total).toBe('1750.00');
    expect(r.totalConfidence).toBeGreaterThan(0.8);
    expect(r.items.map((i) => i.name)).toEqual(expect.arrayContaining(['Milk Powder 400g', 'Bread', 'Eggs x6']));
    expect(r.categoryHint).toBe('Groceries');
  });
  it('does not take Cash/Change/Subtotal as the total', () => {
    expect(parseReceiptText('Shop\nSubtotal 500.00\nCash 1000.00\nChange 500.00\nTotal 500.00').total).toBe('500.00');
  });
  it('reads total from the next line when OCR splits columns', () => {
    expect(parseReceiptText('Shop\nGrand Total\nRs. 3,400.00').total).toBe('3400.00');
  });
  it('falls back to the largest amount with low confidence', () => {
    const r = parseReceiptText('Some Cafe\nLatte 450.00\nCake 650.00');
    expect(r.total).toBe('650.00');
    expect(r.totalConfidence).toBeLessThan(0.5);
  });
  it('returns empty fields for garbage', () => {
    const r = parseReceiptText('   \n  ');
    expect(r.total).toBeUndefined();
    expect(r.items).toEqual([]);
  });
});
