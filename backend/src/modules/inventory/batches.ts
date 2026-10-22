import { Router, Request, Response } from 'express';
import prisma from '../../lib/prisma';
import { generateSmartBatchCodePrefix } from '../../utils/batch-code';
import { requireAuth, requirePermission } from '../../middleware/auth';
import { autoLearnAttributes } from '../master-data/attributes';
import { allowsDecimals, fabricUnitFor, unitLabel } from '../../utils/units';
import { recordAllocationReceipt } from '../purchasing/allocations';

const router = Router();

router.use(requireAuth);

// GET /api/batches — list with filters
router.get('/', requirePermission('inv.aging'), async (req: Request, res: Response) => {
  const { status, search, brand, quality, shade } = req.query;
  
  const statusFilter: any = status
    ? { status: status as string }
    : { status: { in: ['IN_STOCK', 'PARTIALLY_USED', 'QC_HOLD'] }, quantity: { gt: 0 } };

  const batches = await prisma.itemBatch.findMany({
    where: {
      ...statusFilter,
      ...(brand && { brand: { contains: String(brand), mode: 'insensitive' } }),
      ...(quality && { quality: { contains: String(quality), mode: 'insensitive' } }),
      ...(shade && { shade: { contains: String(shade), mode: 'insensitive' } }),
      ...(search && {
        OR: [
          { batchCode: { contains: search as string, mode: 'insensitive' } },
          { brand: { contains: search as string, mode: 'insensitive' } },
          { shade: { contains: search as string, mode: 'insensitive' } },
          { quality: { contains: search as string, mode: 'insensitive' } },
          { name: { contains: search as string, mode: 'insensitive' } },
          { artNo: { contains: search as string, mode: 'insensitive' } },
          { category: { contains: search as string, mode: 'insensitive' } },
        ],
      }),
    } as any,
    include: {
      batchLocations: { include: { location: true } },
    },
    orderBy: { createdAt: 'desc' },
  });
  res.json(batches);
});

// GET /api/batches/pending-putaway — items received at Entry Gate awaiting shelf placement
router.get('/pending-putaway', requirePermission('ops.put_away', 'ops.dock_queue'), async (_req: Request, res: Response) => {
  try {
    const batches = await prisma.itemBatch.findMany({
      where: {
        status: { in: ['IN_STOCK', 'PARTIALLY_USED'] },
        quantity: { gt: 0 },
      },
      include: {
        batchLocations: { include: { location: true } },
        transactions: {
          take: 1,
          orderBy: { createdAt: 'desc' },
          select: { type: true, notes: true, referenceId: true }
        },
        poLine: {
          include: {
            po: {
              select: {
                poNumber: true,
                supplierName: true,
                targetClient: true,
              }
            }
          }
        }
      },
      orderBy: { createdAt: 'desc' },
    });

    const pending = batches
      .map(b => {
        const assignedQty = b.batchLocations.reduce((sum, bl) => sum + bl.quantity, 0);
        const unassignedQty = Math.max(0, parseFloat((b.quantity - assignedQty).toFixed(2)));
        return {
          ...b,
          assignedQty,
          unassignedQty,
          isFullyPlaced: unassignedQty <= 0,
        };
      })
      .filter(b => b.unassignedQty > 0);

    res.json(pending);
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to fetch pending put-away items', details: err.message });
  }
});

// GET /api/batches/:id
router.get('/:id', requirePermission('inv.dashboard'), async (req: Request, res: Response) => {
  let batch = await prisma.itemBatch.findUnique({
    where: { id: req.params.id as string },
    include: {
      batchLocations: { include: { location: true } },
      poLine: {
        include: {
          po: {
            include: { supplier: true }
          }
        }
      },
      grn: {
        include: {
          receivedBy: { select: { id: true, name: true } },
          po: true
        }
      },
      transactions: {
        include: { operator: { select: { name: true } } },
        orderBy: { createdAt: 'desc' },
      },
    },
  });

  if (!batch) { res.status(404).json({ error: 'Batch not found' }); return; }
  res.json(batch);
});

