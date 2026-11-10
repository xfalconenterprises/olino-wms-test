import type { Worksheet } from 'exceljs';
import { formatDate, formatDateTime, istDateKey } from '../../../utils/format';
import { allowsDecimals, unitName, uomOf } from '../../../utils/units';

type CellValue = string | number | Date | null | undefined;

export interface ExportColumn {
  key: string;
  header: string;
  /** Used on the Fabric sheet when rolls need a different word from packs. */
  fabricHeader?: string;
  value: (row: any) => CellValue;
  kind?: 'quantity' | 'date' | 'long';
  /** Always in the file, so it is not offered as a choice. */
  required?: boolean;
}

export const SHEETS = [
  { type: 'FABRIC', name: 'Fabric', tabColor: 'FF0284C7' },
  { type: 'READY_MADE', name: 'Readymade', tabColor: 'FF16A34A' },
  { type: 'ACCESSORY', name: 'Accessories', tabColor: 'FF7C3AED' },
];

export const headerOf = (column: ExportColumn, type: string) => (type === 'FABRIC' && column.fabricHeader) || column.header;

const unitColumn: ExportColumn = { key: 'unit', header: 'Unit', required: true, value: r => unitName(uomOf(r)) };
// The secret cost code (as on the label), and the value as code, sent only to Cost Prices holders
const costColumns: ExportColumn[] = [
  { key: 'costCode', header: 'Cost Code', value: r => r.costCode },
  { key: 'valueCode', header: 'Value (code)', value: r => r.valueCode },
];

export const SKU_EXPORT_COLUMNS: ExportColumn[] = [
  { key: 'brand', header: 'Brand', value: r => r.brand },
  { key: 'quality', header: 'Quality', value: r => r.quality },
  { key: 'qualityName', header: 'Quality Name', value: r => r.qualityName },
  { key: 'shade', header: 'Shade / Color', value: r => r.shade },
  { key: 'category', header: 'Category', value: r => r.category },
  { key: 'size', header: 'Size', value: r => r.size },
  { key: 'name', header: 'Item Name', value: r => r.name },
  { key: 'artNo', header: 'Article No', value: r => r.artNo },
  { key: 'quantity', header: 'Total Quantity', kind: 'quantity', required: true, value: r => r.totalQuantity },
  unitColumn,
  ...costColumns,
  { key: 'lumps', header: 'Packs', fabricHeader: 'Lumps', value: r => r.activeBatches },
  { key: 'full', header: 'Full Packs', fabricHeader: 'Full Rolls', value: r => r.fullRollsCount || 0 },
  { key: 'partial', header: 'Partial Packs', fabricHeader: 'Partial Rolls', value: r => r.partialRollsCount || 0 },
  { key: 'locations', header: 'Warehouse Locations', kind: 'long', value: r => (r.locations || []).join(', ') },
];

const STATUS_NAMES: Record<string, string> = { IN_STOCK: 'In Stock', PARTIALLY_USED: 'Partially Used', QC_HOLD: 'QC Hold' };

export const ROLL_EXPORT_COLUMNS: ExportColumn[] = [
  { key: 'batchCode', header: 'Batch / Barcode', required: true, value: r => r.batchCode },
  { key: 'brand', header: 'Brand', value: r => r.brand },
  { key: 'quality', header: 'Quality', value: r => r.quality },
  { key: 'qualityName', header: 'Quality Name', value: r => r.qualityName },
  { key: 'shade', header: 'Shade / Color', value: r => r.shade },
  { key: 'category', header: 'Category', value: r => r.category },
  { key: 'size', header: 'Size', value: r => r.size },
  { key: 'name', header: 'Item Name', value: r => r.name },
  { key: 'artNo', header: 'Article No', value: r => r.artNo },
  { key: 'quantity', header: 'Quantity', kind: 'quantity', required: true, value: r => r.quantity },
  unitColumn,
  ...costColumns,
  { key: 'status', header: 'Status', value: r => STATUS_NAMES[r.status] ?? r.status },
  { key: 'location', header: 'Shelf Location', kind: 'long', value: r => (r.batchLocations || []).filter((l: any) => l.quantity > 0).map((l: any) => l.location?.code).join(', ') || 'Unassigned' },
  { key: 'client', header: 'Client', value: r => r.clientName },
  { key: 'bundle', header: 'Supplier Bundle', value: r => r.supplierBundle },
  { key: 'invoice', header: 'Invoice Ref', value: r => r.invoiceRef },
  { key: 'poNumber', header: 'PO Number', value: r => r.poLine?.po?.poNumber },
  { key: 'supplier', header: 'Supplier', value: r => r.poLine?.po?.supplierName },
  // A real date, so Excel sorts it properly; the cell format keeps it DD-MM-YYYY on any PC
  { key: 'received', header: 'Received Date', kind: 'date', value: r => new Date(`${istDateKey(new Date(r.createdAt))}T00:00:00.000Z`) },
];

