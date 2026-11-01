import { createWriteStream, promises as fs } from 'fs';
import * as crypto from 'crypto';
import * as XLSX from 'xlsx';
import PDFDocument = require('pdfkit');
import { ColType, ReportColumn } from './report-types';
import { drawLine, registerFonts } from './pdf-text';

export type Locale = 'en' | 'ar';

export interface WriterInput {
  title: string;
  /** Visible columns only (money / PII already filtered by the runner). */
  columns: ReportColumn[];
  locale: Locale;
  /** Human-readable filter lines, e.g. "From: 2026-10-01". */
  parameterLines: string[];
  generatedAtCairo: string;
  generatedBy: string;
  /** Async iterator of row batches (already masked). */
  batches: () => AsyncGenerator<Array<Record<string, unknown>>>;
  totals: Record<string, number> | null;
  includeMinor: boolean;
  isCancelled: () => Promise<boolean>;
  onProgress: (rowsWritten: number) => Promise<void>;
}

export interface WriterResult {
  rowCount: number;
  bytes: number;
  checksum: string;
}

const label = (c: ReportColumn, locale: Locale) => (locale === 'ar' ? c.ar : c.en);
const YES = { en: 'Yes', ar: 'نعم' };
const NO = { en: 'No', ar: 'لا' };

/** A cell as TEXT (CSV / PDF). Money is a 2-decimal major-unit number; the database values are integer minor units. */
export function cellText(value: unknown, type: ColType, locale: Locale): string {
  if (value === null || value === undefined) return '';
  switch (type) {
    case 'money':
      return (Number(value) / 100).toFixed(2);
    case 'bool':
      return value ? YES[locale] : NO[locale];
    case 'percent':
    case 'int':
      return String(Number(value));
    default:
      return String(value);
  }
}

/**
 * CSV formula-injection guard: a cell that starts with = + - @ TAB or CR is prefixed with an apostrophe, so a spreadsheet can never run
 * user-entered text as a formula. (A legitimate negative NUMBER is exempt — it is a number, not text.)
 */
