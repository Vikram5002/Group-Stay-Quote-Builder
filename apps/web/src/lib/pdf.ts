/**
 * A small PDF 1.4 writer for documents made of text, lines and filled boxes, with no dependency
 * (like the CSV and zip writers in this repo). It uses the two standard Helvetica fonts, which
 * every PDF reader has, so nothing is embedded. Those fonts cover WinAnsi (Latin-1) only: other
 * characters are replaced by plain equivalents, for example ₹ becomes "Rs.".
 *
 * Coordinates are in points from the top-left corner of an A4 page (595 x 842).
 */

export type FontName = 'regular' | 'bold';
export type Rgb = readonly [number, number, number];

export const A4 = { width: 595.28, height: 841.89 } as const;

const FONT_RESOURCE: Record<FontName, string> = { regular: 'F1', bold: 'F2' };

/** Advance widths (1/1000 em) of WinAnsi characters 32 to 126, from the Helvetica AFM files. */
const WIDTHS: Record<FontName, readonly number[]> = {
  regular: [
    278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556,
    556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556, 1015, 667, 667, 722, 722, 667,
    611, 778, 722, 278, 500, 667, 556, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667,
    667, 611, 278, 278, 278, 469, 556, 333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500,
    222, 833, 556, 556, 556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584,
  ],
  bold: [
    278, 333, 474, 556, 556, 889, 722, 238, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556,
    556, 556, 556, 556, 556, 556, 556, 333, 333, 584, 584, 584, 611, 975, 722, 722, 722, 722, 667,
    611, 778, 722, 278, 556, 722, 611, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667,
    667, 611, 333, 278, 333, 584, 556, 333, 556, 611, 556, 611, 556, 333, 611, 611, 278, 278, 556,
    278, 889, 611, 611, 611, 611, 389, 556, 333, 611, 556, 778, 556, 556, 500, 389, 280, 389, 584,
  ],
};

const REPLACEMENTS: ReadonlyArray<readonly [RegExp, string]> = [
  [/₹\s?/g, 'Rs. '],
  [/[‐‑‒–—−]/g, '-'],
  [/[·•]/g, '-'],
  [/[‘’]/g, "'"],
  [/[“”]/g, '"'],
  [/…/g, '...'],
  [/×/g, 'x'],
  [/→/g, '->'],
  [/\u00a0|\u202f/g, ' '],
];

/** Text the standard fonts can show: plain replacements first, then anything outside Latin-1. */
export function pdfSafe(text: string): string {
  let out = text;
  for (const [pattern, replacement] of REPLACEMENTS) out = out.replace(pattern, replacement);
  return out.replace(/[^\x20-\x7e\xa0-\xff]/gu, '?');
}

/** Width of a line of text in points. */
export function textWidth(text: string, font: FontName, size: number): number {
  let units = 0;
  for (const ch of pdfSafe(text)) {
    const code = ch.charCodeAt(0);
    units += WIDTHS[font][code - 32] ?? 556; // Latin-1 letters above 126: an average width
  }
  return (units * size) / 1000;
}

/** Break text into lines no wider than maxWidth, at spaces where possible. */
export function wrapText(text: string, font: FontName, size: number, maxWidth: number): string[] {
  const lines: string[] = [];
  for (const paragraph of pdfSafe(text).split('\n')) {
    let line = '';
    for (const word of paragraph.split(' ')) {
      const next = line ? `${line} ${word}` : word;
      if (textWidth(next, font, size) <= maxWidth || !line) {
        line = next;
      } else {
        lines.push(line);
        line = word;
      }
    }
    lines.push(line);
  }
  return lines;
}

const escapeText = (text: string) => text.replace(/[\\()]/g, (c) => `\\${c}`);
const n = (value: number) => (Math.round(value * 100) / 100).toString();
const color = ([r, g, b]: Rgb) => `${n(r / 255)} ${n(g / 255)} ${n(b / 255)}`;

export interface TextOptions {
  font?: FontName;
  size?: number;
  color?: Rgb;
  /** Where x is: the left edge (default), the right edge or the centre of the text. */
  align?: 'left' | 'right' | 'center';
}

