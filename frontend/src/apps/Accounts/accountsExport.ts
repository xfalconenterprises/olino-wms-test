import type { Worksheet } from 'exceljs';
import { formatDate, formatDateTime } from '../../utils/format';
import { allowsDecimals, fabricCategoryLabel, unitName } from '../../utils/units';
import type { LumpAtCost, RollAtCost, Valuation, ValuedItem } from './shared';

/** Where a lump or pack came from: its PO number, Direct Inward or a customer return. */
export const originText = (r: Pick<RollAtCost, 'origin' | 'poNumber'>) =>
  r.origin === 'PO' ? r.poNumber ?? 'PO' : r.origin === 'RETURN' ? 'Customer Return' : 'Direct Inward';

// Stock at cost as an Excel file, in rupees: a summary sheet, then one sheet per item type.

export const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

// Rupees with Indian grouping (12,34,56,789.00)
const RUPEES = '[>=10000000]"₹"##\\,##\\,##\\,##0.00;[>=100000]"₹"##\\,##\\,##0.00;"₹"#,##0.00';
const BRAND = 'FF4F46E5';
const BRAND_LIGHT = 'FFEEF2FF';
const fill = (argb: string) => ({ type: 'pattern' as const, pattern: 'solid' as const, fgColor: { argb } });
const thin = { style: 'thin' as const, color: { argb: 'FFD1D5DB' } };
const borders = { top: thin, left: thin, bottom: thin, right: thin };

const SHEETS = [
  { type: 'FABRIC', name: 'Fabric' },
  { type: 'READY_MADE', name: 'Readymade' },
  { type: 'ACCESSORY', name: 'Accessories' },
];

interface Column { header: string; value: (i: ValuedItem) => string | number | null; money?: boolean; quantity?: boolean }

const ITEM_COLUMNS: Column[] = [
  { header: 'Category', value: i => (i.itemType === 'FABRIC' ? fabricCategoryLabel(i.category) : i.category) },
  { header: 'Brand', value: i => i.brand },
  { header: 'Quality', value: i => i.quality },
  { header: 'Quality Name', value: i => i.qualityName },
  { header: 'Item Name', value: i => i.name },
  { header: 'Art No', value: i => i.artNo },
  { header: 'Size', value: i => i.size },
  { header: 'Shade / Color', value: i => i.shade },
  { header: 'Unit', value: i => unitName(i.uom) },
  { header: 'Quantity', value: i => i.quantity, quantity: true },
  { header: 'Rolls / Packs', value: i => i.rolls },
  { header: 'Without Cost', value: i => i.rollsWithoutCost || null },
  { header: 'Cost / Unit', value: i => i.costPerUnit, money: true },
  { header: 'Lowest Cost / Unit', value: i => i.lowestCost ?? null, money: true },
  { header: 'Highest Cost / Unit', value: i => i.highestCost ?? null, money: true },
  { header: 'Average Cost / Unit', value: i => i.averageCost, money: true },
  { header: 'Value', value: i => i.value || null, money: true },
];

const blank = (v: unknown) => v === null || v === undefined || v === '';

function title(sheet: Worksheet, heading: string, note: string, width: number) {
  sheet.addRow([`Olino · ${heading}`]).font = { bold: true, size: 14, color: { argb: BRAND } };
  sheet.addRow([note]).font = { italic: true, color: { argb: 'FF6B7280' } };
  sheet.addRow([`Made ${formatDateTime(new Date())} · Confidential`]).font = { color: { argb: 'FF6B7280' } };
  sheet.addRow([]);
  if (width > 1) sheet.mergeCells(1, 1, 1, width);
}

function headerRow(sheet: Worksheet, headers: string[]) {
  const row = sheet.addRow(headers);
  row.eachCell(c => { c.font = { bold: true, color: { argb: 'FFFFFFFF' } }; c.fill = fill(BRAND); c.border = borders; });
  return row.number;
}

function totalRow(sheet: Worksheet, width: number, label: string, cells: Record<number, { formula: string; result: number }>) {
  const row = sheet.addRow([]);
  for (let n = 1; n <= width; n++) {
    const cell = row.getCell(n);
    cell.font = { bold: true };
    cell.fill = fill(BRAND_LIGHT);
    cell.border = borders;
  }
  row.getCell(1).value = label;
  for (const [col, value] of Object.entries(cells)) {
    row.getCell(Number(col)).value = value;
    row.getCell(Number(col)).numFmt = RUPEES;
  }
}

/** An extra line on the summary sheet: label, amount, and whether it is rupees. */
export type SummaryLine = [string, number, boolean];