// GET /api/batches/by-code/:code — instant scan barcode lookup (fast, no heavy table scans)
router.get('/by-code/:code', requirePermission('ops.put_away', 'ops.dock_queue', 'ops.exit_gate', 'inv.adjustments', 'inv.relocations'), async (req: Request, res: Response) => {
  const batch = await prisma.itemBatch.findUnique({
    where: { batchCode: req.params.code as string },
    include: {
      batchLocations: { include: { location: true } },
      poLine: {
        include: {
          po: {
            include: { supplier: true }
          }
        }
      },
      grn: {
        include: {
          receivedBy: { select: { id: true, name: true } },
          po: true
        }
      },
      transactions: {
        include: { operator: { select: { name: true } } },
        orderBy: { createdAt: 'desc' },
      },
    },
  });

  if (!batch) { res.status(404).json({ error: 'Batch not found' }); return; }
  res.json(batch);
});

// POST /api/batches/:id/qc-hold — Place batch on Quality Inspection Hold
router.post('/:id/qc-hold', requirePermission('inv.dashboard'), async (req: Request, res: Response) => {
  const { id } = req.params;
  const { notes } = req.body;

  const batch = await prisma.itemBatch.findUnique({ where: { id: id as string } });
  if (!batch) { res.status(404).json({ error: 'Batch not found' }); return; }

  const updated = await prisma.itemBatch.update({
    where: { id: id as string },
    data: { status: 'QC_HOLD' }
  });

  await prisma.transaction.create({
    data: {
      batchId: batch.id,
      type: 'INTERNAL_TRANSFER',
      quantityMoved: batch.quantity,
      previousQuantity: batch.quantity,
      newQuantity: batch.quantity,
      operatorId: req.user!.userId,
      referenceType: 'QC_INSPECTION',
      notes: notes ? `Placed on QC_HOLD: ${notes}` : 'Placed on QC_HOLD pending quality approval',
    }
  });

  res.json({ success: true, message: `Batch ${batch.batchCode} placed on QC Hold`, batch: updated });
});

// POST /api/batches/:id/qc-approve — Approve Quality and release batch for storage/dispatch
router.post('/:id/qc-approve', requirePermission('inv.dashboard'), async (req: Request, res: Response) => {
  const { id } = req.params;
  const { notes } = req.body;

  const batch = await prisma.itemBatch.findUnique({ where: { id: id as string } });
  if (!batch) { res.status(404).json({ error: 'Batch not found' }); return; }

  const newStatus = batch.quantity > 0 ? 'IN_STOCK' : 'OUT';
  const updated = await prisma.itemBatch.update({
    where: { id: id as string },
    data: { status: newStatus }
  });

  await prisma.transaction.create({
    data: {
      batchId: batch.id,
      type: 'INTERNAL_TRANSFER',
      quantityMoved: batch.quantity,
      previousQuantity: batch.quantity,
      newQuantity: batch.quantity,
      operatorId: req.user!.userId,
      referenceType: 'QC_APPROVAL',
      notes: notes ? `Quality Approved: ${notes}` : 'Quality Approved and released to IN_STOCK',
    }
  });

  res.json({ success: true, message: `Batch ${batch.batchCode} Quality Approved`, batch: updated });
});

