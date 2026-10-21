import { Router, Request, Response } from 'express';
import prisma from '../../lib/prisma';
import { requireAuth, requirePermission } from '../../middleware/auth';
import { nextBatchCode } from '../../utils/batch-code';
import { nextDocumentNumber } from '../../utils/document-number';
import { formatDate } from '../../utils/format';
import { renderPrintDocument } from '../../utils/print-document';

// Customer returns (against a dispatched delivery challan) and returns to supplier.
const router = Router();
router.use(requireAuth, requirePermission('inv.returns'));

export const CUSTOMER_RETURN_REASONS = ['SIZE_EXCHANGE', 'DEFECTIVE', 'WRONG_ITEM', 'EXCESS', 'OTHER'] as const;
export const SUPPLIER_RETURN_REASONS = ['DEFECTIVE', 'WRONG_ITEM', 'SHORT_LENGTH', 'EXCESS', 'OTHER'] as const;
const REASON_LABEL: Record<string, string> = {
  SIZE_EXCHANGE: 'Size exchange', DEFECTIVE: 'Defective / damaged', WRONG_ITEM: 'Wrong item',
  EXCESS: 'Excess quantity', SHORT_LENGTH: 'Short length', OTHER: 'Other',
};

/** A problem the user can fix; the message is shown as-is. */
class ReturnError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}

type BatchFields = {
  itemType: string; category: string | null; brand: string | null; quality: string | null; shade: string | null;
  size: string | null; name: string | null; artNo: string | null; uom: string;
};

export function itemDescription(b: BatchFields): string {
  if (b.itemType === 'FABRIC') return [`${b.brand ?? ''} ${b.quality ?? ''}`.trim(), b.shade].filter(Boolean).join(' · ');
  if (b.itemType === 'READY_MADE') return [b.name, b.artNo && `Art ${b.artNo}`, b.size && `Size ${b.size}`, b.shade].filter(Boolean).join(' · ');
  return [b.category, b.name, b.size, b.shade].filter(Boolean).join(' · ');
}

export function unitLabel(uom: string): string {
  return ({ METERS: 'm', PCS: 'pcs', GROSS: 'gross', BOXES: 'boxes', PACKETS: 'packets' } as Record<string, string>)[uom] ?? uom.toLowerCase();
}

const round3 = (n: number) => Math.round(n * 1000) / 1000;
const wholeUnits = (uom: string) => uom !== 'METERS';

function parseQuantity(value: unknown, uom: string, label: string): number {
  const qty = Number(value);
  if (!Number.isFinite(qty) || qty <= 0) throw new ReturnError(`${label}: enter a quantity above 0.`);
  if (wholeUnits(uom) && !Number.isInteger(qty)) throw new ReturnError(`${label}: ${unitLabel(uom)} must be a whole number.`);
  return round3(qty);
}

async function run(res: Response, work: () => Promise<unknown>, status = 200) {
  try {
    res.status(status).json(await work());
  } catch (err: any) {
    if (err instanceof ReturnError) { res.status(err.status).json({ error: err.message }); return; }
    if (err?.code === 'P2002') { res.status(409).json({ error: 'Another return was saved at the same moment. Please try again.' }); return; }
    console.error('Return failed:', err);
    res.status(500).json({ error: 'Failed to save the return' });
  }
}

// ─── Customer returns ────────────────────────────────────────────────────────

function returnableLines(dc: { lines: Array<{ id: string; quantity: number; cutReference: string | null; batch: any; returnLines: { quantity: number }[] }> }) {
  return dc.lines.map(line => {
    const returned = round3(line.returnLines.reduce((sum, r) => sum + r.quantity, 0));
    return {
      dcLineId: line.id,
      batchCode: line.batch.batchCode,
      cutReference: line.cutReference,
      itemType: line.batch.itemType,
      description: itemDescription(line.batch),
      category: line.batch.category, brand: line.batch.brand, quality: line.batch.quality, shade: line.batch.shade,
      size: line.batch.size, name: line.batch.name, artNo: line.batch.artNo,
      uom: line.batch.uom,
      shipped: line.quantity,
      returned,
      returnable: Math.max(0, round3(line.quantity - returned)),
    };
  });
}

const DC_RETURN_INCLUDE = {
  lines: { include: { batch: true, returnLines: { select: { quantity: true } } }, orderBy: { createdAt: 'asc' as const } },
};