export function csvEscape(text: string, isNumber: boolean): string {
  let t = text;
  if (!isNumber && /^[=+\-@\t\r]/.test(t)) t = `'${t}`;
  return /[",\r\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
}

export async function writeCsv(file: string, input: WriterInput): Promise<WriterResult> {
  const out = createWriteStream(file, { flags: 'wx' });
  const hash = crypto.createHash('sha256');
  let bytes = 0;
  const write = (s: string) =>
    new Promise<void>((resolve, reject) => {
      const buf = Buffer.from(s, 'utf8');
      hash.update(buf);
      bytes += buf.length;
      out.write(buf, (e) => (e ? reject(e) : resolve()));
    });
  const cols = input.columns;
  const header: string[] = [];
  for (const c of cols) {
    header.push(csvEscape(label(c, input.locale), false));
    if (input.includeMinor && c.type === 'money') header.push(csvEscape(`${c.key}_minor`, false));
  }
  await write('﻿'); // UTF-8 BOM so Excel opens Arabic correctly
  await write(`${header.join(',')}\r\n`);
  let rows = 0;
  for await (const batch of input.batches()) {
    if (await input.isCancelled()) break;
    let chunk = '';
    for (const row of batch) {
      const cells: string[] = [];
      for (const c of cols) {
        const v = row[c.key];
        cells.push(csvEscape(cellText(v, c.type, input.locale), c.type === 'money' || c.type === 'int' || c.type === 'percent'));
        if (input.includeMinor && c.type === 'money') cells.push(v === null || v === undefined ? '' : String(Number(v)));
      }
      chunk += `${cells.join(',')}\r\n`;
      rows += 1;
    }
    await write(chunk);
    await input.onProgress(rows);
  }
  if (input.totals) {
    const cells: string[] = [];
    cols.forEach((c, i) => {
      const v = input.totals![c.key];
      cells.push(i === 0 ? csvEscape(input.locale === 'ar' ? 'الإجمالي' : 'Total', false) : v === undefined ? '' : csvEscape(cellText(v, c.type, input.locale), true));
      if (input.includeMinor && c.type === 'money') cells.push(v === undefined ? '' : String(v));
    });
    await write(`${cells.join(',')}\r\n`);
  }
  await new Promise<void>((resolve, reject) => out.end((e: Error | null | undefined) => (e ? reject(e) : resolve())));
  return { rowCount: rows, bytes, checksum: hash.digest('hex') };
}

/** XLSX via SheetJS: typed cells (money/number/text), frozen header, a Parameters sheet and a Definitions sheet; RTL view for Arabic. */
export async function writeXlsx(file: string, input: WriterInput, maxRows: number): Promise<WriterResult> {
  const cols = input.columns;
  const aoa: unknown[][] = [];
  const head: unknown[] = [];
  for (const c of cols) {
    head.push(label(c, input.locale));
    if (input.includeMinor && c.type === 'money') head.push(`${c.key}_minor`);
  }
  aoa.push(head);
  let rows = 0;
  for await (const batch of input.batches()) {
    if (await input.isCancelled()) break;
    for (const row of batch) {
      const line: unknown[] = [];
      for (const c of cols) {
        const v = row[c.key];
        if (v === null || v === undefined) line.push(null);
        else if (c.type === 'money') line.push(Number(v) / 100);
        else if (c.type === 'int' || c.type === 'percent') line.push(Number(v));
        else if (c.type === 'bool') line.push(v ? YES[input.locale] : NO[input.locale]);
        else line.push(/^[=+\-@]/.test(String(v)) ? `'${String(v)}` : String(v));
        if (input.includeMinor && c.type === 'money') line.push(v === null || v === undefined ? null : Number(v));
      }
      aoa.push(line);
      rows += 1;
      if (rows > maxRows) throw Object.assign(new Error('Too many rows for XLSX'), { code: 'EXPORT_TOO_LARGE' });
    }
    await input.onProgress(rows);
  }
  if (input.totals) {
    const line: unknown[] = [];
    cols.forEach((c, i) => {
      const v = input.totals![c.key];
      line.push(i === 0 ? (input.locale === 'ar' ? 'الإجمالي' : 'Total') : v === undefined ? null : c.type === 'money' ? v / 100 : v);
      if (input.includeMinor && c.type === 'money') line.push(v === undefined ? null : v);
    });
    aoa.push(line);
  }
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws['!cols'] = head.map((h) => ({ wch: Math.min(48, Math.max(10, String(h).length + 2)) }));
  // Frozen header row (supported by the SheetJS "sheet views" pane definition).
  (ws as any)['!freeze'] = { xSplit: 0, ySplit: 1 };
  // Money cells: 2-decimal number format.
  const moneyCols = new Set<number>();
  let idx = 0;
  for (const c of cols) {
    if (c.type === 'money') moneyCols.add(idx);
    idx += input.includeMinor && c.type === 'money' ? 2 : 1;
  }
  const range = XLSX.utils.decode_range(ws['!ref'] ?? 'A1');
  for (let r = 1; r <= range.e.r; r++) {
    for (const cIdx of moneyCols) {
      const cell = ws[XLSX.utils.encode_cell({ r, c: cIdx })];
      if (cell && typeof cell.v === 'number') cell.z = '#,##0.00';
    }
  }
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, input.locale === 'ar' ? 'البيانات' : 'Data');
  const params: unknown[][] = [[input.locale === 'ar' ? 'التقرير' : 'Report', input.title], [input.locale === 'ar' ? 'أُنشئ في (القاهرة)' : 'Generated (Cairo)', input.generatedAtCairo], [input.locale === 'ar' ? 'أنشأه' : 'Generated by', input.generatedBy], [], ...input.parameterLines.map((l) => [l])];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(params), input.locale === 'ar' ? 'المعايير' : 'Parameters');
  const defs: unknown[][] = [[input.locale === 'ar' ? 'العمود' : 'Column', input.locale === 'ar' ? 'النوع' : 'Type'], ...cols.map((c) => [label(c, input.locale), c.type === 'money' ? (input.locale === 'ar' ? 'مبلغ بالجنيه المصري (رقم بخانتين عشريتين)' : 'Amount in EGP (2 decimals)') : c.type])];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(defs), input.locale === 'ar' ? 'التعريفات' : 'Definitions');
  if (input.locale === 'ar') wb.Workbook = { Views: [{ RTL: true }] };
  const buffer: Buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx', compression: true });
  await fs.writeFile(file, buffer, { flag: 'wx' });
  return { rowCount: rows, bytes: buffer.length, checksum: crypto.createHash('sha256').update(buffer).digest('hex') };
}