export class PdfDocument {
  private readonly pages: string[][] = [];
  private current: string[] | null = null;

  constructor(private readonly info: { title: string; author?: string } = { title: 'Document' }) {}

  /** Start a new page; drawing goes to it until the next call. */
  addPage(): this {
    this.current = [];
    this.pages.push(this.current);
    return this;
  }

  private get ops(): string[] {
    if (!this.current) this.addPage();
    return this.current as string[];
  }

  text(x: number, y: number, text: string, options: TextOptions = {}): this {
    const { font = 'regular', size = 10, color: rgb = [17, 24, 39], align = 'left' } = options;
    const safe = pdfSafe(text);
    const width = textWidth(safe, font, size);
    const left = align === 'right' ? x - width : align === 'center' ? x - width / 2 : x;
    // y is the top of the line; PDF text sits on its baseline, about 0.8 em lower.
    const baseline = A4.height - y - size * 0.8;
    this.ops.push(
      `BT ${color(rgb)} rg /${FONT_RESOURCE[font]} ${n(size)} Tf ${n(left)} ${n(baseline)} Td (${escapeText(safe)}) Tj ET`,
    );
    return this;
  }

  line(
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    rgb: Rgb = [209, 213, 219],
    width = 1,
  ): this {
    this.ops.push(
      `${color(rgb)} RG ${n(width)} w ${n(x1)} ${n(A4.height - y1)} m ${n(x2)} ${n(A4.height - y2)} l S`,
    );
    return this;
  }

  rect(x: number, y: number, width: number, height: number, fill: Rgb): this {
    this.ops.push(
      `${color(fill)} rg ${n(x)} ${n(A4.height - y - height)} ${n(width)} ${n(height)} re f`,
    );
    return this;
  }

  get pageCount(): number {
    return this.pages.length;
  }

  /** The finished file. Every character is one byte, so string offsets are byte offsets. */
  toBytes(created: Date = new Date()): Uint8Array {
    if (this.pages.length === 0) this.addPage();
    const objects: string[] = [];
    const add = (body: string) => objects.push(body); // the object number: they start at 1

    const catalog = add('<< /Type /Catalog /Pages 2 0 R >>');
    const pagesIndex = objects.push('') - 1; // filled in once the kids are known
    const regular = add(
      '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
    );
    const bold = add(
      '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>',
    );
    const kids: number[] = [];
    for (const ops of this.pages) {
      const stream = ops.join('\n');
      const content = add(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
      kids.push(
        add(
          `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${A4.width} ${A4.height}] ` +
            `/Resources << /Font << /F1 ${regular} 0 R /F2 ${bold} 0 R >> >> /Contents ${content} 0 R >>`,
        ),
      );
    }
    objects[pagesIndex] =
      `<< /Type /Pages /Kids [${kids.map((k) => `${k} 0 R`).join(' ')}] /Count ${kids.length} >>`;
    const stamp = created.toISOString().replace(/[-:T]/g, '').slice(0, 14);
    const info = add(
      `<< /Title (${escapeText(pdfSafe(this.info.title))}) /Author (${escapeText(pdfSafe(this.info.author ?? ''))}) ` +
        `/Producer (Group Stay Quote Builder) /CreationDate (D:${stamp}Z) >>`,
    );

    let out = '%PDF-1.4\n%\xe2\xe3\xcf\xd3\n';
    const offsets: number[] = [];
    objects.forEach((body, i) => {
      offsets.push(out.length);
      out += `${i + 1} 0 obj\n${body}\nendobj\n`;
    });
    const xref = out.length;
    out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
    for (const offset of offsets) out += `${String(offset).padStart(10, '0')} 00000 n \n`;
    out += `trailer\n<< /Size ${objects.length + 1} /Root ${catalog} 0 R /Info ${info} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;

    const bytes = new Uint8Array(out.length);
    for (let i = 0; i < out.length; i++) bytes[i] = out.charCodeAt(i) & 0xff;
    return bytes;
  }
}