// GET /api/returns/customer/lookup/:challanNumber — what can still come back on a challan
router.get('/customer/lookup/:challanNumber', async (req: Request, res: Response) => {
  const challanNumber = String(req.params.challanNumber).trim().toUpperCase();
  const dc = await prisma.deliveryChallan.findUnique({ where: { challanNumber }, include: DC_RETURN_INCLUDE });
  if (!dc || dc.isDeleted) { res.status(404).json({ error: `Delivery challan "${challanNumber}" not found` }); return; }
  if (dc.status !== 'DISPATCHED') { res.status(400).json({ error: `${challanNumber} has not been dispatched, so nothing can be returned against it` }); return; }
  res.json({
    dc: { id: dc.id, challanNumber: dc.challanNumber, customerName: dc.customerName, destination: dc.destination, dispatchedAt: dc.dispatchedAt },
    lines: returnableLines(dc),
  });
});

// POST /api/returns/customer — receive returned goods; each line becomes a new labelled batch
router.post('/customer', async (req: Request, res: Response) => {
  const { dcId, reason, remarks } = req.body;
  const lines: any[] = Array.isArray(req.body.lines) ? req.body.lines : [];

  await run(res, async () => {
    if (!CUSTOMER_RETURN_REASONS.includes(reason)) throw new ReturnError('Choose a return reason.');
    if (lines.length === 0) throw new ReturnError('Enter the quantity returned on at least one line.');
    if (new Set(lines.map(l => l.dcLineId)).size !== lines.length) throw new ReturnError('Each challan line can appear only once in a return.');

    const created = await prisma.$transaction(async (tx) => {
      const dc = await tx.deliveryChallan.findUnique({ where: { id: String(dcId) }, include: DC_RETURN_INCLUDE });
      if (!dc || dc.isDeleted) throw new ReturnError('Delivery challan not found', 404);
      if (dc.status !== 'DISPATCHED') throw new ReturnError(`${dc.challanNumber} has not been dispatched.`);
      const available = new Map(returnableLines(dc).map(l => [l.dcLineId, l]));

      const prepared = lines.map(input => {
        const dcLine = dc.lines.find(l => l.id === input.dcLineId);
        const info = available.get(input.dcLineId);
        if (!dcLine || !info) throw new ReturnError(`A line does not belong to ${dc.challanNumber}.`);
        const label = info.cutReference || info.batchCode;
        const quantity = parseQuantity(input.quantity, dcLine.batch.uom, label);
        if (quantity > info.returnable + 0.001) {
          throw new ReturnError(`${label}: only ${info.returnable} ${unitLabel(info.uom)} can still be returned (shipped ${info.shipped}, already returned ${info.returned}).`);
        }
        const condition = input.condition === 'DAMAGED' ? 'DAMAGED' : input.condition === 'GOOD' ? 'GOOD' : null;
        if (!condition) throw new ReturnError(`${label}: choose Good or Damaged.`);
        return { dcLine, quantity, condition, notes: String(input.notes ?? '').trim() || null };
      });

      const returnNumber = await nextDocumentNumber('CR', async prefix =>
        (await tx.customerReturn.findFirst({ where: { returnNumber: { startsWith: prefix } }, orderBy: { returnNumber: 'desc' }, select: { returnNumber: true } }))?.returnNumber);

      const customerReturn = await tx.customerReturn.create({
        data: {
          returnNumber, dcId: dc.id, customerId: dc.customerId, customerName: dc.customerName,
          reason, remarks: String(remarks ?? '').trim() || null, createdById: req.user!.userId,
        },
      });

      for (const p of prepared) {
        const original = p.dcLine.batch;
        const batchCode = await nextBatchCode(tx, original);
        const batch = await tx.itemBatch.create({
          data: {
            batchCode,
            itemType: original.itemType, category: original.category, brand: original.brand, quality: original.quality,
            shade: original.shade, size: original.size, name: original.name, artNo: original.artNo, uom: original.uom,
            quantity: p.quantity,
            // Good stock waits for put-away; damaged stock is held until someone inspects it
            status: p.condition === 'GOOD' ? 'IN_STOCK' : 'QC_HOLD',
            clientId: original.clientId, clientName: original.clientName,
            notes: `Returned by ${dc.customerName} on ${returnNumber} (from ${p.dcLine.cutReference || original.batchCode}, ${dc.challanNumber})${p.notes ? `: ${p.notes}` : ''}`,
          },
        });
        await tx.customerReturnLine.create({
          data: { returnId: customerReturn.id, dcLineId: p.dcLine.id, batchId: batch.id, quantity: p.quantity, condition: p.condition, notes: p.notes },
        });
        await tx.transaction.create({
          data: {
            batchId: batch.id, type: 'STOCK_IN', quantityMoved: p.quantity, previousQuantity: 0, newQuantity: p.quantity,
            operatorId: req.user!.userId, referenceType: 'CUSTOMER_RETURN', referenceId: returnNumber,
            notes: `Customer return from ${dc.customerName} against ${dc.challanNumber} (${REASON_LABEL[reason]}), ${p.condition === 'GOOD' ? 'back to stock' : 'held for inspection'}`,
          },
        });
      }

      return tx.customerReturn.findUnique({
        where: { id: customerReturn.id },
        include: { lines: { include: { batch: true, dcLine: { select: { cutReference: true, batch: { select: { batchCode: true } } } } } } },
      });
    }, { timeout: 30_000 });
    return created;
  }, 201);
});

