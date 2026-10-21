// Excel import for the Direct Inward Desk. Each item type has a fixed set of columns that mirror
// the manual entry form; a file is accepted only when every row is valid, otherwise it is rejected
// with the list of problems. Each imported row is one item with its total quantity, which is then
// received lump by lump.
import { readXlsxFirstSheet, writeXlsx, type Cell } from './xlsx';

export type InwardItemType = 'FABRIC' | 'READY_MADE' | 'ACCESSORY';

export const ITEM_TYPE_LABEL: Record<InwardItemType, string> = {
  FABRIC: 'Fabric',
  READY_MADE: 'Ready-Made',
  ACCESSORY: 'Accessories',
};

interface Choice { value: string; label: string; aliases?: string[] }

interface ColumnDef {
  key: string;
  header: string;
  required: boolean;
  kind: 'text' | 'quantity' | 'choice';
  choices?: Choice[];
  wholeNumber?: boolean;
  note: string;
  width: number;
}

const FABRIC_CATEGORIES: Choice[] = [
  { value: 'SUITING', label: 'Suiting' },
  { value: 'SHIRTING', label: 'Shirting' },
  { value: 'PLAIN_SHIRTING', label: 'Plain Shirting' },
  { value: 'OTHER', label: 'Other', aliases: ['Other Fabric'] },
];

const ACCESSORY_UOMS: Choice[] = [
  { value: 'PCS', label: 'Pcs', aliases: ['Pieces', 'Piece', 'Nos'] },
  { value: 'GROSS', label: 'Gross' },
  { value: 'BOXES', label: 'Boxes', aliases: ['Box'] },
  { value: 'METERS', label: 'Meters', aliases: ['Meter', 'Mtr', 'Mtrs', 'M'] },
  { value: 'PACKETS', label: 'Packets', aliases: ['Packet', 'Pkt', 'Pkts'] },
];

const text = (key: string, header: string, required: boolean, note: string, width = 18): ColumnDef =>
  ({ key, header, required, kind: 'text', note, width });

export const IMPORT_COLUMNS: Record<InwardItemType, ColumnDef[]> = {
  FABRIC: [
    { key: 'category', header: 'Category', required: true, kind: 'choice', choices: FABRIC_CATEGORIES, note: 'Suiting, Shirting, Plain Shirting or Other', width: 16 },
    text('brand', 'Brand', true, 'e.g. Raymond, Siyaram'),
    text('quality', 'Quality', true, 'e.g. Poly Viscose'),
    text('shade', 'Shade', true, 'e.g. Navy Blue 04'),
    { key: 'quantity', header: 'Total Meters', required: true, kind: 'quantity', note: 'Total meters of this item in the delivery, e.g. 520.5', width: 14 },
    text('bundle', 'Bundle Number', false, 'Optional, e.g. B-101', 16),
    text('notes', 'Remarks', false, 'Optional', 24),
  ],
  READY_MADE: [
    text('name', 'Item Name', true, 'e.g. Boys Half Sleeve Shirt', 26),
    text('fabricType', 'Fabric Type', false, 'Optional, e.g. Poly Cotton'),
    text('shade', 'Shade', false, 'Optional, e.g. White'),
    text('artNo', 'Art No', true, 'e.g. ART-2041', 14),
    text('size', 'Size', true, 'e.g. 32, M, XL', 10),
    { key: 'quantity', header: 'Total Pieces', required: true, kind: 'quantity', wholeNumber: true, note: 'Whole number of pieces, e.g. 240', width: 14 },
    text('bundle', 'Bundle Number', false, 'Optional, e.g. Carton 4', 16),
    text('notes', 'Remarks', false, 'Optional', 24),
  ],
  ACCESSORY: [
    text('category', 'Category', true, 'e.g. Buttons, Zippers', 16),
    text('name', 'Item Name', true, 'e.g. 24L 4-Hole Navy Button', 28),
    text('spec', 'Spec / Size', false, 'Optional, e.g. 24L, 7 inch', 14),
    text('shade', 'Shade', false, 'Optional, e.g. Navy Blue', 14),
    { key: 'uom', header: 'UOM', required: true, kind: 'choice', choices: ACCESSORY_UOMS, note: 'Pcs, Gross, Boxes, Meters or Packets', width: 10 },
    { key: 'quantity', header: 'Total Quantity', required: true, kind: 'quantity', note: 'Total quantity in the UOM above, e.g. 5000', width: 14 },
    text('bundle', 'Packet / Box Number', false, 'Optional, e.g. Pkt 3', 18),
    text('notes', 'Remarks', false, 'Optional', 24),
  ],
};

const MAX_ROWS = 1000;
const MAX_TEXT = 120;
const MAX_ERRORS = 50;

export interface ImportLine {
  id: string;
  itemType: InwardItemType;
  rowNumber: number;               // row in the spreadsheet, for messages
  fields: Record<string, string>;  // normalised values keyed by column key
  quantity: number;                // total to receive
  uom: string;
  received: number;
  lumps: number;
}

