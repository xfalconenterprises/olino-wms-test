import { Router, Request, Response } from 'express';
import bwipjs from 'bwip-js';
import QRCode from 'qrcode';
import { formatDate } from '../../utils/format';
import { escapeHtml } from '../../utils/html';
import prisma from '../../lib/prisma';

const router = Router();

// Labels are public — barcode/QR images are opened via window.open() in the browser
// and cannot carry Authorization headers. Batch codes are not sensitive data.

// GET /api/labels/preview/:batchCode
// Returns visual 100mm x 50mm HTML sticker preview with company logo, 1D barcode, QR, and specs
router.get('/preview/:batchCode', async (req: Request, res: Response) => {
  const batchCode = req.params.batchCode as string;
  const { quantity, isRemainder } = req.query;
  try {
    const batch = await prisma.itemBatch.findUnique({
      where: { batchCode },
      include: {
        poLine: {
          include: {
            po: true
          }
        }
      }
    });

    if (!batch) {
      res.status(404).json({ error: 'Batch not found' });
      return;
    }

    if (quantity !== undefined && !isNaN(Number(quantity))) {
      batch.quantity = Number(quantity);
    }
    if (isRemainder !== undefined) {
      (batch as any).isRemainder = isRemainder === 'true';
    }

    const barcodePng = await bwipjs.toBuffer({
      bcid: 'code128',
      text: batchCode,
      scale: 1.8,
      height: 12,
      includetext: true,
      textxalign: 'center',
      textsize: 9,
    } as any);
    const barcodeBase64 = `data:image/png;base64,${barcodePng.toString('base64')}`;

    let qrBase64 = '';
    try {
      qrBase64 = await QRCode.toDataURL(batchCode, { margin: 1, width: 100 });
    } catch (_) {}

    const itemType = batch.itemType || 'FABRIC';
    const isFabric = itemType === 'FABRIC';

    // Format short UOM: "M" for fabric/meters, "PCS", "PAIRS", etc.
    const rawUom = (batch.uom || '').toUpperCase().trim();
    let uomShort = 'M';
    if (isFabric || rawUom === 'METERS' || rawUom === 'METER' || rawUom === 'M') {
      uomShort = 'M';
    } else if (rawUom === 'PCS' || rawUom === 'PIECES' || rawUom === 'PIECE' || itemType === 'READY_MADE') {
      uomShort = 'PCS';
    } else if (rawUom) {
      uomShort = rawUom;
    }
    
    const brand = escapeHtml((batch.brand || '').trim());
    const quality = escapeHtml((batch.quality || batch.category || '').trim());
    const shade = escapeHtml((batch.shade || '').trim());
    const name = escapeHtml((batch.name || '').trim());
    const artNo = escapeHtml((batch.artNo || '').trim());
    const size = escapeHtml((batch.size || '').trim());
    const safeCode = escapeHtml(batchCode);

    // Order received date (DD-MM-YYYY in IST)
    const dateFormatted = formatDate(batch.createdAt || new Date());

    let specsHtml = '';
    if (isFabric) {
      specsHtml = `
        <div><strong>BRAND:</strong> ${brand || '—'}</div>
        <div><strong>QUAL:</strong> ${quality || '—'}</div>
        <div><strong>SHADE:</strong> ${shade || '—'}</div>
      `;
    } else if (itemType === 'READY_MADE') {
      specsHtml = `
        <div style="font-weight: 800; font-size: 11.5px; color: #0f172a; margin-bottom: 2px;">${name || 'GARMENT'}</div>
        <div><strong>ART:</strong> ${artNo || '—'}</div>
        <div><strong>SIZE:</strong> ${size || '—'}</div>
      `;
    } else {
      specsHtml = `
        <div style="font-weight: 800; font-size: 11.5px; color: #0f172a; margin-bottom: 2px;">${name || 'ACCESSORY'}</div>
        <div><strong>SPEC:</strong> ${quality || '—'}</div>
        <div><strong>SIZE:</strong> ${size || '—'}</div>
      `;
    }

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>Label — ${safeCode}</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: Arial, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, monospace;
      background: #f1f5f9;
      display: flex;
      justify-content: center;
      align-items: center;
      min-height: 100vh;
      padding: 24px;
    }
    .label-sticker {
      width: 100mm;
      height: 50mm;
      background: #ffffff;
      border: 2px solid #0f172a;
      border-radius: 4px;
      padding: 3mm 4.5mm;
      box-shadow: 0 8px 24px rgba(0,0,0,0.12);
      display: flex;
      flex-direction: column;
      justify-content: space-between;
      color: #000000;
      user-select: none;
    }
    .top-bar {
      display: flex;
      justify-content: space-between;
      align-items: center;
      border-bottom: 2px solid #000;
      padding-bottom: 1.5mm;
    }
    .top-brand {
      font-size: 14px;
      font-weight: 900;
      letter-spacing: 0.5px;
      color: #000;
    }
    .top-badge {
      font-size: 11px;
      font-weight: 700;
      color: #334155;
      font-family: monospace;
    }
    .mid-section {
      display: grid;
      grid-template-columns: minmax(130px, 1.4fr) auto auto;
      align-items: center;
      gap: 12px;
      padding: 1.5mm 0;
    }
    .specs-area {
      font-size: 11px;
      line-height: 1.45;
      font-family: Arial, sans-serif;
      font-weight: 600;
    }
    .specs-area strong {
      color: #000;
    }
    .qty-box {
      text-align: center;
      padding: 0 4px;
    }
    .qty-label {
      font-size: 9px;
      font-weight: 700;
      color: #475569;
      letter-spacing: 0.5px;
    }
    .qty-val {
      font-size: 18px;
      font-weight: 900;
      white-space: nowrap;
    }
    .qr-area {
      flex-shrink: 0;
    }
    .qr-area img {
      width: 46px;
      height: 46px;
      display: block;
      border: 1px solid #000;
      padding: 1px;
    }
    .bottom-bar {
      border-top: 2px solid #000;
      padding-top: 1.5mm;
      text-align: center;
    }
    .barcode-img {
      max-width: 90%;
      height: 38px;
      display: block;
      margin: 0 auto;
    }
    @media print {
      body { background: transparent; padding: 0; min-height: auto; }
      .label-sticker { box-shadow: none; border: none; width: 100mm; height: 50mm; margin: 0; page-break-inside: avoid; }
    }
  </style>
</head>
<body>
  <div class="label-sticker">
    <!-- Zone 1: Top Bar (Native Text Logo & Date Received) -->
    <div class="top-bar">
      <div class="top-brand">OLINO UNIFORMS</div>
      <span class="top-badge">REC: ${dateFormatted}</span>
    </div>

    <!-- Zone 2: Middle Section (Specs + Big Quantity + QR) -->
    <div class="mid-section">
      <div class="specs-area">
        ${specsHtml}
      </div>

      <div class="qty-box">
        <div class="qty-label">${Boolean((batch as any).isRemainder || batch.status === 'PARTIALLY_USED') ? 'REMAINDER' : 'ROLL QTY'}</div>
        <div class="qty-val">${batch.quantity} ${escapeHtml(uomShort)}</div>
      </div>

      <div class="qr-area">
        ${qrBase64 ? `<img src="${qrBase64}" alt="QR" />` : ''}
      </div>
    </div>

    <!-- Zone 3: Bottom Barcode -->
    <div class="bottom-bar">
      <img src="${barcodeBase64}" alt="${safeCode}" class="barcode-img" />
    </div>
  </div>
</body>
</html>`;

    res.set('Content-Type', 'text/html');
    res.send(html);
  } catch (err) {
    console.error('Label preview error:', err);
    res.status(500).json({ error: 'Failed to generate preview' });
  }
});

export default router;
