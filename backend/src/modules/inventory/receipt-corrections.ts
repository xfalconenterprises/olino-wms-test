import { Router, Request, Response } from 'express';
import type { Prisma } from '@prisma/client';
import prisma from '../../lib/prisma';
import { requireAuth, requirePermission, userHasPermission } from '../../middleware/auth';
import { lastingUse, receivedQuantities } from '../../utils/received';
import { allowsDecimals, unitLabel } from '../../utils/units';

// Fixing a receiving mistake: the wrong quantity typed, or a roll that should not have been received.
// One correction moves everything together: the roll, its shelves, the PO's received total, the
// client split on the PO line and, once a GRN is issued, the GRN line. Nothing is deleted; every
// correction is recorded with who, when and why. Before the GRN the gate staff can correct; after
// it only a supervisor can, and the GRN prints the change as an amendment.
const router = Router();
router.use(requireAuth, requirePermission('ops.entry_gate', 'inv.adjustments'));

class CorrectionError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}

const round3 = (n: number) => Math.round(n * 1000) / 1000;

async function correctableRoll(tx: Prisma.TransactionClient, batchId: string) {
  const batch = await tx.itemBatch.findUnique({
    where: { id: batchId },
    include: { grn: { select: { id: true, grnNumber: true } }, poLine: { select: { id: true, poId: true } } },
  });
  if (!batch) throw new CorrectionError('Roll not found', 404);
  if (batch.receiptVoidedAt) throw new CorrectionError(`${batch.batchCode}'s receipt was already undone.`);
  const fromReturn = await tx.customerReturnLine.findFirst({ where: { batchId }, include: { customerReturn: { select: { returnNumber: true } } } });
  if (fromReturn) throw new CorrectionError(`${batch.batchCode} came from customer return ${fromReturn.customerReturn.returnNumber}. Cancel that return instead.`);
  // Once dispatched or sent back to the supplier, the receipt can no longer be corrected
  if (await lastingUse(tx, batchId)) throw new CorrectionError(`${batch.batchCode} has already been cut or sent out, so its receipt can't be corrected. Use Stock Adjustments.`);
  const packed = await tx.deliveryChallanLine.findFirst({
    where: { batchId, dc: { status: 'DRAFT', isDeleted: false } },
    include: { dc: { select: { challanNumber: true } } },
  });
  if (packed) throw new CorrectionError(`${batch.batchCode} is packed in draft challan ${packed.dc.challanNumber}. Remove it there first.`);
  return batch;
}

/** Shelves never hold more than the roll: the most recent placements are trimmed first. */
async function fitShelves(tx: Prisma.TransactionClient, batchId: string, quantity: number) {
  if (quantity <= 0.001) { await tx.batchLocation.deleteMany({ where: { batchId } }); return; }
  const placements = await tx.batchLocation.findMany({ where: { batchId }, orderBy: { assignedAt: 'desc' } });
  let excess = placements.reduce((sum, p) => sum + p.quantity, 0) - quantity;
  for (const p of placements) {
    if (excess <= 0.001) break;
    if (p.quantity <= excess + 0.001) { await tx.batchLocation.delete({ where: { id: p.id } }); excess -= p.quantity; }
    else { await tx.batchLocation.update({ where: { id: p.id }, data: { quantity: round3(p.quantity - excess) } }); excess = 0; }
  }
}

/** The PO line's received total, its client split and the PO's status, all moved by the same amount. */
async function movePoReceipt(tx: Prisma.TransactionClient, batch: { poLineId: string | null; clientId: string | null; clientName: string | null }, change: number) {
  if (!batch.poLineId || Math.abs(change) < 0.0005) return;
  const current = await tx.purchaseOrderLine.findUniqueOrThrow({ where: { id: batch.poLineId } });
  const line = await tx.purchaseOrderLine.update({ where: { id: current.id }, data: { receivedQty: Math.max(0, round3(current.receivedQty + change)) } });

  const allocations = await tx.poLineAllocation.findMany({ where: { poLineId: line.id }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] });
  const name = (batch.clientName ?? '').trim().toLowerCase();
  const target = allocations.find(a => (batch.clientId && a.clientId === batch.clientId) || (name && a.clientName.trim().toLowerCase() === name))
    ?? (change < 0 ? [...allocations].reverse().find(a => a.receivedQty > 0) : allocations.find(a => a.receivedQty + 0.001 < a.allocatedQty))
    ?? allocations[allocations.length - 1];
  if (target) await tx.poLineAllocation.update({ where: { id: target.id }, data: { receivedQty: Math.max(0, round3(target.receivedQty + change)) } });

  const lines = await tx.purchaseOrderLine.findMany({ where: { poId: line.poId } });
  const status = lines.every(l => l.receivedQty >= l.orderedQty) ? 'RECEIVED' : lines.some(l => l.receivedQty > 0) ? 'PARTIALLY_RECEIVED' : 'PENDING';
  await tx.purchaseOrder.update({ where: { id: line.poId }, data: { status } });
}

