import bwipjs from 'bwip-js';
import { companyLogoDataUri, escapeHtml } from './html';

// A4 print layout shared by return documents, matching the delivery challan's look.
// Every value is escaped here, so callers pass plain text.
//
// Documents never print a field that was not entered: an empty value leaves its cell blank,
// a column nobody filled in is left off, and an empty header detail is not shown.

/** Header details worth printing: label/value pairs whose value was entered. */
export function filledMeta<T extends [string, string | null | undefined]>(pairs: T[]): [string, string][] {
  return pairs.filter(([, v]) => v !== null && v !== undefined && String(v).trim() !== '') as [string, string][];
}

export interface TableColumn<T> {
  header: string;
  cell: (row: T, index: number) => string | number | null | undefined;  // plain text, escaped here
  align?: 'left' | 'right' | 'center';
  width?: string;
  bold?: boolean;
  optional?: boolean;   // left off when no row has a value
  total?: string;       // footer value (plain text)
}

/**
 * Head, body and footer rows of a document table. Optional columns that no row filled in are
 * dropped; the footer label spans the columns before the first total.
 */
export function documentTable<T>(columns: TableColumn<T>[], rows: T[], totalLabel = 'TOTAL'): { head: string; body: string; foot: string } {
  const text = (v: unknown) => (v === null || v === undefined ? '' : String(v).trim());
  const shown = columns.filter(c => !c.optional || rows.some((r, i) => text(c.cell(r, i)) !== ''));
  const align = (c: TableColumn<T>) => `text-align: ${c.align ?? 'left'};`;

  const head = `<tr>${shown.map(c => `<th style="${align(c)}${c.width ? ` width: ${c.width};` : ''}">${escapeHtml(c.header)}</th>`).join('')}</tr>`;
  const body = rows.map((r, i) => `<tr>${shown.map(c =>
    `<td style="${align(c)}${c.bold ? ' font-weight: bold;' : ''}">${escapeHtml(text(c.cell(r, i)))}</td>`).join('')}</tr>`).join('');

  const first = shown.findIndex(c => c.total !== undefined);
  const foot = first < 0 ? '' : `<tr style="font-weight: bold; background: #f9f9f9; border-top: 2px solid #000; border-bottom: 2px solid #000;">${
    first > 0 ? `<td colspan="${first}" style="text-align: right; padding: 8px;">${escapeHtml(totalLabel)}:</td>` : ''}${
    shown.slice(first).map(c => `<td style="${align(c)} padding: 8px;">${escapeHtml(c.total ?? '')}</td>`).join('')}</tr>`;
  return { head, body, foot };
}

export interface PrintColumn { header: string; align?: 'left' | 'right' | 'center'; width?: string; optional?: boolean }

export interface PrintDocument {
  title: string;                    // e.g. "Return to Supplier"
  number: string;                   // e.g. "SR-26-0001", also printed as a barcode
  meta: [string, string | null | undefined][];  // label/value pairs, two per row; empty ones are left off
  columns: PrintColumn[];
  rows: string[][];
  totalLabel?: string;
  totalValue?: string;
  note?: string;                    // printed under the table
  signatures: string[];             // e.g. ["Prepared By", "Checked By", "Received By (Supplier)"]
}

