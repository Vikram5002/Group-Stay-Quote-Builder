import { PdfDocument, pdfSafe, textWidth, wrapText } from './pdf';

const decode = (bytes: Uint8Array) => String.fromCharCode(...bytes);

describe('the PDF writer', () => {
  it('writes a well-formed file whose cross-reference table points at every object', () => {
    const doc = new PdfDocument({ title: 'Quotation (draft)' });
    doc.text(40, 40, 'Hello (world)', { font: 'bold', size: 14 });
    doc.line(40, 60, 200, 60);
    doc.rect(40, 70, 100, 20, [230, 236, 255]);
    doc.addPage().text(40, 40, 'Page two');
    const pdf = decode(doc.toBytes(new Date('2026-10-18T05:00:00Z')));

    expect(pdf.startsWith('%PDF-1.4\n')).toBe(true);
    expect(pdf.trimEnd().endsWith('%%EOF')).toBe(true);
    expect(pdf).toContain('/Count 2');
    expect(pdf).toContain('(Hello \\(world\\)) Tj');
    expect(pdf).toContain('/Title (Quotation \\(draft\\))');
    expect(pdf).toContain('/CreationDate (D:20261018050000Z)');

    const xrefAt = Number(/startxref\n(\d+)/.exec(pdf)?.[1]);
    expect(pdf.slice(xrefAt, xrefAt + 4)).toBe('xref');
    const entries = [...pdf.slice(xrefAt).matchAll(/^(\d{10}) 00000 n $/gm)].map((m) =>
      Number(m[1]),
    );
    expect(entries.length).toBeGreaterThan(5);
    entries.forEach((offset, i) =>
      expect(pdf.slice(offset).startsWith(`${i + 1} 0 obj`)).toBe(true),
    );
  });

  it('keeps each stream length exact', () => {
    const pdf = decode(new PdfDocument().addPage().text(10, 10, 'Café').toBytes());
    const match = /<< \/Length (\d+) >>\nstream\n([\s\S]*?)\nendstream/.exec(pdf);
    expect(match?.[2]?.length).toBe(Number(match?.[1]));
  });

  it('turns characters the standard fonts lack into plain ones', () => {
    expect(pdfSafe('₹36,000 – 1 Nov · 2 nights…')).toBe('Rs. 36,000 - 1 Nov - 2 nights...');
    expect(pdfSafe('Café 😀')).toBe('Café ?');
  });

  it('measures and wraps text by the real Helvetica widths', () => {
    expect(textWidth('iiii', 'regular', 10)).toBeLessThan(textWidth('MMMM', 'regular', 10));
    expect(textWidth('Total', 'bold', 10)).toBeGreaterThan(textWidth('Total', 'regular', 10));
    const lines = wrapText(
      'Rooms are held until the validity date and then released.',
      'regular',
      10,
      120,
    );
    expect(lines.length).toBeGreaterThan(1);
    for (const line of lines) expect(textWidth(line, 'regular', 10)).toBeLessThanOrEqual(120);
  });
});
