import * as path from 'path';

/**
 * Arabic / Latin text for PDF exports (pdfkit).
 *
 * pdfkit shapes Arabic correctly (joining letters, via fontkit) but does NOT run the Unicode bidirectional algorithm: mixed
 * Arabic/Latin/number lines come out in the wrong visual order, Eastern-Arabic digits are laid out reversed, and the Naskh font has no
 * Latin punctuation. This helper therefore (1) normalises digits and separators to Latin, (2) splits a line into words classified
 * Arabic vs other, (3) orders the groups visually for the paragraph's base direction, and (4) draws every word with the right font.
 * Each Arabic word is handed to pdfkit on its own, which shapes it. Verified by rendering a mixed sample to an image in the test suite.
 */
const ARABIC = /[؀-ۿݐ-ݿࢠ-ࣿﭐ-﷿ﹰ-﻿]/;
const ARABIC_DIGITS = '٠١٢٣٤٥٦٧٨٩';

export const FONT_DIR = process.env.PDF_FONT_DIR ?? path.join(process.cwd(), 'assets', 'fonts');
export const FONTS = {
  latin: path.join(FONT_DIR, 'NotoSans-Regular.ttf'),
  latinBold: path.join(FONT_DIR, 'NotoSans-Bold.ttf'),
  arabic: path.join(FONT_DIR, 'NotoNaskhArabic-Regular.ttf'),
  arabicBold: path.join(FONT_DIR, 'NotoNaskhArabic-Bold.ttf'),
};

export function normaliseDigits(text: string): string {
  return text
    .replace(/[٠-٩]/g, (c) => String(ARABIC_DIGITS.indexOf(c)))
    .replace(/٫/g, '.')
    .replace(/٬/g, ',');
}

export interface Word {
  text: string;
  rtl: boolean;
}

/** Splits a word that mixes scripts into script runs (an Arabic name glued to digits, for example), in LOGICAL order. */
function scriptRuns(word: string): Word[] {
  const out: Word[] = [];
  for (const ch of word) {
    const rtl = ARABIC.test(ch) || /[ً-ٰٟ]/.test(ch);
    const last = out[out.length - 1];
    if (last && last.rtl === rtl) last.text += ch;
    else out.push({ text: ch, rtl });
  }
  return out;
}

/** Words of a line in VISUAL left-to-right order for the given base direction. */
export function visualWords(raw: string, baseRtl: boolean): Word[] {
  // Brackets are not mirrored by the shaper, so in a right-to-left paragraph they are dropped rather than drawn the wrong way round.
  const text = (baseRtl ? normaliseDigits(raw).replace(/[()]/g, '') : normaliseDigits(raw)).replace(/\s+/g, ' ').trim();
  if (!text) return [];
  const logical: Word[] = [];
  for (const w of text.split(' ')) {
    const runs = scriptRuns(w);
    // A word that contains Arabic letters is an RTL word: its runs read right-to-left.
    const hasArabic = runs.some((r) => r.rtl);
    const ordered = hasArabic ? [...runs].reverse() : runs;
    ordered.forEach((r, i) => logical.push({ text: r.text, rtl: hasArabic ? r.rtl : false, ...(i > 0 ? { glue: true } : {}) } as Word));
  }
  // Group consecutive words of the same direction; reverse the words inside RTL groups; reverse group order for an RTL paragraph.
  const groups: Word[][] = [];
  for (const w of logical) {
    const g = groups[groups.length - 1];
    if (g && g[0].rtl === w.rtl) g.push(w);
    else groups.push([w]);
  }
  const shaped = groups.map((g) => (g[0].rtl ? [...g].reverse() : g));
  const arranged = baseRtl ? [...shaped].reverse() : shaped;
  return arranged.flat();
}

export interface PdfDocLike {
  font(name: string): PdfDocLike;
  fontSize(size: number): PdfDocLike;
  widthOfString(text: string): number;
  text(text: string, x: number, y: number, options?: Record<string, unknown>): PdfDocLike;
  fillColor(color: string): PdfDocLike;
}

export function registerFonts(doc: any): void {
  doc.registerFont('latin', FONTS.latin);
  doc.registerFont('latin-bold', FONTS.latinBold);
  doc.registerFont('arabic', FONTS.arabic);
  doc.registerFont('arabic-bold', FONTS.arabicBold);
}

function fontFor(word: Word, bold: boolean): string {
  return word.rtl ? (bold ? 'arabic-bold' : 'arabic') : bold ? 'latin-bold' : 'latin';
}

export function measure(doc: PdfDocLike, text: string, size: number, bold: boolean, baseRtl: boolean): number {
  const words = visualWords(text, baseRtl);
  if (words.length === 0) return 0;
  doc.font(bold ? 'latin-bold' : 'latin').fontSize(size);
  const space = doc.widthOfString(' ');
  let total = 0;
  for (const w of words) {
    doc.font(fontFor(w, bold)).fontSize(size);
    total += doc.widthOfString(w.text);
  }
  return total + space * (words.length - 1);
}

/** Truncates (with an ellipsis) so the line fits `maxWidth`. Works on logical words so Arabic is never cut mid-shape. */
export function fit(doc: PdfDocLike, text: string, maxWidth: number, size: number, bold: boolean, baseRtl: boolean): string {
  const clean = normaliseDigits(text ?? '').replace(/\s+/g, ' ').trim();
  if (measure(doc, clean, size, bold, baseRtl) <= maxWidth) return clean;
  const words = clean.split(' ');
  while (words.length > 1) {
    words.pop();
    const candidate = `${words.join(' ')}…`;
    if (measure(doc, candidate, size, bold, baseRtl) <= maxWidth) return candidate;
  }
  let w = words[0] ?? '';
  while (w.length > 1) {
    w = w.slice(0, -1);
    if (measure(doc, `${w}…`, size, bold, baseRtl) <= maxWidth) return `${w}…`;
  }
  return '…';
}

/** Draws one line inside [x, x+width]. `align` 'start' means left for LTR paragraphs and right for RTL ones. */
export function drawLine(doc: PdfDocLike, text: string, x: number, y: number, width: number, opts: { size: number; bold?: boolean; rtl: boolean; align?: 'start' | 'end' | 'center'; color?: string }): void {
  const bold = Boolean(opts.bold);
  const line = fit(doc, text, width, opts.size, bold, opts.rtl);
  if (!line) return;
  const words = visualWords(line, opts.rtl);
  doc.font(bold ? 'latin-bold' : 'latin').fontSize(opts.size);
  const space = doc.widthOfString(' ');
  const total = measure(doc, line, opts.size, bold, opts.rtl);
  const align = opts.align ?? 'start';
  const toLeft = align === 'center' ? true : (align === 'start') !== opts.rtl; // start+LTR or end+RTL → hugs the left edge
  let cursor = align === 'center' ? x + (width - total) / 2 : toLeft ? x : x + width - total;
  if (opts.color) doc.fillColor(opts.color);
  for (const w of words) {
    doc.font(fontFor(w, bold)).fontSize(opts.size);
    const ww = doc.widthOfString(w.text);
    doc.text(w.text, cursor, y, { lineBreak: false });
    cursor += ww + space;
  }
}
