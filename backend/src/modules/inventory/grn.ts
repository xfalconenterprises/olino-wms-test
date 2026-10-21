import { Router, Request, Response } from 'express';
import prisma from '../../lib/prisma';
import { requireAuth, requirePermission } from '../../middleware/auth';
import bwipjs from 'bwip-js';
import { formatDate } from '../../utils/format';
import { escapeHtml, companyLogoDataUri } from '../../utils/html';

const router = Router();

// GET /api/grn — List all Goods Receipt Notes
router.get('/', requireAuth, requirePermission('inv.grn', 'ops.entry_gate', 'po.view'), async (req: Request, res: Response) => {
  try {
    const { search, supplierId, startDate, endDate, limit, offset } = req.query;

    const where: any = {};

    if (supplierId) {
      where.supplierId = String(supplierId);
    }

    if (search) {
      const q = String(search).trim();
      where.OR = [
        { grnNumber: { contains: q, mode: 'insensitive' } },
        { supplierName: { contains: q, mode: 'insensitive' } },
        { invoiceRef: { contains: q, mode: 'insensitive' } },
        { poNumber: { contains: q, mode: 'insensitive' } },
      ];
    }

    if (startDate || endDate) {
      where.createdAt = {};
      if (startDate) {
        where.createdAt.gte = new Date(String(startDate) + 'T00:00:00.000Z');
      }
      if (endDate) {
        where.createdAt.lte = new Date(String(endDate) + 'T23:59:59.999Z');
      }
    }

    const take = limit ? Math.min(200, parseInt(String(limit), 10) || 50) : 50;
    const skip = offset ? parseInt(String(offset), 10) || 0 : 0;

    const [total, grns] = await Promise.all([
      prisma.goodsReceiptNote.count({ where }),
      prisma.goodsReceiptNote.findMany({
        where,
        include: {
          supplier: { select: { id: true, code: true, name: true } },
          receivedBy: { select: { id: true, name: true, username: true } },
          _count: {
            select: {
              lines: true,
              batches: true,
              discrepancies: true,
            }
          }
        },
        orderBy: { createdAt: 'desc' },
        take,
        skip,
      }),
    ]);

    res.json({ grns, total, limit: take, offset: skip });
  } catch (err: any) {
    console.error('Failed to list GRNs:', err);
    res.status(500).json({ error: 'Failed to retrieve Goods Receipt Notes' });
  }
});

// GET /api/grn/:id — Get details of a single GRN
router.get('/:id', requireAuth, requirePermission('inv.grn', 'ops.entry_gate', 'po.view'), async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const grn = await prisma.goodsReceiptNote.findUnique({
      where: { id: id as string },
      include: {
        supplier: true,
        po: {
          select: {
            id: true,
            poNumber: true,
            expectedDate: true,
            targetClient: true,
            status: true,
          }
        },
        receivedBy: { select: { id: true, name: true, username: true } },
        lines: {
          include: {
            poLine: true,
          },
          orderBy: { createdAt: 'asc' },
        },
        batches: {
          select: {
            id: true,
            batchCode: true,
            itemType: true,
            brand: true,
            quality: true,
            shade: true,
            size: true,
            category: true,
            name: true,
            artNo: true,
            uom: true,
            quantity: true,
            supplierBundle: true,
            status: true,
            createdAt: true,
          },
          orderBy: { batchCode: 'asc' },
        },
        discrepancies: {
          orderBy: { createdAt: 'asc' },
        },
      },
    });

    if (!grn) {
      res.status(404).json({ error: 'Goods Receipt Note not found' });
      return;
    }

    res.json(grn);
  } catch (err: any) {
    console.error('Failed to get GRN details:', err);
    res.status(500).json({ error: 'Failed to retrieve GRN details' });
  }
});