// POST /api/batches — manual or bulk batch creation
router.post('/', requirePermission('ops.entry_gate'), async (req: Request, res: Response) => {
  const {
    itemType,
    category,
    brand,
    quality,
    qualityName,
    shade,
    size,
    name,
    artNo,
    uom,
    quantity,
    poLineId,
    notes,
    supplierBundle,
    invoiceRef,
    clientId,
    clientName,
  } = req.body;
  
  if (!quantity) {
    res.status(400).json({ error: 'quantity is required' });
    return;
  }
  
  if (!brand && !quality && !name) {
    res.status(400).json({ error: 'Brand or Item Name is required' });
    return;
  }

  const meterVal = parseFloat(quantity);
  const resolvedBrand = (brand || 'ITEM').trim();
  const resolvedQuality = (quality || '').trim();
  const resolvedQualityName = itemType === 'ACCESSORY' || itemType === 'READY_MADE' ? null : (qualityName ? String(qualityName).trim() || null : null);
  const resolvedShade = (shade || '').trim();
  const resolvedType = itemType || 'FABRIC';

  // Fabric is measured in its fabric type's unit (meters, or kg for e.g. Knits), never what the screen sends
  let resolvedUom: string = uom || (resolvedType === 'FABRIC' ? 'METERS' : 'PCS');
  let resolvedCategory: string | null = category ? String(category).trim() : null;
  if (resolvedType === 'FABRIC') {
    const fabricUnit = await fabricUnitFor(prisma, resolvedCategory);
    if (!fabricUnit) {
      res.status(400).json({ error: `Fabric type "${resolvedCategory ?? ''}" is not in the master catalogue.` });
      return;
    }
    resolvedUom = fabricUnit;
    resolvedCategory = resolvedCategory!.toUpperCase();
  }
  if (!Number.isFinite(meterVal) || meterVal <= 0) {
    res.status(400).json({ error: 'quantity must be a number above 0' });
    return;
  }
  if (!allowsDecimals(resolvedUom) && !Number.isInteger(meterVal)) {
    res.status(400).json({ error: `Quantity in ${unitLabel(resolvedUom)} must be a whole number` });
    return;
  }

  // Learn typed values into the master attribute catalog once the batch is saved
  const learnAttributes = () => autoLearnAttributes([
    { type: 'BRAND', value: resolvedType === 'ACCESSORY' ? null : brand },
    { type: 'QUALITY', value: quality, category: resolvedCategory },
    { type: 'QUALITY_NAME', value: resolvedQualityName, category: resolvedCategory },
    { type: 'FABRIC_TYPE', value: resolvedType === 'READY_MADE' ? category : null },
    { type: 'SHADE', value: shade },
    { type: 'ITEM_NAME', value: name, category: resolvedType },
    { type: 'ART_NO', value: artNo },
    { type: 'ACCESSORY_CATEGORY', value: resolvedType === 'ACCESSORY' ? category : null },
  ]).catch(() => {});

  // If poLineId is provided, we run this as a transaction to update the PO line
  if (poLineId) {
    const result = await prisma.$transaction(async (tx) => {
      const prefix = generateSmartBatchCodePrefix(resolvedBrand, resolvedQuality, resolvedShade, {
        itemType: resolvedType,
        name,
        size,
        category: resolvedCategory ?? undefined,
      });
      const latestBatch = await tx.itemBatch.findFirst({
        where: { batchCode: { startsWith: prefix } },
        orderBy: { batchCode: 'desc' },
        select: { batchCode: true }
      });
      let nextSeq = 1;
      if (latestBatch) {
        const parts = latestBatch.batchCode.split('-');
        const lastNum = parseInt(parts[parts.length - 1], 10);
        if (!isNaN(lastNum)) {
          nextSeq = lastNum + 1;
        }
      }
      let batchCode = `${prefix}${String(nextSeq).padStart(4, '0')}`;
      while (await tx.itemBatch.findUnique({ where: { batchCode } })) {
        nextSeq++;
        batchCode = `${prefix}${String(nextSeq).padStart(4, '0')}`;
      }

      // Fill the line's client allocations; the roll is earmarked for the client it fills
      const requestedName = clientName ? String(clientName).trim() || null : null;
      const allocation = await recordAllocationReceipt(tx, poLineId, meterVal, { clientId, clientName: requestedName });

      const batch = await tx.itemBatch.create({
        data: {
          batchCode,
          itemType: resolvedType,
          brand: resolvedBrand,
          quality: resolvedQuality || null,
          qualityName: resolvedQualityName,
          shade: resolvedShade || null,
          category: resolvedCategory,
          size: size || null,
          name: name || null,
          artNo: artNo || null,
          uom: resolvedUom,
          quantity: meterVal,
          poLineId,
          supplierBundle: supplierBundle ? String(supplierBundle).trim() : null,
          invoiceRef: invoiceRef ? String(invoiceRef).trim() : null,
          clientId: clientId || allocation?.clientId || null,
          clientName: requestedName || allocation?.clientName || null,
          notes
        },
        include: { batchLocations: true },
      });

      await tx.transaction.create({
        data: { batchId: batch.id, type: 'STOCK_IN', quantityMoved: meterVal, operatorId: req.user!.userId },
      });

      const line = await tx.purchaseOrderLine.update({
        where: { id: poLineId },
        data: { receivedQty: { increment: meterVal } },
        include: { po: { include: { lines: true } } },
      });

      const po = line.po;
      const allReceived = po.lines.every((l: any) => l.receivedQty >= l.orderedQty);
      const anyReceived = po.lines.some((l: any) => l.receivedQty > 0);
      
      const status = allReceived ? 'RECEIVED' : anyReceived ? 'PARTIALLY_RECEIVED' : 'PENDING';
      if (status !== po.status) {
        await tx.purchaseOrder.update({ where: { id: po.id }, data: { status } });
      }

      return batch;
    });

    res.json(result);
    learnAttributes();
  } else {
    // Direct entry (no PO)
    const result = await prisma.$transaction(async (tx) => {
      const prefix = generateSmartBatchCodePrefix(resolvedBrand, resolvedQuality, resolvedShade, {
        itemType: resolvedType,
        name,
        size,
        category: resolvedCategory ?? undefined,
      });
      const latestBatch = await tx.itemBatch.findFirst({
        where: { batchCode: { startsWith: prefix } },
        orderBy: { batchCode: 'desc' },
        select: { batchCode: true }
      });
      let nextSeq = 1;
      if (latestBatch) {
        const parts = latestBatch.batchCode.split('-');
        const lastNum = parseInt(parts[parts.length - 1], 10);
        if (!isNaN(lastNum)) {
          nextSeq = lastNum + 1;
        }
      }
      let batchCode = `${prefix}${String(nextSeq).padStart(4, '0')}`;
      while (await tx.itemBatch.findUnique({ where: { batchCode } })) {
        nextSeq++;
        batchCode = `${prefix}${String(nextSeq).padStart(4, '0')}`;
      }

      const batch = await tx.itemBatch.create({
        data: {
          batchCode,
          itemType: resolvedType,
          brand: resolvedBrand,
          quality: resolvedQuality || null,
          qualityName: resolvedQualityName,
          shade: resolvedShade || null,
          category: resolvedCategory,
          size: size || null,
          name: name || null,
          artNo: artNo || null,
          uom: resolvedUom,
          quantity: meterVal,
          supplierBundle: supplierBundle ? String(supplierBundle).trim() : null,
          invoiceRef: invoiceRef ? String(invoiceRef).trim() : null,
          clientId: clientId || null,
          clientName: clientName ? String(clientName).trim() : null,
          notes
        },
        include: { batchLocations: true },
      });

      await tx.transaction.create({
        data: { batchId: batch.id, type: 'STOCK_IN', quantityMoved: meterVal, operatorId: req.user!.userId },
      });

      return batch;
    });

    res.json(result);
    learnAttributes();
  }
});

