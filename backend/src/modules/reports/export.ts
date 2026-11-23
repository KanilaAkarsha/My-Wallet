import PDFDocument from 'pdfkit';

export interface Table {
  title: string;
  subtitle?: string;
  columns: string[];
  rows: string[][];
}

/** Neutralise spreadsheet formula injection (=,+,-,@, tab, CR) — user-entered titles end up in CSVs. */
export function csvCell(v: string): string {
  let s = String(v ?? '');
  if (/^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
export const toCsv = (t: Table): string => '﻿' + [t.columns, ...t.rows].map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n';

export function toPdf(t: Table): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 40, info: { Title: t.title, Producer: 'MyWallet' } });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    doc.fontSize(18).fillColor('#065F46').text('MyWallet', { continued: false });
    doc.fontSize(14).fillColor('#172B4D').text(t.title);
    if (t.subtitle) doc.fontSize(9).fillColor('#64748B').text(t.subtitle);
    doc.moveDown();
    const width = doc.page.width - 80;
    const colW = width / Math.max(1, t.columns.length);
    const row = (cells: string[], bold = false) => {
      const y = doc.y;
      if (y > doc.page.height - 70) doc.addPage();
      const top = doc.y;
      doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(9).fillColor('#172B4D');
      cells.forEach((c, i) => doc.text(String(c ?? ''), 40 + i * colW, top, { width: colW - 6, lineBreak: false, ellipsis: true }));
      doc.y = top + 15;
    };
    row(t.columns, true);
    doc.moveTo(40, doc.y - 3).lineTo(40 + width, doc.y - 3).strokeColor('#E2E8F0').stroke();
    for (const r of t.rows.slice(0, 5000)) row(r);
    if (t.rows.length > 5000) doc.fontSize(8).fillColor('#64748B').text('Showing the first 5,000 rows. Use the CSV export for the full data.');
    doc.end();
  });
}
