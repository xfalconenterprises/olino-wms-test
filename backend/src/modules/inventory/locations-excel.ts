import ExcelJS from 'exceljs';
import { formatDate } from '../../utils/format';

// The location list as an Excel sheet with each location's QR code as a picture, ready to print or
// to hand to the label designer. Goes into the locations ZIP beside the separate QR files.

export interface LocationQrRow { code: string; type: 'RACK' | 'FLOOR'; rack: string; bay: string; level: string; position: string; qr: Buffer }

const QR_PX = 100;          // picture size in the sheet (about 26 mm)
const ROW_HEIGHT_PT = 84;   // room for the picture

export async function locationsQrWorkbook(rows: LocationQrRow[], title: string): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Olino WMS';
  const sheet = workbook.addWorksheet('Locations', { properties: { tabColor: { argb: 'FF4F46E5' } } });

  // Only the columns that have something in them (floor spots have no rack, bay, level or position)
  const all: { header: string; key: keyof LocationQrRow; width: number }[] = [
    { header: 'Location Code', key: 'code', width: 22 },
    { header: 'Type', key: 'type', width: 10 },
    { header: 'Rack', key: 'rack', width: 10 },
    { header: 'Bay', key: 'bay', width: 8 },
    { header: 'Level', key: 'level', width: 8 },
    { header: 'Position', key: 'position', width: 10 },
  ];
  const columns = all.filter(c => rows.some(r => r[c.key]));
  const qrCol = columns.length + 1;

  sheet.addRow([`Olino · ${title}`]).font = { bold: true, size: 14, color: { argb: 'FF4F46E5' } };
  sheet.addRow([`${rows.length} locations · made ${formatDate(new Date())} · each QR code holds its location code`]).font = { color: { argb: 'FF6B7280' } };
  sheet.addRow([]);
  const header = sheet.addRow([...columns.map(c => c.header), 'QR Code']);
  header.eachCell(c => {
    c.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF4F46E5' } };
    c.alignment = { vertical: 'middle', horizontal: 'center' };
  });
  const headerAt = header.number;
  columns.forEach((c, n) => { sheet.getColumn(n + 1).width = c.width; });
  sheet.getColumn(qrCol).width = 17;

  rows.forEach((r, i) => {
    const row = sheet.addRow(columns.map(c => (c.key === 'type' ? (r.type === 'RACK' ? 'Rack' : 'Floor') : r[c.key] as string)));
    row.height = ROW_HEIGHT_PT;
    row.eachCell({ includeEmpty: true }, c => { c.alignment = { vertical: 'middle', horizontal: 'center' }; });
    row.getCell(1).font = { bold: true, size: 14 };
    const image = workbook.addImage({ buffer: r.qr as unknown as ExcelJS.Buffer, extension: 'png' });
    // Centred in its cell (column and row positions count from 0)
    sheet.addImage(image, { tl: { col: qrCol - 1 + 0.15, row: headerAt + i + 0.08 }, ext: { width: QR_PX, height: QR_PX }, editAs: 'oneCell' });
  });

  sheet.views = [{ state: 'frozen', ySplit: headerAt }];
  sheet.pageSetup = { paperSize: 9, orientation: 'portrait', fitToPage: true, fitToWidth: 1, fitToHeight: 0, printTitlesRow: `${headerAt}:${headerAt}` };
  sheet.headerFooter.oddFooter = '&LOlino locations&RPage &P of &N';
  return Buffer.from(await workbook.xlsx.writeBuffer());
}
