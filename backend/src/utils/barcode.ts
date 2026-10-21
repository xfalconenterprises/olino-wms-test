import bwipjs from 'bwip-js';
import { crc32 } from 'node:zlib';

// Location barcodes handed to label designers. Code 128 with a narrow bar (X) of 0.375 mm,
// exactly 3 dots on a 203 dpi printer, and a 10-bar quiet zone on each side built in.
// Designers may change the height freely but should keep the width at 100%.
export const BARCODE_X_MM = 0.375;
export const BARCODE_HEIGHT_MM = 15;
const QUIET_ZONE_MODULES = 10;
const PNG_PX_PER_MODULE = 9;                                        // 9 px per 0.375 mm
const PNG_DPI = (PNG_PX_PER_MODULE / BARCODE_X_MM) * 25.4;         // 609.6 dpi
const PNG_PX_PER_METER = Math.round((PNG_PX_PER_MODULE / BARCODE_X_MM) * 1000); // 24000

/** Vector barcode with its real printed size (width/height in mm). */
export function code128Svg(text: string): string {
  const svg = bwipjs.toSVG({
    bcid: 'code128',
    text,
    scale: 1, // one viewBox unit per bar module
    height: BARCODE_HEIGHT_MM,
    paddingwidth: QUIET_ZONE_MODULES,
    includetext: false,
  });
  const viewBox = /viewBox="0 0 ([\d.]+) ([\d.]+)"/.exec(svg);
  if (!viewBox) throw new Error('Unexpected barcode SVG output');
  const widthMm = +(Number(viewBox[1]) * BARCODE_X_MM).toFixed(3);
  // preserveAspectRatio="none" lets the height change without touching bar widths
  return svg.replace(
    '<svg ',
    `<svg width="${widthMm}mm" height="${BARCODE_HEIGHT_MM}mm" preserveAspectRatio="none" `
  );
}

/** High-resolution PNG barcode; its DPI is stored in the file so it places at the real size. */
export async function code128Png(text: string): Promise<Buffer> {
  const png = await bwipjs.toBuffer({
    bcid: 'code128',
    text,
    scale: PNG_PX_PER_MODULE,
    // bwip-js heights are in points before scaling: convert the target mm at PNG_DPI
    height: (BARCODE_HEIGHT_MM * PNG_DPI) / (72 * PNG_PX_PER_MODULE),
    paddingwidth: QUIET_ZONE_MODULES,
    includetext: false,
  });
  return withPngResolution(png, PNG_PX_PER_METER);
}

// Inserts a pHYs chunk (pixels per metre) right after the PNG header chunk
function withPngResolution(png: Buffer, pxPerMeter: number): Buffer {
  const type = Buffer.from('pHYs', 'ascii');
  const data = Buffer.alloc(9);
  data.writeUInt32BE(pxPerMeter, 0);
  data.writeUInt32BE(pxPerMeter, 4);
  data.writeUInt8(1, 8); // unit: metre
  const chunk = Buffer.alloc(21);
  chunk.writeUInt32BE(data.length, 0);
  type.copy(chunk, 4);
  data.copy(chunk, 8);
  chunk.writeUInt32BE(crc32(Buffer.concat([type, data])), 17);
  const afterHeader = 8 + 25; // PNG signature + IHDR chunk
  return Buffer.concat([png.subarray(0, afterHeader), chunk, png.subarray(afterHeader)]);
}