// GET /api/returns/customer — recent customer returns
router.get('/customer', async (req: Request, res: Response) => {
  const q = String(req.query.search ?? '').trim();
  const returns = await prisma.customerReturn.findMany({
    where: q ? { OR: [
      { returnNumber: { contains: q, mode: 'insensitive' } },
      { customerName: { contains: q, mode: 'insensitive' } },
      { dc: { challanNumber: { contains: q, mode: 'insensitive' } } },
    ] } : undefined,
    include: { dc: { select: { challanNumber: true } }, createdBy: { select: { name: true } }, lines: { select: { quantity: true, condition: true, batch: { select: { uom: true } } } } },
    orderBy: { createdAt: 'desc' },
    take: 200,
  });
  res.json(returns);
});

// GET /api/returns/customer/:id
router.get('/customer/:id', async (req: Request, res: Response) => {
  const found = await prisma.customerReturn.findUnique({
    where: { id: req.params.id as string },
    include: {
      dc: { select: { challanNumber: true, dispatchedAt: true, destination: true } },
      createdBy: { select: { name: true } },
      lines: { include: { batch: true, dcLine: { select: { cutReference: true, quantity: true, batch: { select: { batchCode: true } } } } } },
    },
  });
  if (!found) { res.status(404).json({ error: 'Return not found' }); return; }
  res.json(found);
});

// GET /api/returns/customer/:id/print — return receipt (A4)
router.get('/customer/:id/print', async (req: Request, res: Response) => {
  const r = await prisma.customerReturn.findUnique({
    where: { id: req.params.id as string },
    include: { dc: true, createdBy: true, lines: { include: { batch: true, dcLine: { include: { batch: { select: { batchCode: true } } } } } } },
  });
  if (!r) { res.status(404).send('Return not found'); return; }
  const html = await renderPrintDocument({
    title: 'Customer Return Receipt',
    number: r.returnNumber,
    meta: [
      ['Customer', r.customerName], ['Return Date', formatDate(r.createdAt)],
      ['Against DC', r.dc.challanNumber], ['DC Date', formatDate(r.dc.dispatchedAt ?? r.dc.createdAt)],
      ['Reason', REASON_LABEL[r.reason] ?? r.reason], ['Received By', r.createdBy.name],
      ['Remarks', r.remarks ?? ''],
    ],
    columns: [
      { header: '#', align: 'center', width: '32px' }, { header: 'Item' }, { header: 'Shipped As', width: '140px' },
      { header: 'New Label', width: '140px' }, { header: 'Condition', width: '80px' }, { header: 'Quantity', align: 'right', width: '90px' },
    ],
    rows: r.lines.map((l, i) => [
      String(i + 1), itemDescription(l.batch), l.dcLine.cutReference || l.dcLine.batch.batchCode, l.batch.batchCode,
      l.condition === 'GOOD' ? 'Good' : 'Damaged', `${l.quantity} ${unitLabel(l.batch.uom)}`,
    ]),
    note: 'Damaged goods are held for quality inspection before they can be used again.',
    signatures: ['Received By', 'Checked By', 'Returned By (Customer)'],
  });
  res.set('Content-Type', 'text/html').send(html);
});

// ─── Returns to supplier ─────────────────────────────────────────────────────

const SUPPLIER_BATCH_INCLUDE = {
  grn: { select: { supplierId: true, supplierName: true, grnNumber: true } },
  poLine: { select: { po: { select: { supplierId: true, supplierName: true, poNumber: true } } } },
  batchLocations: { include: { location: { select: { code: true } } } },
};

// Which supplier a batch came from, when the system knows
function batchSupplier(batch: { grn: { supplierId: string | null; supplierName: string } | null; poLine: { po: { supplierId: string | null; supplierName: string } } | null }) {
  if (batch.grn) return { id: batch.grn.supplierId, name: batch.grn.supplierName };
  if (batch.poLine) return { id: batch.poLine.po.supplierId, name: batch.poLine.po.supplierName };
  return null;
}