export interface ImportResult {
  lines: ImportLine[];
  errors: string[];
}

const normaliseHeader = (h: string) => h.toLowerCase().replace(/[^a-z0-9]/g, '');

const cellText = (value: Cell | undefined): string =>
  value === null || value === undefined ? '' : String(value).trim();

function matchChoice(choices: Choice[], raw: string): string | null {
  const wanted = normaliseHeader(raw);
  const found = choices.find(c =>
    [c.value, c.label, ...(c.aliases ?? [])].some(option => normaliseHeader(option) === wanted));
  return found ? found.value : null;
}

function parseQuantity(value: Cell | undefined): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const s = cellText(value).replace(/,/g, '');
  if (!/^\d+(\.\d+)?$/.test(s)) return null;
  return Number(s);
}

// Which item type's columns does this header row belong to (for a helpful rejection)?
function guessItemType(headers: string[]): InwardItemType | null {
  const keys = headers.map(normaliseHeader).filter(Boolean);
  return (Object.keys(IMPORT_COLUMNS) as InwardItemType[]).find(type => {
    const known = new Set(IMPORT_COLUMNS[type].map(c => normaliseHeader(c.header)));
    return keys.length > 0 && keys.every(k => known.has(k));
  }) ?? null;
}

let lineCounter = 0;

/** Checks a sheet against the item type's columns. Any problem rejects the whole file. */
export function validateImportRows(itemType: InwardItemType, rows: Cell[][]): ImportResult {
  const columns = IMPORT_COLUMNS[itemType];
  const label = ITEM_TYPE_LABEL[itemType];
  const errors: string[] = [];
  const reject = (): ImportResult => ({
    lines: [],
    errors: errors.length > MAX_ERRORS ? [...errors.slice(0, MAX_ERRORS), `…and ${errors.length - MAX_ERRORS} more problems`] : errors,
  });

  const headerIndex = rows.findIndex(r => r.some(c => cellText(c) !== ''));
  if (headerIndex < 0) {
    errors.push('The sheet is empty.');
    return reject();
  }
  const headers = rows[headerIndex].map(cellText);

  // Header row: only this type's columns, each once, and every required one present
  const byHeader = new Map(columns.map(c => [normaliseHeader(c.header), c]));
  const positions = new Map<string, number>();
  const unknown: string[] = [];
  headers.forEach((h, i) => {
    if (!h) return;
    const col = byHeader.get(normaliseHeader(h));
    if (!col) unknown.push(h);
    else if (positions.has(col.key)) errors.push(`Column "${col.header}" appears more than once.`);
    else positions.set(col.key, i);
  });
  if (unknown.length > 0) {
    const other = guessItemType(headers);
    errors.push(other && other !== itemType
      ? `This looks like a ${ITEM_TYPE_LABEL[other]} sheet. Select ${ITEM_TYPE_LABEL[other]} before importing, or use the ${label} template.`
      : `Column${unknown.length > 1 ? 's' : ''} ${unknown.map(u => `"${u}"`).join(', ')} ${unknown.length > 1 ? 'are' : 'is'} not part of the ${label} template.`);
  }
  const missing = columns.filter(c => c.required && !positions.has(c.key)).map(c => `"${c.header}"`);
  if (missing.length > 0) errors.push(`Missing required column${missing.length > 1 ? 's' : ''}: ${missing.join(', ')}.`);
  if (errors.length > 0) {
    errors.push(`Expected columns for ${label}: ${columns.map(c => c.header + (c.required ? ' *' : '')).join(', ')}.`);
    return reject();
  }

  // Data rows
  const lines: ImportLine[] = [];
  const dataRows = rows.slice(headerIndex + 1);
  const filled = dataRows.filter(r => r.some(c => cellText(c) !== '')).length;
  if (filled === 0) errors.push('The sheet has a header row but no items.');
  if (filled > MAX_ROWS) errors.push(`The sheet has ${filled} items; import at most ${MAX_ROWS} at a time.`);
  if (errors.length > 0) return reject();

  dataRows.forEach((row, offset) => {
    if (!row.some(c => cellText(c) !== '')) return;
    const rowNumber = headerIndex + offset + 2; // spreadsheet rows are 1-based, after the header
    const fields: Record<string, string> = {};
    let quantity = 0;
    let rowOk = true;
    const problem = (msg: string) => { errors.push(`Row ${rowNumber}: ${msg}`); rowOk = false; };

    for (const col of columns) {
      const pos = positions.get(col.key);
      const raw = pos === undefined ? undefined : row[pos];
      const value = cellText(raw);
      if (!value) {
        if (col.required) problem(`${col.header} is empty.`);
        continue;
      }
      if (col.kind === 'quantity') {
        const n = parseQuantity(raw);
        if (n === null || n <= 0) problem(`${col.header} must be a number above 0 (found "${value}").`);
        else if (col.wholeNumber && !Number.isInteger(n)) problem(`${col.header} must be a whole number (found ${value}).`);
        else quantity = Math.round(n * 1000) / 1000;
      } else if (col.kind === 'choice') {
        const choice = matchChoice(col.choices!, value);
        if (!choice) problem(`${col.header} "${value}" is not valid. Use ${col.choices!.map(c => c.label).join(', ')}.`);
        else fields[col.key] = choice;
      } else if (value.length > MAX_TEXT) {
        problem(`${col.header} is longer than ${MAX_TEXT} characters.`);
      } else {
        fields[col.key] = value;
      }
    }

    if (rowOk) {
      lines.push({
        id: `imp-${Date.now()}-${++lineCounter}`,
        itemType,
        rowNumber,
        fields,
        quantity,
        uom: itemType === 'FABRIC' ? 'METERS' : itemType === 'READY_MADE' ? 'PCS' : fields.uom,
        received: 0,
        lumps: 0,
      });
    }
  });

  return errors.length > 0 ? reject() : { lines, errors: [] };
}