/**
 * PDF (landscape A4) for statements and summaries: title, parameters, a paginated table, a totals row and page numbers. Arabic and
 * English are both laid out correctly (see pdf-text.ts); an Arabic report is a right-to-left table (first column at the right).
 */
export async function writePdf(file: string, input: WriterInput, maxRows: number): Promise<WriterResult> {
  const rtl = input.locale === 'ar';
  const doc: any = new PDFDocument({ size: 'A4', layout: 'landscape', margin: 36, bufferPages: true, info: { Title: input.title, Producer: 'Hatly', Creator: 'Hatly Admin' } });
  registerFonts(doc);
  const out = createWriteStream(file, { flags: 'wx' });
  const finished = new Promise<void>((resolve, reject) => {
    out.on('finish', () => resolve());
    out.on('error', reject);
  });
  doc.pipe(out);

  const left = 36;
  const right = doc.page.width - 36;
  const width = right - left;
  const cols = rtl ? [...input.columns].reverse() : input.columns;
  const fontSize = cols.length > 9 ? 7 : cols.length > 6 ? 8 : 9;
  const colWidth = width / cols.length;
  const rowHeight = fontSize + 8;

  const header = () => {
    drawLine(doc, 'Hatly', left, 30, width, { size: 16, bold: true, rtl, align: 'start', color: '#E0650A' });
    drawLine(doc, input.title, left, 52, width, { size: 13, bold: true, rtl, align: 'start', color: '#111111' });
    let y = 72;
    for (const line of [`${rtl ? 'أُنشئ في (القاهرة)' : 'Generated (Cairo)'}: ${input.generatedAtCairo}`, `${rtl ? 'أنشأه' : 'Generated by'}: ${input.generatedBy}`, ...input.parameterLines]) {
      drawLine(doc, line, left, y, width, { size: 8, rtl, align: 'start', color: '#555555' });
      y += 11;
    }
    return y + 6;
  };
  const tableHeader = (y: number) => {
    doc.save().rect(left, y - 3, width, rowHeight).fill('#F3F4F6').restore();
    cols.forEach((c, i) => drawLine(doc, label(c, input.locale), left + i * colWidth + 3, y, colWidth - 6, { size: fontSize, bold: true, rtl, align: 'start', color: '#111111' }));
    return y + rowHeight;
  };

  let y = tableHeader(header());
  let rows = 0;
  const bottom = doc.page.height - 50;
  for await (const batch of input.batches()) {
    if (await input.isCancelled()) break;
    for (const row of batch) {
      if (y + rowHeight > bottom) {
        doc.addPage();
        y = tableHeader(40);
      }
      cols.forEach((c, i) => {
        const text = cellText(row[c.key], c.type, input.locale);
        const numeric = c.type === 'money' || c.type === 'int' || c.type === 'percent';
        drawLine(doc, text, left + i * colWidth + 3, y, colWidth - 6, { size: fontSize, rtl, align: numeric ? (rtl ? 'start' : 'end') : 'start', color: '#222222' });
      });
      doc.save().moveTo(left, y + rowHeight - 3).lineTo(right, y + rowHeight - 3).lineWidth(0.25).strokeColor('#E5E7EB').stroke().restore();
      y += rowHeight;
      rows += 1;
      if (rows > maxRows) throw Object.assign(new Error('Too many rows for PDF'), { code: 'EXPORT_TOO_LARGE' });
    }
    await input.onProgress(rows);
  }
  if (input.totals) {
    if (y + rowHeight > bottom) {
      doc.addPage();
      y = 40;
    }
    cols.forEach((c, i) => {
      const t = input.totals![c.key];
      const text = c === input.columns[0] ? (rtl ? 'الإجمالي' : 'Total') : t === undefined ? '' : cellText(t, c.type, input.locale);
      drawLine(doc, text, left + i * colWidth + 3, y, colWidth - 6, { size: fontSize, bold: true, rtl, align: c === input.columns[0] ? 'start' : rtl ? 'start' : 'end', color: '#111111' });
    });
  }
  const range = doc.bufferedPageRange();
  for (let i = 0; i < range.count; i++) {
    doc.switchToPage(i);
    drawLine(doc, `${i + 1} / ${range.count}`, left, doc.page.height - 30, width, { size: 8, rtl, align: 'center', color: '#777777' });
  }
  doc.end();
  await finished;
  const buffer = await fs.readFile(file);
  return { rowCount: rows, bytes: buffer.length, checksum: crypto.createHash('sha256').update(buffer).digest('hex') };
}