function sameSupplier(origin: { id: string | null; name: string }, supplierId: string | null, supplierName: string) {
  if (origin.id && supplierId) return origin.id === supplierId;
  return origin.name.trim().toLowerCase() === supplierName.trim().toLowerCase();
}

// GET /api/returns/supplier/lookup/:batchCode — a roll/box being scanned for return
router.get('/supplier/lookup/:batchCode', async (req: Request, res: Response) => {
  const batchCode = String(req.params.batchCode).trim().toUpperCase();
  const batch = await prisma.itemBatch.findUnique({ where: { batchCode }, include: SUPPLIER_BATCH_INCLUDE });
  if (!batch) { res.status(404).json({ error: `Barcode "${batchCode}" not found` }); return; }
  if (batch.status === 'OUT' || batch.quantity <= 0) { res.status(400).json({ error: `${batchCode} has no stock left` }); return; }
  res.json({
    id: batch.id, batchCode: batch.batchCode, itemType: batch.itemType, description: itemDescription(batch),
    category: batch.category, brand: batch.brand, quality: batch.quality, shade: batch.shade, size: batch.size, name: batch.name, artNo: batch.artNo,
    uom: batch.uom, quantity: batch.quantity, status: batch.status,
    locations: batch.batchLocations.map(bl => bl.location.code),
    supplier: batchSupplier(batch),
  });
});

// POST /api/returns/supplier — send stock back; partial quantities cut the roll
router.post('/supplier', async (req: Request, res: Response) => {
  const { reason, remarks } = req.body;
  const lines: any[] = Array.isArray(req.body.lines) ? req.body.lines : [];

  await run(res, async () => {
    if (!SUPPLIER_RETURN_REASONS.includes(reason)) throw new ReturnError('Choose a return reason.');
    if (lines.length === 0) throw new ReturnError('Scan at least one roll or box to return.');
    const codes = lines.map(l => String(l.batchCode ?? '').trim().toUpperCase());
    if (new Set(codes).size !== codes.length) throw new ReturnError('Each barcode can appear only once in a return.');

    let supplierId: string | null = req.body.supplierId ? String(req.body.supplierId) : null;
    let supplierName = String(req.body.supplierName ?? '').trim();
    if (supplierId) {
      const supplier = await prisma.supplier.findUnique({ where: { id: supplierId } });
      if (!supplier) throw new ReturnError('Supplier not found.');
      supplierName = supplier.name;
    }
    if (!supplierName) throw new ReturnError('Choose the supplier the goods go back to.');

    return prisma.$transaction(async (tx) => {
      const prepared = [];
      for (const [i, input] of lines.entries()) {
        const batch = await tx.itemBatch.findUnique({ where: { batchCode: codes[i] }, include: SUPPLIER_BATCH_INCLUDE });
        if (!batch) throw new ReturnError(`Barcode "${codes[i]}" not found.`);
        if (batch.status === 'OUT' || batch.quantity <= 0) throw new ReturnError(`${batch.batchCode} has no stock left.`);
        const quantity = parseQuantity(input.quantity, batch.uom, batch.batchCode);
        if (quantity > batch.quantity + 0.001) throw new ReturnError(`${batch.batchCode}: only ${batch.quantity} ${unitLabel(batch.uom)} in stock.`);
        const origin = batchSupplier(batch);
        if (origin && !sameSupplier(origin, supplierId, supplierName)) {
          throw new ReturnError(`${batch.batchCode} came from ${origin.name}, not ${supplierName}.`);
        }
        const packed = await tx.deliveryChallanLine.findFirst({
          where: { batchId: batch.id, dc: { status: 'DRAFT', isDeleted: false } },
          include: { dc: { select: { challanNumber: true } } },
        });
        if (packed) throw new ReturnError(`${batch.batchCode} is packed in draft challan ${packed.dc.challanNumber}. Remove it there first.`);
        prepared.push({ batch, quantity });
      }

      const returnNumber = await nextDocumentNumber('SR', async prefix =>
        (await tx.supplierReturn.findFirst({ where: { returnNumber: { startsWith: prefix } }, orderBy: { returnNumber: 'desc' }, select: { returnNumber: true } }))?.returnNumber);
      const created = await tx.supplierReturn.create({
        data: { returnNumber, supplierId, supplierName, reason, remarks: String(remarks ?? '').trim() || null, createdById: req.user!.userId },
      });

      for (const { batch, quantity } of prepared) {
        const remaining = Math.max(0, round3(batch.quantity - quantity));
        const full = remaining <= 0.001;
        const fromLocations = batch.batchLocations.map(bl => bl.location.code).join(', ') || 'unplaced';
        await tx.itemBatch.update({
          where: { id: batch.id },
          data: full
            ? { quantity: 0, status: 'OUT' }
            : { quantity: { decrement: quantity }, status: batch.status === 'QC_HOLD' ? 'QC_HOLD' : 'PARTIALLY_USED' },
        });
        // The piece leaves; a cut remainder is relabelled and put away again
        await tx.batchLocation.deleteMany({ where: { batchId: batch.id } });
        await tx.supplierReturnLine.create({ data: { returnId: created.id, batchId: batch.id, quantity, remainingQty: full ? 0 : remaining } });
        await tx.transaction.create({
          data: {
            batchId: batch.id, type: full ? 'STOCK_OUT' : 'PARTIAL_CUT', quantityMoved: quantity,
            previousQuantity: batch.quantity, newQuantity: full ? 0 : remaining,
            operatorId: req.user!.userId, referenceType: 'SUPPLIER_RETURN', referenceId: returnNumber,
            notes: `Returned to ${supplierName} (${REASON_LABEL[reason]}) from ${fromLocations}${full ? '' : `; remainder ${remaining} ${unitLabel(batch.uom)} goes back to put-away`}`,
          },
        });
      }

      return tx.supplierReturn.findUnique({ where: { id: created.id }, include: { lines: { include: { batch: true } } } });
    }, { timeout: 30_000 });
  }, 201);
});

