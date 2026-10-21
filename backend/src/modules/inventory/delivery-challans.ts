import { Router, Request, Response } from 'express';
import bwipjs from 'bwip-js';
import { requireAuth, requirePermission } from '../../middleware/auth';
import prisma from '../../lib/prisma';
import { formatDate } from '../../utils/format';
import { escapeHtml, companyLogoDataUri } from '../../utils/html';

const router = Router();

// GET /api/delivery-challans — List all DCs
router.get('/', requireAuth, requirePermission('ops.exit_gate'), async (_req: Request, res: Response) => {
  const challans = await prisma.deliveryChallan.findMany({
    where: { isDeleted: false },
    orderBy: { createdAt: 'desc' },
    include: {
      createdBy: { select: { name: true } },
      _count: { select: { lines: true } }
    }
  });
  res.json(challans);
});

// Helper to resolve or auto-register client in clients directory
async function resolveClientId(customerName: string, destination?: string | null): Promise<string | null> {
  const cleanName = customerName.trim();
  if (!cleanName) return null;

  try {
    const existing = await prisma.client.findFirst({
      where: { name: { equals: cleanName, mode: 'insensitive' } }
    });
    if (existing) {
      return existing.id;
    }

    const latest = await prisma.client.findFirst({
      where: { code: { startsWith: 'CLI-' } },
      orderBy: { code: 'desc' },
      select: { code: true }
    });

    let nextNum = 1;
    if (latest && latest.code) {
      const parts = latest.code.split('-');
      const parsed = parseInt(parts[parts.length - 1], 10);
      if (!isNaN(parsed)) nextNum = parsed + 1;
    }

    let code = `CLI-${String(nextNum).padStart(4, '0')}`;
    while (await prisma.client.findUnique({ where: { code } })) {
      nextNum++;
      code = `CLI-${String(nextNum).padStart(4, '0')}`;
    }

    const created = await prisma.client.create({
      data: {
        code,
        name: cleanName,
        city: destination?.trim() || null,
        isActive: true,
      }
    });
    return created.id;
  } catch {
    return null;
  }
}