// POST /api/grn — Create and finalize a new Goods Receipt Note
router.post('/', requireAuth, requirePermission('ops.entry_gate'), async (req: Request, res: Response) => {
  try {
    const {
      supplierId,
      supplierName,
      poId,
      poNumber,
      invoiceRef,
      invoiceDate,
      batchIds,
      discrepancyIds,
      remarks,
      manualLines,
    } = req.body;

    if (!supplierName && !supplierId) {
      res.status(400).json({ error: 'Supplier information is required to generate a GRN' });
      return;
    }

    if (!Array.isArray(batchIds) || batchIds.length === 0) {
      res.status(400).json({ error: 'At least one received batch/roll is required to generate a GRN' });
      return;
    }

    // Resolve supplier details
    let finalSupplierId = supplierId || null;
    let finalSupplierName = supplierName || '';

    if (finalSupplierId && !finalSupplierName) {
      const s = await prisma.supplier.findUnique({ where: { id: finalSupplierId } });
      if (s) {
        finalSupplierName = s.name;
      }
    }

    // Generate GRN Number: GRN-YY-XXXX (e.g. GRN-26-0001)
    const yearTwoDigits = String(new Date().getFullYear()).slice(-2);
    const prefix = `GRN-${yearTwoDigits}-`;

    const latestGrn = await prisma.goodsReceiptNote.findFirst({
      where: { grnNumber: { startsWith: prefix } },
      orderBy: { grnNumber: 'desc' },
      select: { grnNumber: true },
    });

    let nextSeq = 1;
    if (latestGrn) {
      const parts = latestGrn.grnNumber.split('-');
      const lastNum = parseInt(parts[parts.length - 1], 10);
      if (!isNaN(lastNum)) {
        nextSeq = lastNum + 1;
      }
    }

    let grnNumber = `${prefix}${String(nextSeq).padStart(4, '0')}`;
    while (await prisma.goodsReceiptNote.findUnique({ where: { grnNumber } })) {
      nextSeq++;
      grnNumber = `${prefix}${String(nextSeq).padStart(4, '0')}`;
    }

    // Fetch batches to compute summary and group lines
    const batches = await prisma.itemBatch.findMany({
      where: { id: { in: batchIds } },
      include: { poLine: true },
    });

    if (batches.length === 0) {
      res.status(400).json({ error: 'None of the provided batch IDs were found' });
      return;
    }

    // A roll belongs to exactly one GRN
    const alreadyFinalized = batches.filter(b => b.grnId);
    if (alreadyFinalized.length > 0) {
      res.status(409).json({
        error: `${alreadyFinalized.length} roll(s) are already on a GRN: ${alreadyFinalized.slice(0, 5).map(b => b.batchCode).join(', ')}`
      });
      return;
    }

    // Stock In receives across POs and sends no poId; if every roll is from one PO, link the GRN to it
    let finalPoId: string | null = poId || null;
    let finalPoNumber: string | null = poNumber || null;
    if (!finalPoId) {
      const poIds = [...new Set(batches.map(b => b.poLine?.poId ?? null))];
      if (poIds.length === 1 && poIds[0]) {
        const po = await prisma.purchaseOrder.findUnique({ where: { id: poIds[0] }, select: { poNumber: true } });
        finalPoId = poIds[0];
        finalPoNumber = po?.poNumber ?? null;
      }
    }

    const totalRolls = batches.length;
    const totalQuantity = batches.reduce((sum, b) => sum + (b.quantity || 0), 0);

    // Group batches by unique SKU key if manual lines are not provided
    interface LineGroup {
      itemType: string;
      brand: string;
      quality: string;
      shade: string;
      category: string;
      size: string;
      name: string;
      artNo: string;
      uom: string;
      poLineId?: string;
      receivedQty: number;
      rollsCount: number;
    }

    const groupMap = new Map<string, LineGroup>();

    for (const b of batches) {
      const itemType = b.itemType || 'FABRIC';
      const brand = b.brand || b.poLine?.brand || '';
      const quality = b.quality || b.poLine?.quality || '';
      const shade = b.shade || b.poLine?.shade || '';
      const category = b.category || b.poLine?.category || '';
      const size = b.size || b.poLine?.size || '';
      const name = b.name || b.poLine?.name || '';
      const artNo = b.artNo || b.poLine?.artNo || '';
      const uom = b.uom || b.poLine?.uom || (itemType === 'FABRIC' ? 'METERS' : 'PCS');
      const poLineId = b.poLineId || undefined;

      const key = `${itemType}__${brand}__${quality}__${shade}__${category}__${size}__${name}__${artNo}__${uom}`;

      if (!groupMap.has(key)) {
        groupMap.set(key, {
          itemType,
          brand,
          quality,
          shade,
          category,
          size,
          name,
          artNo,
          uom,
          poLineId,
          receivedQty: 0,
          rollsCount: 0,
        });
      }

      const item = groupMap.get(key)!;
      item.receivedQty += b.quantity;
      item.rollsCount += 1;
    }

    const generatedLines = Array.from(groupMap.values()).map(g => {
      // Check if user passed manual line data with expected/invoiced quantities
      const matchManual = Array.isArray(manualLines)
        ? manualLines.find(m => 
            m.brand === g.brand && 
            m.shade === g.shade && 
            (m.quality === g.quality || !m.quality)
          )
        : null;

      const invoicedQty = matchManual?.invoicedQty ? parseFloat(matchManual.invoicedQty) : g.receivedQty;
      const shortageQty = Math.max(0, invoicedQty - g.receivedQty);

      return {
        itemType: g.itemType,
        brand: g.brand || null,
        quality: g.quality || null,
        shade: g.shade || null,
        category: g.category || null,
        size: g.size || null,
        name: g.name || null,
        artNo: g.artNo || null,
        uom: g.uom,
        poLineId: g.poLineId || null,
        invoicedQty,
        receivedQty: g.receivedQty,
        shortageQty,
        rollsCount: g.rollsCount,
        notes: matchManual?.notes || null,
      };
    });

    // Execute creation inside transaction
    const grn = await prisma.$transaction(async (tx) => {
      const createdGrn = await tx.goodsReceiptNote.create({
        data: {
          grnNumber,
          supplierId: finalSupplierId,
          supplierName: finalSupplierName,
          poId: finalPoId,
          poNumber: finalPoNumber,
          invoiceRef: invoiceRef?.trim() || null,
          invoiceDate: invoiceDate ? new Date(invoiceDate) : null,
          totalRolls,
          totalQuantity,
          status: 'COMPLETED',
          remarks: remarks?.trim() || null,
          receivedById: req.user!.userId,
          lines: {
            create: generatedLines,
          },
        },
        include: {
          lines: true,
        },
      });

      // Link batches to this GRN; roll back if another GRN claimed any of them meanwhile
      const linked = await tx.itemBatch.updateMany({
        where: { id: { in: batches.map(b => b.id) }, grnId: null },
        data: { grnId: createdGrn.id },
      });
      if (linked.count !== batches.length) {
        throw new Error('Some rolls were finalized on another GRN at the same time. Refresh and try again.');
      }

      // Link discrepancies to this GRN if provided
      if (Array.isArray(discrepancyIds) && discrepancyIds.length > 0) {
        await tx.inboundDiscrepancy.updateMany({
          where: { id: { in: discrepancyIds } },
          data: { grnId: createdGrn.id },
        });
      }

      return createdGrn;
    });

    res.status(201).json(grn);
  } catch (err: any) {
    console.error('Failed to create GRN:', err);
    res.status(500).json({ error: err.message || 'Failed to generate Goods Receipt Note' });
  }
});

