import { Router, Request, Response } from 'express';
import prisma from '../../lib/prisma';
import { requireAuth, requirePermission } from '../../middleware/auth';

const router = Router();

router.use(requireAuth);

// POST /api/transactions/adjust — supervisor physical count / damage adjustment
router.post('/adjust', requirePermission('inv.adjustments'), async (req: Request, res: Response) => {
  const { batchCode, newQuantity, reason, notes } = req.body;
  if (!batchCode || newQuantity === undefined || newQuantity === null) {
    res.status(400).json({ error: 'batchCode and newQuantity are required' });
    return;
  }
  const qty = parseFloat(newQuantity);
  if (isNaN(qty) || qty < 0) {
    res.status(400).json({ error: 'newQuantity must be a valid non-negative number' });
    return;
  }

  const batch = await prisma.itemBatch.findUnique({ where: { batchCode: batchCode.trim() } });
  if (!batch) {
    res.status(404).json({ error: `Item with Batch Code "${batchCode}" not found` });
    return;
  }

  const prevQty = batch.quantity;
  const delta = parseFloat((qty - prevQty).toFixed(2));
  const newStatus = qty <= 0.001 ? 'OUT' : (batch.status === 'QC_HOLD' ? 'QC_HOLD' : 'PARTIALLY_USED');

  const { updatedBatch, transaction } = await prisma.$transaction(async (tx) => {
    await tx.itemBatch.update({
      where: { id: batch.id },
      data: {
        quantity: qty,
        status: newStatus,
      },
    });

    // Keep shelf quantities within the new total. A depleted roll leaves its shelves;
    // a reduced roll is trimmed from its most recent placements first. An increase
    // stays unplaced and shows up in the put-away queue.
    if (qty <= 0.001) {
      await tx.batchLocation.deleteMany({ where: { batchId: batch.id } });
    } else {
      const placements = await tx.batchLocation.findMany({
        where: { batchId: batch.id },
        orderBy: { assignedAt: 'desc' },
      });
      let excess = placements.reduce((sum, bl) => sum + bl.quantity, 0) - qty;
      for (const bl of placements) {
        if (excess <= 0.001) break;
        if (bl.quantity <= excess + 0.001) {
          await tx.batchLocation.delete({ where: { id: bl.id } });
          excess -= bl.quantity;
        } else {
          await tx.batchLocation.update({
            where: { id: bl.id },
            data: { quantity: parseFloat((bl.quantity - excess).toFixed(2)) },
          });
          excess = 0;
        }
      }
    }

    const transaction = await tx.transaction.create({
      data: {
        batchId: batch.id,
        type: delta >= 0 ? 'STOCK_IN' : 'STOCK_OUT',
        quantityMoved: Math.abs(delta),
        previousQuantity: prevQty,
        newQuantity: qty,
        referenceType: 'SUPERVISOR_ADJUSTMENT',
        notes: `${reason || 'Manual Adjustment'}${notes ? `: ${notes}` : ''}`,
        operatorId: req.user!.userId,
      },
      include: {
        operator: { select: { name: true } },
      },
    });

    const updatedBatch = await tx.itemBatch.findUnique({
      where: { id: batch.id },
      include: { batchLocations: { include: { location: true } } },
    });

    return { updatedBatch, transaction };
  });

  res.json({ batch: updatedBatch, transaction });
});