const BRAND = 'FF6B21A8';
const BRAND_LIGHT = 'FFEDE9FE';
const STRIPE = 'FFF9FAFB';
const BORDER = 'FFE5E7EB';
const MUTED = 'FF6B7280';
const line = { style: 'thin' as const, color: { argb: BORDER } };
const borders = { top: line, bottom: line, left: line, right: line };
const fill = (argb: string) => ({ type: 'pattern' as const, pattern: 'solid' as const, fgColor: { argb } });
const quantityFormat = (decimals: boolean) => (decimals ? '#,##0.00' : '#,##0');
const isBlank = (v: CellValue) => v === null || v === undefined || v === '';
const cellText = (c: ExportColumn, v: CellValue) => (c.kind === 'date' && v instanceof Date ? formatDate(v) : String(v ?? ''));

function fillSheet(sheet: Worksheet, sheetName: string, heading: string, note: string, columns: ExportColumn[], rows: any[], valueTotal?: string) {
  sheet.addRow([`Olino · ${sheetName} Stock`]).getCell(1).font = { size: 16, bold: true, color: { argb: BRAND } };
  const summary = `${heading} · ${rows.length} ${rows.length === 1 ? 'row' : 'rows'} · Exported ${formatDateTime(new Date())} IST`;
  sheet.addRow([summary]).getCell(1).font = { size: 10, color: { argb: MUTED } };
  if (note) sheet.addRow([`Filtered by: ${note}`]).getCell(1).font = { size: 10, color: { argb: MUTED } };
  sheet.addRow([]);

  const header = sheet.addRow(columns.map(c => c.header));
  header.height = 24;
  header.eachCell(cell => {
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = fill(BRAND);
    cell.border = borders;
    cell.alignment = { vertical: 'middle' };
  });

  rows.forEach((row, i) => {
    const added = sheet.addRow(columns.map(c => c.value(row) ?? null));
    columns.forEach((c, n) => {
      const cell = added.getCell(n + 1);
      cell.border = borders;
      cell.alignment = { vertical: 'middle', wrapText: c.kind === 'long' };
      if (i % 2) cell.fill = fill(STRIPE);
      if (c.kind === 'quantity') cell.numFmt = quantityFormat(allowsDecimals(uomOf(row)));
      if (c.kind === 'date') cell.numFmt = 'dd-mm-yyyy';
    });
  });

  const headerAt = header.number;
  const firstRow = headerAt + 1, lastRow = headerAt + rows.length;

  // One total per unit: meters and kilograms are never added together. They are formulas, so
  // they follow the filter buttons; the saved result shows before editing is enabled.
  const quantityAt = columns.findIndex(c => c.kind === 'quantity');
  const unitAt = columns.findIndex(c => c.key === 'unit');
  if (quantityAt >= 0) {
    const totals = new Map<string, { sum: number; decimals: boolean }>();
    for (const row of rows) {
      const unit = String(columns[unitAt].value(row));
      const total = totals.get(unit) ?? { sum: 0, decimals: false };
      total.sum += Number(columns[quantityAt].value(row)) || 0;
      total.decimals ||= allowsDecimals(uomOf(row));
      totals.set(unit, total);
    }
    totals.forEach(({ sum, decimals }, unit) => {
      const added = sheet.addRow([]);
      columns.forEach((_, n) => {
        const cell = added.getCell(n + 1);
        cell.font = { bold: true };
        cell.fill = fill(BRAND_LIGHT);
        cell.border = borders;
      });
      if (quantityAt > 0) added.getCell(1).value = 'Total';
      const q = sheet.getColumn(quantityAt + 1).letter, u = sheet.getColumn(unitAt + 1).letter;
      const amounts = `${q}${firstRow}:${q}${lastRow}`;
      const formula = totals.size === 1
        ? `SUBTOTAL(109,${amounts})`
        : `SUMPRODUCT(SUBTOTAL(109,OFFSET(${q}${firstRow},ROW(${amounts})-ROW(${q}${firstRow}),0,1)),--(${u}${firstRow}:${u}${lastRow}="${unit}"))`;
      added.getCell(quantityAt + 1).value = { formula, result: Math.round(sum * 100) / 100 };
      added.getCell(quantityAt + 1).numFmt = quantityFormat(decimals);
      added.getCell(unitAt + 1).value = unit;
    });
  }

  // The sheet's stock value as code (Cost Prices holders only): every row of the sheet, not just the filtered ones
  const valueAt = columns.findIndex(c => c.key === 'valueCode');
  if (valueTotal && valueAt >= 0) {
    const added = sheet.addRow([]);
    columns.forEach((_, n) => {
      const cell = added.getCell(n + 1);
      cell.font = { bold: true };
      cell.fill = fill(BRAND_LIGHT);
      cell.border = borders;
    });
    if (valueAt > 0) added.getCell(1).value = 'Total value (code)';
    added.getCell(valueAt + 1).value = valueTotal;
  }

  columns.forEach((c, n) => {
    const longest = Math.max(c.header.length, ...rows.map(r => cellText(c, c.value(r)).length));
    sheet.getColumn(n + 1).width = Math.min(44, Math.max(11, longest + 3));
  });

  sheet.views = [{ state: 'frozen', ySplit: headerAt, showGridLines: false }];
  sheet.autoFilter = { from: { row: headerAt, column: 1 }, to: { row: lastRow, column: columns.length } };
  sheet.pageSetup = { paperSize: 9, orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0, printTitlesRow: `${headerAt}:${headerAt}` };
  sheet.headerFooter.oddFooter = '&LOlino&RPage &P of &N';
}