export async function renderPrintDocument(doc: PrintDocument): Promise<string> {
  const logo = companyLogoDataUri();
  let barcode = '';
  try {
    const png = await bwipjs.toBuffer({ bcid: 'code128', text: doc.number, scale: 3, height: 12, includetext: true, textxalign: 'center', textsize: 10 });
    barcode = `data:image/png;base64,${png.toString('base64')}`;
  } catch (err) {
    console.error('Barcode generation failed for', doc.number, err);
  }

  const meta = filledMeta(doc.meta);
  const metaRows: string[] = [];
  for (let i = 0; i < meta.length; i += 2) {
    const cells = meta.slice(i, i + 2)
      .map(([label, value]) => `<td class="meta-label">${escapeHtml(label)}:</td><td><strong>${escapeHtml(value)}</strong></td>`)
      .join('');
    metaRows.push(`<tr>${cells}</tr>`);
  }

  const last = doc.columns.length - 1;
  const table = documentTable<string[]>(doc.columns.map((c, i) => ({
    ...c, cell: row => row[i], total: doc.totalValue && i === last ? doc.totalValue : undefined,
  })), doc.rows, doc.totalLabel);
  const signs = doc.signatures
    .map(s => `<td class="sign-cell"><div class="sign-line"></div><div class="sign-title">${escapeHtml(s)}</div><div class="sign-sub">Signature &amp; Date</div></td>`)
    .join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<title>${escapeHtml(doc.number)} — ${escapeHtml(doc.title)}</title>
<style>
  @page { size: A4 portrait; margin: 10mm 12mm; }
  *, *::before, *::after { box-sizing: border-box; }
  html, body { height: 100%; margin: 0; padding: 0; }
  body { font-family: Arial, Helvetica, sans-serif; background: #f1f5f9; color: #000; font-size: 11px; line-height: 1.35; display: flex; justify-content: center; }
  .wrapper { width: 100%; max-width: 210mm; min-height: 275mm; margin: 10px auto; padding: 10mm 12mm; background: #fff; box-shadow: 0 2px 12px rgba(0,0,0,0.08); display: flex; flex-direction: column; }
  .content-top { flex: 1 0 auto; }
  .header { display: flex; justify-content: space-between; align-items: center; border-bottom: 2px solid #000; padding-bottom: 12px; margin-bottom: 14px; }
  .logo-img { max-height: 52px; max-width: 200px; object-fit: contain; }
  .title-block { text-align: right; }
  .doc-title { font-size: 12px; font-weight: bold; text-transform: uppercase; letter-spacing: 1px; }
  .doc-number { font-size: 20px; font-weight: bold; margin: 2px 0; }
  .meta-table { width: 100%; border-collapse: collapse; margin-bottom: 16px; font-size: 11.5px; }
  .meta-table td { padding: 4px 6px; vertical-align: top; }
  .meta-label { width: 120px; font-weight: bold; }
  table.data-table { width: 100%; border-collapse: collapse; margin-bottom: 14px; font-size: 11px; }
  table.data-table th, table.data-table td { border: 1px solid #000; padding: 6px 8px; }
  table.data-table th { font-size: 10.5px; }
  .note { font-size: 10.5px; margin-bottom: 10px; }
  .bottom-section { margin-top: auto; page-break-inside: avoid; }
  .sign-table { width: 100%; margin: 30px 0 16px; border-collapse: collapse; }
  .sign-cell { text-align: center; padding-top: 8px; }
  .sign-line { width: 140px; margin: 0 auto 8px; border-top: 1px solid #000; }
  .sign-title { font-weight: bold; margin-bottom: 2px; }
  .sign-sub { font-size: 9.5px; color: #444; }
  .footer { padding-top: 8px; border-top: 1px solid #000; text-align: center; font-size: 10px; line-height: 1.4; }
  @media print { body { background: transparent; } .wrapper { margin: 0; padding: 0; box-shadow: none; max-width: 100%; } }
</style>
</head>
<body>
  <div class="wrapper">
    <div class="content-top">
      <div class="header">
        <div>${logo ? `<img src="${logo}" alt="Olino Uniforms" class="logo-img" />` : '<div style="font-size:20px;font-weight:bold;">OLINO UNIFORMS</div>'}</div>
        <div class="title-block">
          <div class="doc-title">${escapeHtml(doc.title)}</div>
          <div class="doc-number">${escapeHtml(doc.number)}</div>
          ${barcode ? `<img src="${barcode}" alt="" style="height:42px;object-fit:contain;" />` : ''}
        </div>
      </div>
      <table class="meta-table">${metaRows.join('')}</table>
      <table class="data-table"><thead>${table.head}</thead><tbody>${table.body}</tbody>${table.foot ? `<tfoot>${table.foot}</tfoot>` : ''}</table>
      ${doc.note ? `<div class="note">${escapeHtml(doc.note)}</div>` : ''}
    </div>
    <div class="bottom-section">
      <table class="sign-table"><tr>${signs}</tr></table>
      <div class="footer">
        <div>17/362, Depot, Near Railway Station, Nilambur, Malappuram Dist., Pin: 679330 | Phone: +91 7902 833 334</div>
        <div>GSTIN: 32BOJPJ7259C1Z1</div>
      </div>
    </div>
  </div>
</body>
</html>`;
}