// GET /api/grn/:id/print — Printable official A4 voucher HTML
router.get('/:id/print', requireAuth, requirePermission('inv.grn', 'ops.entry_gate', 'po.view'), async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const grn = await prisma.goodsReceiptNote.findUnique({
      where: { id: id as string },
      include: {
        supplier: true,
        receivedBy: { select: { name: true } },
        lines: { orderBy: { createdAt: 'asc' } },
        batches: { orderBy: { batchCode: 'asc' } },
        discrepancies: true,
      },
    });

    if (!grn) {
      res.status(404).send('Goods Receipt Note not found');
      return;
    }

    const logoDataUri = companyLogoDataUri();

    // Generate Code 128 barcode for GRN number
    let barcodeDataUri = '';
    try {
      const barcodeBuffer = await bwipjs.toBuffer({
        bcid: 'code128',
        text: grn.grnNumber,
        scale: 3,
        height: 12,
        includetext: true,
        textxalign: 'center',
        textsize: 10
      } as any);
      barcodeDataUri = `data:image/png;base64,${barcodeBuffer.toString('base64')}`;
    } catch (err) {
      console.error('Barcode generation failed for GRN', err);
    }

    // Determine PO / GRN Item Type: FABRIC | READY_MADE | ACCESSORIES
    const isFabric = grn.lines.some((l: any) => (l.uom || '').toUpperCase().startsWith('M'));
    const isReadyMade = !isFabric && grn.lines.some((l: any) => (l.uom || '').toUpperCase().startsWith('P'));

    const totalInvoiced = grn.lines.reduce((s: number, l: any) => s + (l.invoicedQty || l.receivedQty || 0), 0);
    const totalReceived = grn.lines.reduce((s: number, l: any) => s + (l.receivedQty || 0), 0);
    const totalShortage = grn.lines.reduce((s: number, l: any) => s + (l.shortageQty || 0), 0);
    const totalRolls = grn.lines.reduce((s: number, l: any) => s + (l.rollsCount || 1), 0);

    const isPartialGrn = (grn.remarks || '').toUpperCase().includes('PARTIAL') ||
      grn.lines.some((l: any) => (l.shortageQty && l.shortageQty > 0.01) || (l.poLine && l.poLine.receivedQty < l.poLine.orderedQty));

    let tableHeadHtml = '';
    let tableBodyHtml = '';
    let tableFootHtml = '';

    if (isFabric) {
      tableHeadHtml = `
        <tr>
          <th style="width: 32px; text-align: center;">#</th>
          <th style="text-align: left;">Fabric Category</th>
          <th style="text-align: left;">Brand</th>
          <th style="text-align: left;">Quality</th>
          <th style="text-align: left;">Shade</th>
          <th style="width: 85px; text-align: right;">Invoiced (m)</th>
          <th style="width: 90px; text-align: right;">Received (m)</th>
          <th style="width: 55px; text-align: center;">Rolls</th>
          <th style="width: 80px; text-align: right;">Shortage</th>
        </tr>
      `;

      tableBodyHtml = grn.lines.map((l: any, idx: number) => `
        <tr>
          <td style="text-align: center;">${idx + 1}</td>
          <td><strong>${escapeHtml(l.category || 'Fabric')}</strong></td>
          <td>${escapeHtml(l.brand || '—')}</td>
          <td>${escapeHtml(l.quality || '—')}</td>
          <td>${escapeHtml(l.shade || '—')}</td>
          <td style="text-align: right;">${(l.invoicedQty || l.receivedQty).toFixed(1)}</td>
          <td style="text-align: right; font-weight: bold;">${l.receivedQty.toFixed(1)}</td>
          <td style="text-align: center;">${l.rollsCount || 1}</td>
          <td style="text-align: right;">${l.shortageQty > 0.01 ? l.shortageQty.toFixed(1) : '0.0'}</td>
        </tr>
      `).join('');

      tableFootHtml = `
        <tr style="font-weight: bold; background: #f9f9f9; border-top: 2px solid #000; border-bottom: 2px solid #000;">
          <td colspan="5" style="text-align: right; padding: 8px;">TOTAL (METERS):</td>
          <td style="text-align: right; padding: 8px;">${totalInvoiced.toFixed(1)}</td>
          <td style="text-align: right; padding: 8px;">${totalReceived.toFixed(1)}</td>
          <td style="text-align: center; padding: 8px;">${totalRolls}</td>
          <td style="text-align: right; padding: 8px;">${totalShortage.toFixed(1)}</td>
        </tr>
      `;
    } else if (isReadyMade) {
      tableHeadHtml = `
        <tr>
          <th style="width: 32px; text-align: center;">#</th>
          <th style="text-align: left;">Item Name</th>
          <th style="text-align: left;">Category</th>
          <th style="text-align: left;">Art No</th>
          <th style="text-align: left;">Color</th>
          <th style="text-align: center; width: 60px;">Size</th>
          <th style="width: 85px; text-align: right;">Invoiced (Pcs)</th>
          <th style="width: 90px; text-align: right;">Received (Pcs)</th>
          <th style="width: 80px; text-align: right;">Shortage</th>
        </tr>
      `;

      tableBodyHtml = grn.lines.map((l: any, idx: number) => `
        <tr>
          <td style="text-align: center;">${idx + 1}</td>
          <td><strong>${escapeHtml(l.name || l.brand || 'Item')}</strong></td>
          <td>${escapeHtml(l.category || '—')}</td>
          <td>${escapeHtml(l.artNo || '—')}</td>
          <td>${escapeHtml(l.shade || '—')}</td>
          <td style="text-align: center;">${escapeHtml(l.size || '—')}</td>
          <td style="text-align: right;">${Math.round(l.invoicedQty || l.receivedQty)}</td>
          <td style="text-align: right; font-weight: bold;">${Math.round(l.receivedQty)}</td>
          <td style="text-align: right;">${l.shortageQty > 0 ? Math.round(l.shortageQty) : '0'}</td>
        </tr>
      `).join('');

      tableFootHtml = `
        <tr style="font-weight: bold; background: #f9f9f9; border-top: 2px solid #000; border-bottom: 2px solid #000;">
          <td colspan="6" style="text-align: right; padding: 8px;">TOTAL (PIECES):</td>
          <td style="text-align: right; padding: 8px;">${Math.round(totalInvoiced)}</td>
          <td style="text-align: right; padding: 8px;">${Math.round(totalReceived)}</td>
          <td style="text-align: right; padding: 8px;">${Math.round(totalShortage)}</td>
        </tr>
      `;
    } else {
      tableHeadHtml = `
        <tr>
          <th style="width: 32px; text-align: center;">#</th>
          <th style="text-align: left;">Item Name</th>
          <th style="text-align: left;">Specification</th>
          <th style="text-align: left;">Color</th>
          <th style="text-align: center; width: 60px;">Size</th>
          <th style="width: 85px; text-align: right;">Invoiced</th>
          <th style="width: 90px; text-align: right;">Received</th>
          <th style="width: 80px; text-align: right;">Shortage</th>
        </tr>
      `;

      tableBodyHtml = grn.lines.map((l: any, idx: number) => `
        <tr>
          <td style="text-align: center;">${idx + 1}</td>
          <td><strong>${escapeHtml(l.name || l.brand || 'Accessory')}</strong></td>
          <td>${escapeHtml(l.quality || '—')}</td>
          <td>${escapeHtml(l.shade || '—')}</td>
          <td style="text-align: center;">${escapeHtml(l.size || '—')}</td>
          <td style="text-align: right;">${l.invoicedQty || l.receivedQty}</td>
          <td style="text-align: right; font-weight: bold;">${l.receivedQty}</td>
          <td style="text-align: right;">${l.shortageQty > 0 ? l.shortageQty : '0'}</td>
        </tr>
      `).join('');

      tableFootHtml = `
        <tr style="font-weight: bold; background: #f9f9f9; border-top: 2px solid #000; border-bottom: 2px solid #000;">
          <td colspan="5" style="text-align: right; padding: 8px;">TOTAL UNITS:</td>
          <td style="text-align: right; padding: 8px;">${totalInvoiced}</td>
          <td style="text-align: right; padding: 8px;">${totalReceived}</td>
          <td style="text-align: right; padding: 8px;">${totalShortage}</td>
        </tr>
      `;
    }

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>${grn.grnNumber} — Goods Receipt Note</title>
  <style>
    @page {
      size: A4 portrait;
      margin: 10mm 12mm 10mm 12mm;
    }
    *, *::before, *::after {
      box-sizing: border-box;
    }
    html, body {
      height: 100%;
      margin: 0;
      padding: 0;
    }
    body {
      font-family: Arial, Helvetica, sans-serif;
      margin: 0;
      padding: 0;
      background: #f1f5f9;
      color: #000000;
      font-size: 11px;
      line-height: 1.35;
      display: flex;
      justify-content: center;
    }
    .wrapper {
      width: 100%;
      max-width: 210mm;
      min-height: 275mm;
      margin: 10px auto;
      padding: 10mm 12mm;
      background: #ffffff;
      box-shadow: 0 2px 12px rgba(0, 0, 0, 0.08);
      display: flex;
      flex-direction: column;
      justify-content: space-between;
      box-sizing: border-box;
    }
    .content-top {
      flex: 1 0 auto;
    }
    .bottom-section {
      flex-shrink: 0;
      margin-top: auto;
      page-break-inside: avoid;
    }
    .header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      border-bottom: 2px solid #000000;
      padding-bottom: 12px;
      margin-bottom: 14px;
    }
    .logo-container {
      display: flex;
      align-items: center;
    }
    .logo-img {
      max-height: 52px;
      max-width: 200px;
      object-fit: contain;
    }
    .title-block {
      text-align: right;
    }
    .title {
      font-size: 20px;
      font-weight: bold;
      margin: 0 0 2px 0;
      letter-spacing: 0.5px;
      color: #000000;
    }
    .doc-ref {
      font-size: 13px;
      font-weight: bold;
      color: #000000;
    }
    .meta-table {
      width: 100%;
      border-collapse: collapse;
      margin-bottom: 16px;
      font-size: 11.5px;
    }
    .meta-table td {
      padding: 4px 6px;
      vertical-align: top;
    }
    .meta-label {
      width: 130px;
      font-weight: bold;
      color: #000000;
    }
    table.data-table {
      width: 100%;
      border-collapse: collapse;
      margin-bottom: 14px;
      font-size: 11px;
    }
    table.data-table th {
      border: 1px solid #000000;
      padding: 6px 8px;
      font-size: 10.5px;
      font-weight: bold;
      background: #ffffff;
      color: #000000;
    }
    table.data-table td {
      border: 1px solid #000000;
      padding: 6px 8px;
      color: #000000;
    }
    .sign-table {
      width: 100%;
      margin-top: 30px;
      margin-bottom: 16px;
      border-collapse: collapse;
      page-break-inside: avoid;
    }
    .sign-cell {
      width: 33.33%;
      text-align: center;
      padding-top: 8px;
      font-size: 11px;
    }
    .sign-line {
      width: 140px;
      margin: 0 auto 8px auto;
      border-top: 1px solid #000000;
    }
    .footer {
      padding-top: 8px;
      border-top: 1px solid #000000;
      text-align: center;
      font-size: 10px;
      color: #000000;
      line-height: 1.4;
    }
    @media print {
      body {
        background: transparent;
        margin: 0;
        padding: 0;
      }
      .wrapper {
        margin: 0;
        padding: 0;
        box-shadow: none;
        max-width: 100%;
        min-height: 275mm;
      }
    }
  </style>