function summarySheet(sheet: Worksheet, data: Valuation, heading: string, note: string, typeName: (t: string) => string, extra: SummaryLine[]) {
  title(sheet, heading, note, 5);
  const t = data.totals;
  for (const [label, value, money] of [
    ['Stock value at cost', t.value, true], ['Rolls / packs with a cost', t.costedRolls, false], ['Rolls / packs without a cost (not in the value)', t.rollsWithoutCost, false],
    ...extra,
  ] as SummaryLine[]) {
    const row = sheet.addRow([label, value]);
    row.getCell(1).font = { bold: true };
    if (money) { row.getCell(2).numFmt = RUPEES; row.getCell(2).font = { bold: true }; }
  }
  sheet.addRow([]);

  const first = headerRow(sheet, ['Item Type', 'Rolls / Packs', 'Without Cost', 'Value']) + 1;
  for (const g of data.byType) {
    const row = sheet.addRow([typeName(g.itemType), g.rolls, g.rollsWithoutCost || null, g.value]);
    row.eachCell({ includeEmpty: true }, c => { c.border = borders; });
    row.getCell(4).numFmt = RUPEES;
  }
  const last = sheet.lastRow!.number;
  totalRow(sheet, 4, 'Total', { 4: { formula: `SUM(D${first}:D${last})`, result: t.value } });

  [44, 16, 14, 20].forEach((w, n) => { sheet.getColumn(n + 1).width = w; });
  sheet.views = [{ showGridLines: false }];
}

/** The columns with something in them; on the Fabric sheet the category is the Fabric Type. */
const columnsFor = (items: ValuedItem[], type: string) => ITEM_COLUMNS
  .filter(c => items.some(i => !blank(c.value(i))))
  .map(c => (type === 'FABRIC' && c.header === 'Category' ? { ...c, header: 'Fabric Type' } : c));

function itemSheet(sheet: Worksheet, items: ValuedItem[], type: string, heading: string, note: string) {
  const columns = columnsFor(items, type);
  title(sheet, heading, note, columns.length);
  const headerAt = headerRow(sheet, columns.map(c => c.header));
  for (const item of items) {
    const row = sheet.addRow(columns.map(c => c.value(item)));
    columns.forEach((c, n) => {
      const cell = row.getCell(n + 1);
      cell.border = borders;
      if (c.money) cell.numFmt = RUPEES;
      if (c.quantity) cell.numFmt = allowsDecimals(item.uom) ? '#,##0.00' : '#,##0';
    });
  }
  const lastRow = sheet.lastRow!.number;
  const valueAt = columns.findIndex(c => c.header === 'Value');
  if (valueAt >= 0) {
    const letter = sheet.getColumn(valueAt + 1).letter;
    totalRow(sheet, columns.length, 'Total', {
      [valueAt + 1]: { formula: `SUBTOTAL(109,${letter}${headerAt + 1}:${letter}${lastRow})`, result: Math.round(items.reduce((s, i) => s + i.value, 0) * 100) / 100 },
    });
  }
  columns.forEach((c, n) => {
    const longest = Math.max(c.header.length, ...items.map(i => String(c.value(i) ?? '').length + (c.money ? 6 : 0)));
    sheet.getColumn(n + 1).width = Math.min(40, Math.max(11, longest + 3));
  });
  sheet.views = [{ state: 'frozen', ySplit: headerAt, showGridLines: false }];
  sheet.autoFilter = { from: { row: headerAt, column: 1 }, to: { row: lastRow, column: columns.length } };
  sheet.pageSetup = { paperSize: 9, orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0, printTitlesRow: `${headerAt}:${headerAt}` };
}

// ─── Every lump or pack with its cost ───────────────────────────────────────

interface LumpColumn { header: string; value: (r: LumpAtCost) => string | number | Date | null; money?: boolean; quantity?: boolean; date?: boolean }

const STATUS_NAME: Record<string, [string, string]> = { IN_STOCK: ['Full', 'In stock'], PARTIALLY_USED: ['Cut', 'Part used'], QC_HOLD: ['QC Hold', 'QC Hold'] };