/** An issued GRN's line and total follow the correction; the GRN then prints it as an amendment. */
async function moveGrnReceipt(tx: Prisma.TransactionClient, batch: any, change: number) {
  if (!batch.grnId || Math.abs(change) < 0.0005) return;
  const lines = await tx.goodsReceiptNoteLine.findMany({ where: { grnId: batch.grnId } });
  const same = (a: string | null | undefined, b: string | null | undefined) => (a ?? '').trim().toLowerCase() === (b ?? '').trim().toLowerCase();
  const line = lines.find(l => batch.poLineId && l.poLineId === batch.poLineId && same(l.shade, batch.shade) && same(l.quality, batch.quality))
    ?? lines.find(l => batch.poLineId && l.poLineId === batch.poLineId)
    ?? lines.find(l => same(l.brand, batch.brand) && same(l.quality, batch.quality) && same(l.shade, batch.shade) && same(l.name, batch.name) && same(l.size, batch.size) && l.uom === batch.uom);
  if (line) {
    const receivedQty = Math.max(0, round3(line.receivedQty + change));
    await tx.goodsReceiptNoteLine.update({
      where: { id: line.id },
      data: { receivedQty, shortageQty: Math.max(0, round3((line.invoicedQty ?? receivedQty) - receivedQty)) },
    });
  }
  const grn = await tx.goodsReceiptNote.findUnique({ where: { id: batch.grnId }, select: { totalQuantity: true } });
  if (grn) await tx.goodsReceiptNote.update({ where: { id: batch.grnId }, data: { totalQuantity: Math.max(0, round3(grn.totalQuantity + change)) } });
}

function readReason(body: any) {
  const reason = String(body?.reason ?? '').trim().slice(0, 300);
  if (!reason) throw new CorrectionError('Say why it is being corrected.');
  return reason;
}

async function run(res: Response, work: () => Promise<unknown>) {
  try {
    res.json(await work());
  } catch (err: any) {
    if (err instanceof CorrectionError) { res.status(err.status).json({ error: err.message }); return; }
    console.error('Receipt correction failed:', err);
    res.status(500).json({ error: 'The correction could not be saved. Please try again.' });
  }
}

// POST /api/receipt-corrections/:batchId/quantity — { quantity, reason }: what really arrived
router.post('/:batchId/quantity', async (req: Request, res: Response) => {
  await run(res, async () => {
    const reason = readReason(req.body);
    return prisma.$transaction(async (tx) => {
      const batch = await correctableRoll(tx, String(req.params.batchId));
      if (batch.grnId && !userHasPermission(req.user!, 'inv.adjustments')) {
        throw new CorrectionError(`${batch.batchCode} is already on ${batch.grn?.grnNumber}. Only a supervisor can correct it now.`, 403);
      }
      const quantity = Number(req.body?.quantity);
      if (!Number.isFinite(quantity) || quantity <= 0) throw new CorrectionError('Enter the quantity that really arrived, above 0.');
      if (!allowsDecimals(batch.uom) && !Number.isInteger(quantity)) throw new CorrectionError(`${unitLabel(batch.uom)} must be a whole number.`);

      const received = (await receivedQuantities([batch.id])).get(batch.id) ?? batch.quantity;
      const change = round3(quantity - received);
      if (Math.abs(change) < 0.0005) throw new CorrectionError(`${batch.batchCode} is already recorded as ${received} ${unitLabel(batch.uom)}.`);
      const newQuantity = round3(batch.quantity + change);
      if (newQuantity < 0) throw new CorrectionError(`That would leave ${batch.batchCode} below zero.`);

      await tx.itemBatch.update({
        where: { id: batch.id },
        data: { quantity: newQuantity, ...(newQuantity <= 0.001 && { status: 'OUT' }) },
      });
      await fitShelves(tx, batch.id, newQuantity);
      await movePoReceipt(tx, batch, change);
      await moveGrnReceipt(tx, batch, change);
      await tx.transaction.create({
        data: {
          batchId: batch.id, type: change > 0 ? 'STOCK_IN' : 'STOCK_OUT', quantityMoved: Math.abs(change),
          previousQuantity: batch.quantity, newQuantity, operatorId: req.user!.userId,
          referenceType: 'RECEIPT_CORRECTION', referenceId: batch.grn?.grnNumber ?? null,
          notes: `Receipt corrected from ${received} to ${quantity} ${unitLabel(batch.uom)}: ${reason}`,
        },
      });
      return tx.receiptCorrection.create({
        data: {
          batchId: batch.id, batchCode: batch.batchCode, grnId: batch.grnId, poLineId: batch.poLineId, kind: 'QUANTITY',
          oldQuantity: received, newQuantity: quantity, uom: batch.uom, reason, userId: req.user!.userId, userName: req.user!.name,
        },
      });
    });
  });
});

// POST /api/receipt-corrections/:batchId/undo — { reason }: the roll should never have been received
router.post('/:batchId/undo', async (req: Request, res: Response) => {
  await run(res, async () => {
    const reason = readReason(req.body);
    return prisma.$transaction(async (tx) => {
      const batch = await correctableRoll(tx, String(req.params.batchId));
      if (batch.grnId) throw new CorrectionError(`${batch.batchCode} is already on ${batch.grn?.grnNumber}, so its receipt can't be undone. A supervisor can correct its quantity.`);
      const received = (await receivedQuantities([batch.id])).get(batch.id) ?? batch.quantity;

      await tx.itemBatch.update({ where: { id: batch.id }, data: { quantity: 0, status: 'OUT', receiptVoidedAt: new Date() } });
      await fitShelves(tx, batch.id, 0);
      await movePoReceipt(tx, batch, -received);
      await tx.transaction.create({
        data: {
          batchId: batch.id, type: 'STOCK_OUT', quantityMoved: batch.quantity, previousQuantity: batch.quantity, newQuantity: 0,
          operatorId: req.user!.userId, referenceType: 'RECEIPT_CORRECTION',
          notes: `Receipt undone (${received} ${unitLabel(batch.uom)}): ${reason}`,
        },
      });
      return tx.receiptCorrection.create({
        data: {
          batchId: batch.id, batchCode: batch.batchCode, poLineId: batch.poLineId, kind: 'UNDO',
          oldQuantity: received, newQuantity: 0, uom: batch.uom, reason, userId: req.user!.userId, userName: req.user!.name,
        },
      });
    });
  });
});

export default router;