</head>
<body>
  <div class="wrapper">
    <div class="content-top">
      <div class="header">
        <div class="logo-container">
          ${logoDataUri ? `<img src="${logoDataUri}" alt="Olino Uniforms" class="logo-img" />` : '<div style="font-size: 20px; font-weight: bold;">OLINO UNIFORMS</div>'}
        </div>
        <div class="title-block">
          <div class="title">${grn.grnNumber}</div>
          ${barcodeDataUri ? `<img src="${barcodeDataUri}" alt="${grn.grnNumber}" style="height: 42px; object-fit: contain; margin-top: 2px;" />` : `<div class="doc-ref">${grn.grnNumber}</div>`}
        </div>
      </div>

      <table class="meta-table">
        <tr>
          <td class="meta-label">Supplier:</td>
          <td><strong>${escapeHtml(grn.supplierName)}</strong> ${grn.supplier?.code ? `(${escapeHtml(grn.supplier.code)})` : ''}</td>
          <td class="meta-label">Receipt Date:</td>
          <td><strong>${formatDate(grn.createdAt)}</strong></td>
        </tr>
        <tr>
          <td class="meta-label">Supplier Invoice:</td>
          <td><strong>${escapeHtml(grn.invoiceRef || '—')}</strong></td>
          <td class="meta-label">Delivery Status:</td>
          <td><strong>${isPartialGrn ? '<span style="color: #b45309;">Partial (Balance remains open on PO)</span>' : '<span style="color: #166534;">Complete / Full Delivery</span>'}</strong></td>
        </tr>
        <tr>
          <td class="meta-label">Created By:</td>
          <td colspan="3"><strong>${escapeHtml(grn.receivedBy?.name || '—')}</strong>${grn.remarks ? ` &nbsp;•&nbsp; <em>${escapeHtml(grn.remarks)}</em>` : ''}</td>
        </tr>
      </table>

      <table class="data-table">
        <thead>
          ${tableHeadHtml}
        </thead>
        <tbody>
          ${tableBodyHtml}
        </tbody>
        <tfoot>
          ${tableFootHtml}
        </tfoot>
      </table>
    </div>

    <div class="bottom-section">
      <table class="sign-table">
        <tr>
          <td class="sign-cell" style="padding-right: 15px;">
            <div class="sign-line"></div>
            <div style="font-size: 11px; font-weight: bold; margin-bottom: 2px;">Warehouse Receiving Staff</div>
            <div style="font-size: 9.5px; color: #444;">Signature &amp; Date</div>
          </td>
          <td class="sign-cell" style="padding-left: 15px; padding-right: 15px;">
            <div class="sign-line"></div>
            <div style="font-size: 11px; font-weight: bold; margin-bottom: 2px;">Warehouse Manager</div>
            <div style="font-size: 9.5px; color: #444;">Signature &amp; Date</div>
          </td>
          <td class="sign-cell" style="padding-left: 15px;">
            <div class="sign-line"></div>
            <div style="font-size: 11px; font-weight: bold; margin-bottom: 2px;">Manager</div>
            <div style="font-size: 9.5px; color: #444;">Authorized Signature &amp; Date</div>
          </td>
        </tr>
      </table>

      <div class="footer">
        <div>17/362, Depot, Near Railway Station, Nilambur, Malappuram Dist., Pin: 679330 | Phone: +91 7902 833 334</div>
        <div>GSTIN: 32BOJPJ7259C1Z1</div>
      </div>
    </div>
  </div>
</body>
</html>`;

    res.setHeader('Content-Type', 'text/html');
    res.send(html);
  } catch (err: any) {
    console.error('Failed to print GRN:', err);
    res.status(500).send('Failed to generate printable GRN voucher');
  }
});

export default router;