/**
 * The stock export: one styled sheet per item type. A sheet leaves out any chosen column that
 * has nothing in it for that item type. An item type with no rows, or no columns from
 * `columnsFor`, gets no sheet at all.
 */
export async function buildStockWorkbook({ heading, note, columnsFor, rows, typeOf, valueTotals }: {
  heading: string;
  note: string;
  columnsFor: (type: string) => ExportColumn[];
  rows: any[];
  typeOf: (row: any) => string;
  /** Value as code per item type, for Cost Prices holders */
  valueTotals?: Record<string, string>;
}): Promise<ArrayBuffer> {
  // Loaded only when someone exports: the library is far larger than the rest of this screen
  const library: any = await import('exceljs');
  const { Workbook } = library.default ?? library;
  const workbook = new Workbook();
  workbook.creator = 'Olino WMS';

  for (const { type, name, tabColor } of SHEETS) {
    const sheetRows = rows.filter(r => typeOf(r) === type);
    const filled = columnsFor(type)
      .filter(c => sheetRows.some(r => !isBlank(c.value(r))))
      .map(c => ({ ...c, header: headerOf(c, type) }));
    if (!sheetRows.length || !filled.length) continue;
    fillSheet(workbook.addWorksheet(name, { properties: { tabColor: { argb: tabColor } } }), name, heading, note, filled, sheetRows, valueTotals?.[type]);
  }
  if (!workbook.worksheets.length) throw new Error('The chosen columns have nothing to export.');
  return workbook.xlsx.writeBuffer();
}