// Small CSV reader (quoted fields, commas, CRLF) for sheets saved as .csv
function parseCsv(textContent: string): Cell[][] {
  const rows: Cell[][] = [];
  let row: Cell[] = [];
  let field = '';
  let quoted = false;
  const s = textContent.replace(/^﻿/, '');
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (quoted) {
      if (ch === '"' && s[i + 1] === '"') { field += '"'; i++; }
      else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { row.push(field); field = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && s[i + 1] === '\n') i++;
      row.push(field); rows.push(row); row = []; field = '';
    } else field += ch;
  }
  if (field !== '' || row.length > 0) { row.push(field); rows.push(row); }
  return rows;
}

/** Reads an uploaded .xlsx (first sheet) or .csv file into rows. */
export async function readImportFile(file: File): Promise<Cell[][]> {
  const name = file.name.toLowerCase();
  if (name.endsWith('.csv')) return parseCsv(await file.text());
  if (name.endsWith('.xls')) throw new Error('Old .xls files are not supported. In Excel, use File → Save As → Excel Workbook (.xlsx).');
  return readXlsxFirstSheet(file);
}

/** Template workbook: the item sheet with headers, plus a sheet explaining each column. */
export function buildImportTemplate(itemType: InwardItemType): Blob {
  const columns = IMPORT_COLUMNS[itemType];
  return writeXlsx([
    {
      name: `${ITEM_TYPE_LABEL[itemType]} Items`,
      rows: [columns.map(c => c.header)],
      columnWidths: columns.map(c => c.width),
      boldHeader: true,
    },
    {
      name: 'How to fill',
      rows: [
        ['Column', 'Required', 'What to enter'],
        ...columns.map(c => [c.header, c.required ? 'Yes' : 'No', c.note]),
        [],
        ['One row per item with its total quantity. Lumps are entered in the WMS after importing.'],
        ['Keep the column titles exactly as they are. Do not add other columns.'],
      ],
      columnWidths: [20, 10, 60],
      boldHeader: true,
    },
  ]);
}

export function remainingQty(line: ImportLine): number {
  return Math.max(0, Math.round((line.quantity - line.received) * 1000) / 1000);
}

export function unitLabel(uom: string): string {
  return ({ METERS: 'm', PCS: 'pcs', GROSS: 'gross', BOXES: 'boxes', PACKETS: 'packets' } as Record<string, string>)[uom] ?? uom.toLowerCase();
}

/** The item's own columns, in template order (quantity, unit, bundle and remarks are shown separately). */
export function itemFieldColumns(itemType: InwardItemType): { key: string; header: string }[] {
  return IMPORT_COLUMNS[itemType]
    .filter(c => c.kind !== 'quantity' && !['uom', 'bundle', 'notes'].includes(c.key))
    .map(c => ({ key: c.key, header: c.header }));
}

/** A field as people read it: choice codes become their labels (PLAIN_SHIRTING → Plain Shirting). */
export function fieldValue(line: ImportLine, key: string): string {
  const value = line.fields[key] ?? '';
  const col = IMPORT_COLUMNS[line.itemType].find(c => c.key === key);
  return col?.choices?.find(c => c.value === value)?.label ?? value;
}

/** Body for POST /api/batches for one lump of an imported line (same fields as manual entry). */
export function lumpPayload(line: ImportLine, quantity: number, bundle: string) {
  const f = line.fields;
  const common = {
    itemType: line.itemType,
    quantity,
    uom: line.uom,
    supplierBundle: bundle.trim() || undefined,
    notes: f.notes || undefined,
  };
  if (line.itemType === 'FABRIC') {
    return { ...common, category: f.category, brand: f.brand, quality: f.quality, shade: f.shade };
  }
  if (line.itemType === 'READY_MADE') {
    return { ...common, name: f.name, category: f.fabricType || undefined, shade: f.shade || undefined, artNo: f.artNo.toUpperCase(), size: f.size };
  }
  return { ...common, category: f.category, name: f.name, brand: f.category, size: f.spec || undefined, shade: f.shade || undefined };
}