const lumpColumns = (type: string): LumpColumn[] => [
  { header: type === 'ACCESSORY' ? 'Category' : 'Fabric Type', value: r => (type === 'FABRIC' ? fabricCategoryLabel(r.category) : r.category) },
  { header: 'Brand', value: r => r.brand },
  { header: type === 'ACCESSORY' ? 'Spec' : 'Quality', value: r => r.quality },
  { header: 'Quality Name', value: r => r.qualityName },
  { header: 'Item Name', value: r => r.name },
  { header: 'Art No', value: r => r.artNo },
  { header: 'Size', value: r => r.size },
  { header: 'Shade / Color', value: r => r.shade },
  { header: 'SKU Code', value: r => r.batchCode },
  { header: 'PO / Source', value: r => originText(r) },
  { header: 'Bundle No', value: r => r.bundle },
  { header: 'Status', value: r => (r.status ? STATUS_NAME[r.status]?.[type === 'FABRIC' ? 0 : 1] ?? r.status : null) },
  { header: 'Shelf', value: r => r.shelves.join(', ') },
  { header: 'Unit', value: r => unitName(r.uom) },
  { header: 'Quantity', value: r => r.quantity, quantity: true },
  { header: 'Cost / Unit', value: r => r.costPrice, money: true },
  { header: 'Value', value: r => r.value, money: true },
  { header: 'Inward Date', value: r => (r.receivedAt ? formatDate(r.receivedAt) : null) },
  { header: 'Supplier', value: r => r.supplierName },
  { header: 'Invoice', value: r => r.invoiceRef },
];

function lumpSheet(sheet: Worksheet, rolls: LumpAtCost[], type: string, heading: string, note: string): string[] {
  const columns = lumpColumns(type).filter(c => rolls.some(r => !blank(c.value(r))));
  title(sheet, heading, note, columns.length);
  const headerAt = headerRow(sheet, columns.map(c => c.header));
  const costAt = columns.findIndex(c => c.header === 'Cost / Unit');
  for (const roll of rolls) {
    const row = sheet.addRow(columns.map(c => c.value(roll)));
    columns.forEach((c, n) => {
      const cell = row.getCell(n + 1);
      cell.border = borders;
      if (c.money) cell.numFmt = RUPEES;
      if (c.quantity) cell.numFmt = allowsDecimals(roll.uom) ? '#,##0.00' : '#,##0';
    });
    if (roll.costPrice === null && costAt >= 0) row.getCell(costAt + 1).value = 'No cost';
  }
  const lastRow = sheet.lastRow!.number;
  const valueAt = columns.findIndex(c => c.header === 'Value');
  if (valueAt >= 0) {
    const letter = sheet.getColumn(valueAt + 1).letter;
    totalRow(sheet, columns.length, 'Total', {
      [valueAt + 1]: { formula: `SUBTOTAL(109,${letter}${headerAt + 1}:${letter}${lastRow})`, result: Math.round(rolls.reduce((s, r) => s + (r.value ?? 0), 0) * 100) / 100 },
    });
  }
  columns.forEach((c, n) => {
    const longest = Math.max(c.header.length, ...rolls.slice(0, 2000).map(r => String(c.value(r) ?? '').length + (c.money ? 6 : 0)));
    sheet.getColumn(n + 1).width = Math.min(36, Math.max(10, longest + 3));
  });
  sheet.views = [{ state: 'frozen', ySplit: headerAt, showGridLines: false }];
  sheet.autoFilter = { from: { row: headerAt, column: 1 }, to: { row: lastRow, column: columns.length } };
  sheet.pageSetup = { paperSize: 9, orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0, printTitlesRow: `${headerAt}:${headerAt}` };
  return columns.map(c => c.header);
}

const LUMP_SHEETS: Record<string, string> = { FABRIC: 'Fabric Lumps', READY_MADE: 'Readymade Packs', ACCESSORY: 'Accessory Packs' };

/** The workbook, and the headers of each sheet for the export log. */
export async function buildValuationWorkbook(data: Valuation, heading: string, note: string, extra: SummaryLine[] = [], lumps?: LumpAtCost[]): Promise<{ file: ArrayBuffer; columns: Record<string, string[]> }> {
  // Loaded only when someone exports: the library is far larger than these screens
  const library: any = await import('exceljs');
  const { Workbook } = library.default ?? library;
  const workbook = new Workbook();
  workbook.creator = 'Olino WMS';
  const typeName = (t: string) => SHEETS.find(s => s.type === t)?.name ?? t;
  const columns: Record<string, string[]> = {};

  summarySheet(workbook.addWorksheet('Summary'), data, heading, note, typeName, extra);
  columns.Summary = ['Item Type', 'Value'];
  for (const { type, name } of SHEETS) {
    const items = data.items.filter(i => i.itemType === type);
    if (!items.length) continue;
    const sheet = workbook.addWorksheet(name);
    itemSheet(sheet, items, type, `${heading} · ${name}`, note);
    columns[name] = columnsFor(items, type).map(c => c.header);
  }
  // Then every lump or pack, one sheet per item type
  for (const { type } of SHEETS) {
    const rolls = lumps?.filter(r => r.itemType === type) ?? [];
    if (!rolls.length) continue;
    const name = LUMP_SHEETS[type];
    columns[name] = lumpSheet(workbook.addWorksheet(name), rolls, type, `${heading} · ${name}`, note);
  }
  return { file: await workbook.xlsx.writeBuffer(), columns };
}