// POST /api/transactions/transfer — whole unit warehouse shelf relocation
router.post('/transfer', requirePermission('inv.relocations'), async (req: Request, res: Response) => {
  const { batchCode, fromLocationCode, toLocationCode, quantity } = req.body;
  if (!batchCode || !toLocationCode) {
    res.status(400).json({ error: 'batchCode and toLocationCode are required' });
    return;
  }

  const batch = await prisma.itemBatch.findUnique({ where: { batchCode: batchCode.trim() } });
  if (!batch) {
    res.status(404).json({ error: `Item with Batch Code "${batchCode}" not found` });
    return;
  }

  if (batch.status === 'OUT' || batch.quantity <= 0.001) {
    res.status(400).json({ error: `Batch "${batchCode}" is depleted/out of stock and cannot be relocated.` });
    return;
  }

  // Enforce whole unit relocation rule (no partial batch splitting)
  if (quantity !== undefined && quantity !== null) {
    const requestedQty = parseFloat(quantity);
    if (!isNaN(requestedQty) && Math.abs(requestedQty - batch.quantity) > 0.01) {
      res.status(400).json({
        error: `Partial unit relocations are not permitted. Only whole units can be moved to preserve 1-to-1 barcode tracking. Full unit quantity is ${batch.quantity} ${batch.uom || ''}.`
      });
      return;
    }
  }

  const toLoc = await prisma.location.findUnique({ where: { code: toLocationCode.trim().toUpperCase() } });
  if (!toLoc || !toLoc.isActive) {
    res.status(404).json({ error: `Destination location "${toLocationCode}" not found` });
    return;
  }

  let fromLoc = null;
  if (fromLocationCode) {
    fromLoc = await prisma.location.findUnique({ where: { code: fromLocationCode.trim().toUpperCase() } });
  }

  const wholeQty = batch.quantity;

  const result = await prisma.$transaction(async (tx) => {
    // 1. Remove all previous shelf location assignments for this batch
    await tx.batchLocation.deleteMany({ where: { batchId: batch.id } });

    // 2. Assign entire batch to new location
    await tx.batchLocation.create({
      data: {
        batchId: batch.id,
        locationId: toLoc.id,
        quantity: wholeQty,
        assignedBy: req.user!.userId,
      },
    });

    // 3. Record audit transaction
    const t = await tx.transaction.create({
      data: {
        batchId: batch.id,
        type: 'INTERNAL_TRANSFER',
        quantityMoved: wholeQty,
        previousQuantity: wholeQty,
        newQuantity: wholeQty,
        fromLocationId: fromLoc?.id || null,
        toLocationId: toLoc.id,
        operatorId: req.user!.userId,
        notes: `Relocated full unit (${wholeQty} ${batch.uom || ''}) from ${fromLocationCode || 'Dock/Unassigned'} to ${toLocationCode}`,
      },
      include: {
        operator: { select: { name: true } },
      },
    });

    return t;
  });

  res.json({ success: true, transaction: result });
});

// GET /api/transactions — full movement history
router.get('/', requirePermission('inv.audit_log', 'inv.dashboard'), async (req: Request, res: Response) => {
  const { batchId, type, from, to, operatorId } = req.query;

  const where: any = {
    ...(batchId && { batchId: batchId as string }),
    ...(operatorId && { operatorId: operatorId as string }),
    ...(from || to
      ? {
          createdAt: {
            ...(from && { gte: new Date(from as string) }),
            ...(to && { lte: new Date(to as string) }),
          },
        }
      : {}),
  };

  if (type === 'PUT_AWAY') {
    where.type = 'INTERNAL_TRANSFER';
    where.OR = [
      { referenceType: 'PUT_AWAY' },
      { notes: { contains: 'put-away', mode: 'insensitive' } },
      { notes: { contains: 'put away', mode: 'insensitive' } },
      { notes: { contains: 'placement', mode: 'insensitive' } },
      { notes: { contains: 'assigned', mode: 'insensitive' } },
    ];
  } else if (type === 'RELOCATION') {
    where.type = 'INTERNAL_TRANSFER';
    where.OR = [
      { referenceType: 'RELOCATION' },
      { notes: { contains: 'relocat', mode: 'insensitive' } },
      { fromLocationId: { not: null } },
    ];
  } else if (type) {
    where.type = type as any;
  }

  const transactions = await prisma.transaction.findMany({
    where,
    include: {
      batch: true,
      operator: { select: { name: true } },
    },
    orderBy: { createdAt: 'desc' },
    take: 300,
  });

  res.json(transactions);
});

export default router;