// GET /api/delivery-challans/customers — Get unique customer directory for auto-suggest
router.get('/customers', requireAuth, requirePermission('ops.exit_gate'), async (_req: Request, res: Response) => {
  try {
    const clients = await prisma.client.findMany({
      where: { isActive: true },
      select: { id: true, code: true, name: true, city: true, address: true, phone: true, clientType: true },
      orderBy: { name: 'asc' },
    });

    res.json(clients.map(c => ({
      customerName: c.name.trim(),
      destination: c.city || c.address || null,
      address: c.address || null,
      phone: c.phone || null,
      code: c.code || null,
      clientType: c.clientType || null,
      clientId: c.id,
    })));
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/delivery-challans/:id — Get specific DC with lines
router.get('/:id', requireAuth, requirePermission('ops.exit_gate'), async (req: Request, res: Response) => {
  const id = req.params.id as string;
  const dc = await prisma.deliveryChallan.findUnique({
    where: { id },
    include: {
      createdBy: { select: { name: true } },
      lines: {
        include: {
          batch: {
            include: { batchLocations: { include: { location: true } } }
          }
        },
        orderBy: { createdAt: 'desc' }
      }
    }
  });
  if (!dc || dc.isDeleted) {
    res.status(404).json({ error: 'Delivery Challan not found' });
    return;
  }
  res.json(dc);
});

// Helper to generate sequential DC number with concurrency collision retry
async function generateNextChallanNumber(): Promise<string> {
  const yearTwoDigits = String(new Date().getFullYear()).slice(-2);
  const prefix = `DC-${yearTwoDigits}-`;

  const latestDc = await prisma.deliveryChallan.findFirst({
    where: { challanNumber: { startsWith: prefix } },
    orderBy: { challanNumber: 'desc' },
    select: { challanNumber: true }
  });

  let nextSeq = 1;
  if (latestDc) {
    const parts = latestDc.challanNumber.split('-');
    const lastNum = parseInt(parts[parts.length - 1], 10);
    if (!isNaN(lastNum)) {
      nextSeq = lastNum + 1;
    }
  }

  let challanNumber = `${prefix}${String(nextSeq).padStart(4, '0')}`;
  while (await prisma.deliveryChallan.findUnique({ where: { challanNumber } })) {
    nextSeq++;
    challanNumber = `${prefix}${String(nextSeq).padStart(4, '0')}`;
  }
  return challanNumber;
}

// POST /api/delivery-challans — Create a new draft DC
router.post('/', requireAuth, requirePermission('ops.exit_gate'), async (req: Request, res: Response) => {
  const { customerName, customerId, destination, remarks } = req.body;
  if (!customerName) {
    res.status(400).json({ error: 'Customer name is required' });
    return;
  }

  // Resolve or link client ID in clients directory
  const resolvedCustomerId = customerId || await resolveClientId(customerName, destination);

  let finalDestination = destination?.trim() || null;
  if (!finalDestination && resolvedCustomerId) {
    try {
      const cli = await prisma.client.findUnique({
        where: { id: resolvedCustomerId },
        select: { city: true, address: true }
      });
      if (cli) {
        finalDestination = cli.city || cli.address || null;
      }
    } catch {}
  }

  let dc = null;
  let attempts = 0;
  while (!dc && attempts < 5) {
    attempts++;
    const challanNumber = await generateNextChallanNumber();
    try {
      dc = await prisma.deliveryChallan.create({
        data: {
          challanNumber,
          customerName: customerName.trim(),
          customerId: resolvedCustomerId,
          destination: finalDestination,
          remarks: remarks?.trim() || null,
          createdById: req.user!.userId
        }
      });
    } catch (err: any) {
      if (err.code === 'P2002') {
        continue; // Collision, retry nextSeq
      }
      throw err;
    }
  }

  if (!dc) {
    res.status(500).json({ error: 'Failed to allocate unique Challan Number. Please try again.' });
    return;
  }

  res.status(201).json(dc);
});

// POST /api/delivery-challans/:id/lines — Add a scanned batch to the DC
router.post('/:id/lines', requireAuth, requirePermission('ops.exit_gate'), async (req: Request, res: Response) => {
  const id = req.params.id as string;
  const { batchCode, quantity } = req.body;
  const numQty = parseFloat(quantity);

  if (!batchCode || isNaN(numQty) || numQty <= 0) {
    res.status(400).json({ error: 'Invalid batch code or quantity' });
    return;
  }

  const dc = await prisma.deliveryChallan.findUnique({ where: { id } });
  if (!dc || dc.isDeleted || dc.status !== 'DRAFT') {
    res.status(400).json({ error: 'Challan is not in DRAFT state' });
    return;
  }

  const batch = await prisma.itemBatch.findUnique({ where: { batchCode: (batchCode as string).trim() } });
  if (!batch) {
    res.status(404).json({ error: 'Batch not found' });
    return;
  }
  if (batch.status === 'OUT') {
    res.status(400).json({ error: 'Batch is already fully dispatched' });
    return;
  }
  if (batch.status === 'QC_HOLD') {
    res.status(400).json({ error: `Batch ${batch.batchCode} is on QC Hold (pending quality inspection) and cannot be dispatched.` });
    return;
  }
  if (numQty > batch.quantity + 0.001) {
    res.status(400).json({ error: `Cannot ship ${numQty}. Only ${batch.quantity} available in this batch.` });
    return;
  }

  // Check if line already exists for this batch in this DC
  const existingLine = await prisma.deliveryChallanLine.findFirst({
    where: { dcId: dc.id, batchId: batch.id }
  });
  if (existingLine) {
    res.status(400).json({ error: `SKU ${batch.batchCode} is already in this Challan.` });
    return;
  }

  // Check if batch is already packed in another active DRAFT challan
  const otherDraftLine = await prisma.deliveryChallanLine.findFirst({
    where: {
      batchId: batch.id,
      dc: { status: 'DRAFT', isDeleted: false, id: { not: dc.id } }
    },
    include: { dc: true }
  });
  if (otherDraftLine) {
    res.status(400).json({
      error: `SKU ${batch.batchCode} is currently packed in Draft Challan ${otherDraftLine.dc.challanNumber} (${otherDraftLine.dc.customerName}). Remove it from that Challan or dispatch it first.`
    });
    return;
  }

  const isPartialCut = Math.abs(numQty - batch.quantity) > 0.01;

  // Generate traceable cut reference for partial cuts (e.g. BAT-2026-0042-C1)
  let cutReference: string | null = null;
  if (isPartialCut) {
    const priorCutsCount = await prisma.deliveryChallanLine.count({
      where: { batchId: batch.id, isPartialCut: true }
    });
    cutReference = `${batch.batchCode}-C${priorCutsCount + 1}`;
  }

  const line = await prisma.deliveryChallanLine.create({
    data: {
      dcId: dc.id,
      batchId: batch.id,
      quantity: numQty,
      isPartialCut,
      cutReference
    },
    include: {
      batch: { include: { batchLocations: { include: { location: true } } } }
    }
  });

  res.status(201).json(line);
});

// DELETE /api/delivery-challans/:id/lines/:lineId — Remove a line
router.delete('/:id/lines/:lineId', requireAuth, requirePermission('ops.exit_gate'), async (req: Request, res: Response) => {
  const lineId = req.params.lineId as string;
  const line = await prisma.deliveryChallanLine.findUnique({ where: { id: lineId } });
  if (!line) { res.status(404).json({ error: 'Line not found' }); return; }
  
  const dc = await prisma.deliveryChallan.findUnique({ where: { id: line.dcId } });
  if (dc?.status !== 'DRAFT') {
    res.status(400).json({ error: 'Cannot remove line, challan is not in DRAFT state' });
    return;
  }

  await prisma.deliveryChallanLine.delete({ where: { id: lineId } });
  res.json({ success: true, message: 'Line item removed from Challan.' });
});

// DELETE /api/delivery-challans/:id — Soft-delete a draft DC
router.delete('/:id', requireAuth, requirePermission('ops.exit_gate'), async (req: Request, res: Response) => {
  const id = req.params.id as string;
  const dc = await prisma.deliveryChallan.findUnique({ where: { id } });
  
  if (!dc || dc.isDeleted) {
    res.status(404).json({ error: 'Delivery Challan not found' });
    return;
  }
  
  if (dc.status !== 'DRAFT') {
    res.status(400).json({ error: 'Cannot delete a finalized/dispatched Delivery Challan.' });
    return;
  }

  // Soft-delete to preserve audit logs
  await prisma.deliveryChallan.update({
    where: { id },
    data: {
      status: 'CANCELLED',
      isDeleted: true,
      deletedAt: new Date()
    }
  });

  res.json({ success: true, message: `Draft Delivery Challan ${dc.challanNumber} cancelled and removed.` });
});

// POST /api/delivery-challans/:id/dispatch — Finalize and dispatch the stock
router.post('/:id/dispatch', requireAuth, requirePermission('ops.exit_gate'), async (req: Request, res: Response) => {
  const dcId = req.params.id as string;

  try {
    const result = await prisma.$transaction(async (tx) => {
      const dc = await tx.deliveryChallan.findUnique({
        where: { id: dcId },
        include: { lines: { include: { batch: true } } }
      });

      if (!dc || dc.isDeleted) throw new Error('Delivery Challan not found');
      if (dc.status !== 'DRAFT') throw new Error('Challan is already dispatched or cancelled');
      if (!dc.lines || dc.lines.length === 0) throw new Error('Cannot dispatch an empty challan');

      // 1. Re-validate everything atomically
      for (const line of dc.lines) {
        const batch = await tx.itemBatch.findUnique({ where: { id: line.batchId } });
        if (!batch || batch.status === 'OUT') throw new Error(`Batch ${line.batch.batchCode} is no longer available.`);
        if (batch.status === 'QC_HOLD') throw new Error(`Batch ${batch.batchCode} is on QC Hold and cannot be dispatched.`);
        if (line.quantity > batch.quantity + 0.001) throw new Error(`Batch ${line.batch.batchCode} does not have enough quantity (${batch.quantity} available, ${line.quantity} requested).`);
      }

      // 2. Perform Stock Movements with atomic decrement
      for (const line of dc.lines) {
        const batch = await tx.itemBatch.findUnique({
          where: { id: line.batchId },
          include: { batchLocations: { include: { location: true } } }
        });
        const oldQty = batch!.quantity;
        const newQty = Math.max(0, parseFloat((oldQty - line.quantity).toFixed(2)));
        const isFullDispatch = newQty <= 0.001;

        const prevLocations = (batch!.batchLocations || [])
          .map((bl: any) => bl.location?.code)
          .filter(Boolean)
          .join(', ') || 'Inbound Dock';

        // Update Batch Quantity atomically and Status
        await tx.itemBatch.update({
          where: { id: batch!.id },
          data: {
            quantity: isFullDispatch ? 0 : { decrement: line.quantity },
            status: isFullDispatch ? 'OUT' : 'PARTIALLY_USED'
          }
        });

        // Always delete existing batchLocation:
        // - If full dispatch: depleted roll is removed from warehouse
        // - If partial cut: remainder roll enters Put-Away Queue (unassignedQty = newQty) so employee can place it
        await tx.batchLocation.deleteMany({ where: { batchId: batch!.id } });

        // Log Transaction
        await tx.transaction.create({
          data: {
            batchId: batch!.id,
            type: isFullDispatch ? 'STOCK_OUT' : 'PARTIAL_CUT',
            quantityMoved: line.quantity,
            previousQuantity: oldQty,
            newQuantity: isFullDispatch ? 0 : newQty,
            operatorId: req.user!.userId,
            referenceType: 'DELIVERY_CHALLAN',
            referenceId: dc.challanNumber,
            notes: isFullDispatch
              ? `Shipped to ${dc.customerName}${dc.destination ? ` (${dc.destination})` : ''}`
              : `Cut ${line.quantity} (Cut Tag: ${line.cutReference || 'Cut Piece'}) shipped to ${dc.customerName}. Remainder ${newQty} sent to Put-Away queue (Previous location: ${prevLocations})`
          }
        });
      }

      // 3. Mark DC as dispatched
      const updatedDc = await tx.deliveryChallan.update({
        where: { id: dcId },
        data: {
          status: 'DISPATCHED',
          dispatchedAt: new Date()
        }
      });

      return updatedDc;
    });

    res.json(result);
  } catch (err: any) {
    res.status(400).json({ error: err.message || 'Dispatch failed' });
  }
});

// GET /api/delivery-challans/:id/print — Generate A4 HTML with Consolidated Product Totals
router.get('/:id/print', requireAuth, requirePermission('ops.exit_gate', 'inv.delivery_challans', 'admin.clients'), async (req: Request, res: Response) => {
  const id = req.params.id as string;
  const dc = await prisma.deliveryChallan.findUnique({
    where: { id },
    include: {
      createdBy: true,
      lines: {
        include: {
          batch: true
        }
      }
    }
  });

  if (!dc) { res.status(404).send('Challan not found'); return; }

  const logoDataUri = companyLogoDataUri();

  // Generate Code 128 barcode for DC number
  let barcodeDataUri = '';
  try {
    const barcodeBuffer = await bwipjs.toBuffer({
      bcid: 'code128',
      text: dc.challanNumber,
      scale: 3,
      height: 12,
      includetext: true,
      textxalign: 'center',
      textsize: 10
    } as any);
    barcodeDataUri = `data:image/png;base64,${barcodeBuffer.toString('base64')}`;
  } catch (err) {
    console.error('Barcode generation failed for DC', err);
  }

  // ─── Group by Product Master (Consolidate multiple rolls of same product) ───
  const groupedProducts: Record<string, {
    name?: string | null;
    artNo?: string | null;
    brand: string;
    category: string | null;
    quality: string;
    shade: string;
    size: string | null;
    itemType: string;
    totalQuantity: number;
    unitCount: number;
    unit: string;
  }> = {};

  let grandTotalFabric = 0;
  let grandTotalReadyMade = 0;
  let grandTotalAccessories = 0;

  for (const line of dc.lines || []) {
    const batch = line.batch;
    const isFabric = batch.itemType === 'FABRIC';
    const isReadyMade = batch.itemType === 'READY_MADE';
    const itemType = batch.itemType || 'FABRIC';
    const name = batch.name || null;
    const artNo = batch.artNo || null;
    const brand = batch.brand || '—';
    const category = batch.category || null;
    const quality = batch.quality || '';
    const shade = batch.shade || '';
    const size = batch.size || null;
    const uomStr = batch.uom || (isFabric ? 'Meters' : (isReadyMade ? 'Pieces' : 'Units'));
    const key = [itemType, name || '', artNo || '', brand, quality, shade, size || '', uomStr].join('|');

    if (!groupedProducts[key]) {
      groupedProducts[key] = {
        name,
        artNo,
        brand,
        category,
        quality,
        shade,
        size,
        itemType,
        totalQuantity: 0,
        unitCount: 0,
        unit: uomStr,
      };
    }

    groupedProducts[key].totalQuantity += line.quantity;
    groupedProducts[key].unitCount += 1;

    if (isFabric) grandTotalFabric += line.quantity;
    else if (isReadyMade) grandTotalReadyMade += line.quantity;
    else grandTotalAccessories += line.quantity;
  }

  const productList = Object.values(groupedProducts);
  let linesHtml = '';

  for (let i = 0; i < productList.length; i++) {
    const p = productList[i];
    const isFabric = p.itemType === 'FABRIC';
    const countLabel = isFabric 
      ? `${p.unitCount} ${p.unitCount === 1 ? 'Roll' : 'Rolls'}`
      : `${p.unitCount} ${p.unitCount === 1 ? 'Item' : 'Items'}`;

    const mainTitle = escapeHtml(p.name || `${p.brand || ''} ${p.quality ? '· ' + p.quality : ''}`.trim());

    linesHtml += `
      <tr>
        <td style="text-align: center;">${i + 1}</td>
        <td>
          <div style="font-weight: bold; font-size: 11.5px;">
            ${mainTitle}
          </div>
          <div style="font-size: 10.5px; color: #333333; margin-top: 2px;">
            ${p.artNo ? `Art No: <strong>${escapeHtml(p.artNo)}</strong> · ` : ''}
            ${p.shade ? `Color/Shade: <strong>${escapeHtml(p.shade)}</strong>` : ''}
            ${p.size ? ` · Size: <strong>${escapeHtml(p.size)}</strong>` : ''}
            <span style="display: inline-block; margin-left: 8px; font-size: 10px; background: #f1f5f9; padding: 1px 6px; border-radius: 3px; font-weight: bold;">
              ${countLabel}
            </span>
          </div>
        </td>
        <td style="text-align: right; font-weight: bold; font-size: 11.5px; white-space: nowrap;">
          ${parseFloat(p.totalQuantity.toFixed(2))} ${escapeHtml(p.unit)}
        </td>
      </tr>
    `;
  }

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>${dc.challanNumber} — Delivery Challan</title>
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
          <div class="title">${dc.challanNumber}</div>
          ${barcodeDataUri ? `<img src="${barcodeDataUri}" alt="${dc.challanNumber}" style="height: 42px; object-fit: contain; margin-top: 2px;" />` : `<div class="doc-ref">${dc.challanNumber}</div>`}
        </div>
      </div>

      <table class="meta-table">
        <tr>
          <td class="meta-label">Customer:</td>
          <td><strong>${escapeHtml(dc.customerName)}</strong></td>
          <td class="meta-label">Dispatched Date:</td>
          <td><strong>${formatDate(dc.dispatchedAt || dc.createdAt)}</strong></td>
        </tr>
        <tr>
          <td class="meta-label">Destination:</td>
          <td><strong>${escapeHtml(dc.destination || '—')}</strong></td>
          <td class="meta-label">Delivery Status:</td>
          <td><strong>${dc.status === 'DISPATCHED' ? '<span style="color: #166534;">Dispatched</span>' : '<span style="color: #b45309;">Draft</span>'}</strong></td>
        </tr>
        <tr>
          <td class="meta-label">Prepared By:</td>
          <td><strong>${escapeHtml(dc.createdBy?.name || '—')}</strong></td>
          <td class="meta-label">Remarks:</td>
          <td><strong>${escapeHtml(dc.remarks || '—')}</strong></td>
        </tr>
      </table>

      <table class="data-table">
        <thead>
          <tr>
            <th style="width: 32px; text-align: center;">#</th>
            <th style="text-align: left;">Product Name &amp; Description</th>
            <th style="width: 180px; text-align: right;">Total Quantity</th>
          </tr>
        </thead>
        <tbody>
          ${linesHtml}
        </tbody>
        <tfoot>
          <tr style="font-weight: bold; background: #f9f9f9; border-top: 2px solid #000000; border-bottom: 2px solid #000000;">
            <td colspan="2" style="text-align: right; padding: 8px;">GRAND TOTAL:</td>
            <td style="text-align: right; padding: 8px;">
              ${[
                grandTotalFabric > 0 ? `${parseFloat(grandTotalFabric.toFixed(2))} Meters` : '',
                grandTotalReadyMade > 0 ? `${Math.round(grandTotalReadyMade)} Pieces` : '',
                grandTotalAccessories > 0 ? `${Math.round(grandTotalAccessories)} Units` : '',
              ].filter(Boolean).join(' + ') || '0'}
            </td>
          </tr>
        </tfoot>
      </table>
    </div>

    <div class="bottom-section">
      <table class="sign-table">
        <tr>
          <td class="sign-cell" style="padding-right: 15px;">
            <div class="sign-line"></div>
            <div style="font-size: 11px; font-weight: bold; margin-bottom: 2px;">Prepared By</div>
            <div style="font-size: 9.5px; color: #444;">Signature &amp; Date</div>
          </td>
          <td class="sign-cell" style="padding-left: 15px; padding-right: 15px;">
            <div class="sign-line"></div>
            <div style="font-size: 11px; font-weight: bold; margin-bottom: 2px;">Dispatched By</div>
            <div style="font-size: 9.5px; color: #444;">Signature &amp; Date</div>
          </td>
          <td class="sign-cell" style="padding-left: 15px;">
            <div class="sign-line"></div>
            <div style="font-size: 11px; font-weight: bold; margin-bottom: 2px;">Received By (Customer)</div>
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

  res.set('Content-Type', 'text/html');
  res.send(html);
});

export default router;