// POST /api/batches/:id/reallocate-client — Reallocate roll to a different client or General Stock
router.post('/:id/reallocate-client', requirePermission('inv.dashboard'), async (req: Request, res: Response) => {
  const id = String(req.params.id);
  const { clientId, clientName, notes } = req.body;

  try {
    const existing = await prisma.itemBatch.findUnique({ where: { id } });
    if (!existing) {
      res.status(404).json({ error: 'Batch not found' });
      return;
    }

    const prevClient = existing.clientName || 'General Stock';
    const newClient = (clientName && clientName.trim()) ? clientName.trim() : null;
    const resolvedClientId = newClient ? (clientId || null) : null;

    const updated = await prisma.$transaction(async (tx) => {
      const b = await tx.itemBatch.update({
        where: { id },
        data: {
          clientId: resolvedClientId,
          clientName: newClient,
        },
        include: { batchLocations: { include: { location: true } } }
      });

      await tx.transaction.create({
        data: {
          batchId: id,
          type: 'INTERNAL_TRANSFER',
          quantityMoved: 0,
          previousQuantity: existing.quantity,
          newQuantity: existing.quantity,
          referenceType: 'CLIENT_REALLOCATION',
          referenceId: existing.batchCode,
          operatorId: req.user!.userId,
          notes: notes?.trim() || `Client earmark changed from "${prevClient}" to "${newClient || 'General Stock'}"`
        }
      });

      return b;
    });

    res.json(updated);
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Failed to reallocate client' });
  }
});

export default router;