// GET /api/returns/supplier — recent returns to suppliers
router.get('/supplier', async (req: Request, res: Response) => {
  const q = String(req.query.search ?? '').trim();
  const returns = await prisma.supplierReturn.findMany({
    where: q ? { OR: [
      { returnNumber: { contains: q, mode: 'insensitive' } },
      { supplierName: { contains: q, mode: 'insensitive' } },
    ] } : undefined,
    include: { createdBy: { select: { name: true } }, lines: { select: { quantity: true, batch: { select: { uom: true } } } } },
    orderBy: { createdAt: 'desc' },
    take: 200,
  });
  res.json(returns);
});

// GET /api/returns/supplier/:id
router.get('/supplier/:id', async (req: Request, res: Response) => {
  const found = await prisma.supplierReturn.findUnique({
    where: { id: req.params.id as string },
    include: { createdBy: { select: { name: true } }, lines: { include: { batch: true } } },
  });
  if (!found) { res.status(404).json({ error: 'Return not found' }); return; }
  res.json(found);
});

// GET /api/returns/supplier/:id/print — return challan that travels with the goods (A4)
router.get('/supplier/:id/print', async (req: Request, res: Response) => {
  const r = await prisma.supplierReturn.findUnique({
    where: { id: req.params.id as string },
    include: { createdBy: true, supplier: true, lines: { include: { batch: true } } },
  });
  if (!r) { res.status(404).send('Return not found'); return; }
  const totals = new Map<string, number>();
  for (const l of r.lines) totals.set(l.batch.uom, round3((totals.get(l.batch.uom) ?? 0) + l.quantity));
  const html = await renderPrintDocument({
    title: 'Return to Supplier',
    number: r.returnNumber,
    meta: [
      ['Supplier', r.supplierName], ['Return Date', formatDate(r.createdAt)],
      ['Supplier GSTIN', r.supplier?.gstin ?? ''], ['Reason', REASON_LABEL[r.reason] ?? r.reason],
      ['Prepared By', r.createdBy.name], ['Remarks', r.remarks ?? ''],
    ],
    columns: [
      { header: '#', align: 'center', width: '32px' }, { header: 'Item' }, { header: 'Barcode', width: '150px' },
      { header: 'Supplier Bundle', width: '110px' }, { header: 'Quantity', align: 'right', width: '100px' },
    ],
    rows: r.lines.map((l, i) => [
      String(i + 1), itemDescription(l.batch), l.batch.batchCode, l.batch.supplierBundle ?? '', `${l.quantity} ${unitLabel(l.batch.uom)}`,
    ]),
    totalLabel: 'TOTAL',
    totalValue: [...totals].map(([uom, qty]) => `${qty} ${unitLabel(uom)}`).join(' + '),
    signatures: ['Prepared By', 'Dispatched By', 'Received By (Supplier)'],
  });
  res.set('Content-Type', 'text/html').send(html);
});

export default router;
