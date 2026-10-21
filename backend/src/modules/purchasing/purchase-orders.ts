import { Router, Request, Response } from 'express';
import prisma from '../../lib/prisma';
import { requireAuth, requirePermission } from '../../middleware/auth';
import bwipjs from 'bwip-js';
import { generateSmartBatchCodePrefix } from '../../utils/batch-code';
import { autoLearnAttributes } from '../master-data/attributes';
import { formatDate } from '../../utils/format';
import { escapeHtml, companyLogoDataUri } from '../../utils/html';
import { recordAllocationReceipt } from './allocations';

const router = Router();

router.use(requireAuth);

export function computeClientBreakdown(po: any) {
  const map = new Map<string, { clientName: string; allocatedQty: number; receivedQty: number; uom: string }>();

  for (const line of (po.lines || [])) {
    const uom = line.uom || (line.itemType === 'FABRIC' ? 'METERS' : 'PCS');
    for (const a of line.allocations || []) {
      const name = (a.clientName || '').trim() || 'General Stock';
      const existing = map.get(name) || { clientName: name, allocatedQty: 0, receivedQty: 0, uom };
      existing.allocatedQty += Number(a.allocatedQty) || 0;
      existing.receivedQty += Number(a.receivedQty) || 0;
      map.set(name, existing);
    }
  }

  return Array.from(map.values()).map(item => ({
    ...item,
    allocatedQty: Math.round(item.allocatedQty * 100) / 100,
    receivedQty: Math.round(item.receivedQty * 100) / 100,
    remainingQty: Math.max(0, Math.round((item.allocatedQty - item.receivedQty) * 100) / 100),
    progress: item.allocatedQty > 0 ? Math.min(100, Math.round((item.receivedQty / item.allocatedQty) * 100)) : 0
  }));
}

// GET /api/purchase-orders — all POs
router.get('/', requirePermission('po.view'), async (_req: Request, res: Response) => {
  const pos = await prisma.purchaseOrder.findMany({
    where: { isDeleted: false },
    include: {
      supplier: true,
      lines: {
        include: {
          allocations: true,
        }
      },
      grns: { select: { id: true }, orderBy: { createdAt: 'desc' }, take: 1 },
    },
    orderBy: { createdAt: 'desc' },
  });

  const formatted = pos.map(po => ({
    ...po,
    totalOrdered: po.lines.reduce((sum, l) => sum + l.orderedQty, 0),
    totalReceived: po.lines.reduce((sum, l) => sum + l.receivedQty, 0),
    clientBreakdown: computeClientBreakdown(po),
  }));

  res.json(formatted);
});

// GET /api/purchase-orders/meta/suppliers — suppliers for dropdown & autocomplete
router.get('/meta/suppliers', requirePermission('po.create'), async (_req: Request, res: Response) => {
  const suppliers = await prisma.supplier.findMany({
    where: { isActive: true },
    select: { id: true, code: true, name: true, address: true, city: true, phone: true },
    orderBy: { name: 'asc' }
  });

  const formatted = suppliers.map(s => ({
    id: s.id,
    supplierId: s.id,
    code: s.code,
    supplierName: s.name,
    supplierAddress: s.address,
    city: s.city,
    phone: s.phone,
  }));

  res.json(formatted);
});

// GET /api/purchase-orders/by-number/:poNumber — scanner lookup
router.get('/by-number/:poNumber', requirePermission('ops.entry_gate'), async (req: Request, res: Response) => {
  const po = await prisma.purchaseOrder.findUnique({
    where: { poNumber: String(req.params.poNumber).trim() },
    include: { supplier: true, lines: true },
  });
  if (!po) { res.status(404).json({ error: 'Purchase Order not found' }); return; }
  res.json(po);
});

// ─── SUPPLIER INBOUND (FIFO & AUTO-MATCH RECEIVING) ─────────────────────────

// GET /api/purchase-orders/supplier-inbound/:supplierId/pending — all pending items from this supplier
router.get('/supplier-inbound/:supplierId/pending', requirePermission('ops.entry_gate'), async (req: Request, res: Response) => {
  try {
    const { supplierId } = req.params;

    const supplier = await prisma.supplier.findUnique({
      where: { id: supplierId as string }
    });
    if (!supplier) {
      res.status(404).json({ error: 'Supplier not found' });
      return;
    }

    // Find all active POs for this supplier (by supplierId or supplierName for legacy POs)
    const pos = await prisma.purchaseOrder.findMany({
      where: {
        OR: [
          { supplierId: supplier.id },
          { supplierName: { equals: supplier.name, mode: 'insensitive' } }
        ],
        status: { in: ['PENDING', 'PARTIALLY_RECEIVED'] },
        isDeleted: false
      },
      include: {
        lines: {
          include: { allocations: true }
        }
      },
      orderBy: [
        { expectedDate: 'asc' },
        { createdAt: 'asc' }
      ]
    });

    // Group open lines where orderedQty > receivedQty by direct attributes
    const pendingItemsMap: Record<string, {
      sku: any;
      totalOrderedQty: number;
      totalReceivedQty: number;
      totalRemainingQty: number;
      openOrders: Array<{
        poId: string;
        poNumber: string;
        lineId: string;
        targetClient: string | null;
        expectedDate: Date;
        orderedQty: number;
        receivedQty: number;
        remainingQty: number;
        allocations?: any[];
      }>;
    }> = {};

    let totalPendingQty = 0;
    const poSet = new Set<string>();

    for (const po of pos) {
      poSet.add(po.id);
      for (const line of po.lines) {
        const remaining = Math.max(0, line.orderedQty - line.receivedQty);
        if (remaining > 0) {
          totalPendingQty += remaining;
          const skuKey = `ATTR_${line.itemType || 'FABRIC'}_${line.brand || ''}_${line.quality || ''}_${line.shade || ''}_${line.name || ''}_${line.artNo || ''}_${line.size || ''}`;

          if (!pendingItemsMap[skuKey]) {
            const itemObj = {
              id: skuKey,
              itemType: line.itemType || 'FABRIC',
              category: line.category,
              brand: line.brand || '',
              quality: line.quality || '',
              shade: line.shade || '',
              size: line.size || null,
              name: line.name || null,
              artNo: line.artNo || null,
              uom: line.uom || (line.itemType === 'FABRIC' ? 'METERS' : 'PCS'),
            };

            pendingItemsMap[skuKey] = {
              sku: itemObj,
              totalOrderedQty: 0,
              totalReceivedQty: 0,
              totalRemainingQty: 0,
              openOrders: []
            };
          }

          pendingItemsMap[skuKey].totalOrderedQty = Math.round((pendingItemsMap[skuKey].totalOrderedQty + line.orderedQty) * 100) / 100;
          pendingItemsMap[skuKey].totalReceivedQty = Math.round((pendingItemsMap[skuKey].totalReceivedQty + line.receivedQty) * 100) / 100;
          pendingItemsMap[skuKey].totalRemainingQty = Math.round((pendingItemsMap[skuKey].totalRemainingQty + remaining) * 100) / 100;

          pendingItemsMap[skuKey].openOrders.push({
            poId: po.id,
            poNumber: po.poNumber,
            lineId: line.id,
            targetClient: po.targetClient,
            expectedDate: po.expectedDate,
            orderedQty: line.orderedQty,
            receivedQty: line.receivedQty,
            remainingQty: Math.round(remaining * 100) / 100,
            allocations: line.allocations
          });
        }
      }
    }

    const pendingItems = Object.values(pendingItemsMap).sort((a, b) => {
      const brandCmp = (a.sku?.brand || '').localeCompare(b.sku?.brand || '');
      if (brandCmp !== 0) return brandCmp;
      return (a.sku?.shade || '').localeCompare(b.sku?.shade || '');
    });

    res.json({
      supplier: {
        id: supplier.id,
        code: supplier.code,
        name: supplier.name,
        city: supplier.city,
        address: supplier.address,
      },
      totalOpenPOs: poSet.size,
      totalPendingQty: Math.round(totalPendingQty * 100) / 100,
      pendingItems,
      allOpenPOs: pos.map(p => ({
        id: p.id,
        poNumber: p.poNumber,
        expectedDate: p.expectedDate,
        targetClient: p.targetClient,
        linesCount: p.lines.length
      }))
    });
  } catch (err: any) {
    console.error('Error in supplier-inbound pending:', err);
    res.status(500).json({ error: err.message || 'Failed to fetch pending items' });
  }
});

// POST /api/purchase-orders/supplier-inbound/receive-roll — smart FIFO matching & roll barcode creation
router.post('/supplier-inbound/receive-roll', requirePermission('ops.entry_gate'), async (req: Request, res: Response) => {
  try {
    const {
      supplierId,
      brand,
      quality,
      shade,
      itemType = 'FABRIC',
      category,
      size,
      name,
      artNo,
      quantity,
      supplierBundle,
      invoiceRef,
      targetPoLineId,
      allowUnlinked = false,
      overrideTolerance = false,
      clientId,
      clientName
    } = req.body;

    const qty = parseFloat(quantity);
    if (!qty || qty <= 0) {
      res.status(400).json({ error: 'Valid physical roll quantity is required' });
      return;
    }

    const supplier = await prisma.supplier.findUnique({
      where: { id: supplierId as string }
    });
    if (!supplier) {
      res.status(404).json({ error: 'Supplier not found' });
      return;
    }

    // Determine target PO Line
    let matchedLine: any = null;
    let isUnlinked = false;

    if (targetPoLineId) {
      matchedLine = await prisma.purchaseOrderLine.findUnique({
        where: { id: targetPoLineId as string },
        include: { po: true }
      });
      if (!matchedLine) {
        res.status(404).json({ error: 'Selected target PO Line not found' });
        return;
      }
    } else {
      // Smart FIFO Matching across all open POs of this supplier
      const candidateLines = await prisma.purchaseOrderLine.findMany({
        where: {
          po: {
            OR: [
              { supplierId: supplier.id },
              { supplierName: { equals: supplier.name, mode: 'insensitive' } }
            ],
            status: { in: ['PENDING', 'PARTIALLY_RECEIVED'] }
          },
          ...(brand ? { brand: { equals: String(brand).trim(), mode: 'insensitive' } } : {}),
          ...(quality ? { quality: { equals: String(quality).trim(), mode: 'insensitive' } } : {}),
          ...(shade ? { shade: { equals: String(shade).trim(), mode: 'insensitive' } } : {}),
          ...(name ? { name: { equals: String(name).trim(), mode: 'insensitive' } } : {}),
          ...(size ? { size: { equals: String(size).trim(), mode: 'insensitive' } } : {}),
          ...(artNo ? { artNo: { equals: String(artNo).trim(), mode: 'insensitive' } } : {}),
          ...(category ? { category: { equals: String(category).trim(), mode: 'insensitive' } } : {}),
        },
        include: { po: true },
        orderBy: [
          { po: { expectedDate: 'asc' } },
          { po: { createdAt: 'asc' } }
        ]
      });

      let openCandidates = candidateLines.filter(l => l.orderedQty > l.receivedQty);

      if (openCandidates.length === 0 && candidateLines.length === 0) {
        // Fallback: match by supplier open lines with matching itemType or brand
        const broaderLines = await prisma.purchaseOrderLine.findMany({
          where: {
            po: {
              OR: [
                { supplierId: supplier.id },
                { supplierName: { equals: supplier.name, mode: 'insensitive' } }
              ],
              status: { in: ['PENDING', 'PARTIALLY_RECEIVED'] }
            },
            ...(brand ? { brand: { equals: String(brand).trim(), mode: 'insensitive' } } : {}),
            ...(itemType ? { itemType } : {})
          },
          include: { po: true },
          orderBy: [
            { po: { expectedDate: 'asc' } },
            { po: { createdAt: 'asc' } }
          ]
        });
        openCandidates = broaderLines.filter(l => l.orderedQty > l.receivedQty);
        if (openCandidates.length > 0) {
          matchedLine = openCandidates[0];
        } else if (broaderLines.length > 0) {
          matchedLine = broaderLines[0];
        }
      } else if (openCandidates.length > 0) {
        matchedLine = openCandidates[0];
      } else if (candidateLines.length > 0) {
        matchedLine = candidateLines[0];
      }

      if (!matchedLine) {
        if (allowUnlinked) {
          isUnlinked = true;
        } else {
          res.status(404).json({
            error: 'NO_OPEN_PO',
            message: `No open purchase order found from ${supplier.name} matching this item. Toggle "Direct Inward" if you wish to accept this roll as unlinked buffer stock.`
          });
          return;
        }
      }
    }

    // Over-receiving tolerance validation (+10% maximum tolerance on textile purchase orders)
    if (matchedLine && !overrideTolerance) {
      const currentReceived = matchedLine.receivedQty || 0;
      const ordered = matchedLine.orderedQty;
      const newTotal = parseFloat((currentReceived + qty).toFixed(2));
      const maxAllowed = parseFloat((ordered * 1.10).toFixed(2));
      if (newTotal > maxAllowed) {
        res.status(400).json({
          error: 'TOLERANCE_EXCEEDED',
          message: `Receiving this roll of ${qty}${matchedLine.uom || 'm'} will exceed PO ${matchedLine.po.poNumber} ordered quantity (${ordered}) by more than 10% standard tolerance (New Total: ${newTotal}, Max Allowed: ${maxAllowed}). Confirm to proceed with over-receipt.`,
          orderedQty: ordered,
          currentReceived,
          rollQty: qty,
          newTotal,
          maxAllowed,
          poNumber: matchedLine.po.poNumber,
          poLineId: matchedLine.id
        });
        return;
      }
    }

    // Execute atomic transaction: create ItemBatch, create Transaction, update POLine & PO
    const result = await prisma.$transaction(async (tx) => {
      const resolvedBrand = matchedLine?.brand || brand || 'ROLL';
      const resolvedQuality = matchedLine?.quality || quality || '';
      const resolvedShade = matchedLine?.shade || shade || '';

      // Generate unique smart batch code (item brand, or the supplier when the item has none)
      const prefix = generateSmartBatchCodePrefix(
        matchedLine?.brand || brand || supplier.name,
        resolvedQuality || matchedLine?.category || '',
        resolvedShade || matchedLine?.artNo || ''
      );

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
      const requestedName = clientName && String(clientName).trim() ? String(clientName).trim() : null;
      const allocation = matchedLine
        ? await recordAllocationReceipt(tx, matchedLine.id, qty, { clientId, clientName: requestedName })
        : null;
      const resolvedClientId = clientId || allocation?.clientId || null;
      const resolvedClientName = requestedName || allocation?.clientName || null;

      // Create physical roll batch. It stays unfinalized (grnId = null) until its GRN is issued.
      const createdBatch = await tx.itemBatch.create({
        data: {
          batchCode,
          itemType: matchedLine?.itemType || itemType,
          category: matchedLine?.category || category || null,
          brand: resolvedBrand,
          quality: resolvedQuality || null,
          shade: resolvedShade || null,
          size: matchedLine?.size || size || null,
          name: matchedLine?.name || name || null,
          artNo: matchedLine?.artNo || artNo || null,
          uom: matchedLine?.uom || (itemType === 'FABRIC' ? 'METERS' : 'PCS'),
          quantity: qty,
          poLineId: matchedLine ? matchedLine.id : null,
          supplierBundle: supplierBundle ? supplierBundle.trim() : null,
          invoiceRef: invoiceRef ? invoiceRef.trim() : null,
          status: 'IN_STOCK',
          clientId: resolvedClientId,
          clientName: resolvedClientName,
        }
      });

      // Record STOCK_IN audit transaction
      await tx.transaction.create({
        data: {
          batchId: createdBatch.id,
          type: 'STOCK_IN',
          quantityMoved: qty,
          referenceType: matchedLine ? 'PURCHASE_ORDER' : 'DIRECT_INWARD',
          referenceId: matchedLine ? matchedLine.po.poNumber : (invoiceRef || 'INBOUND'),
          operatorId: req.user!.userId,
        }
      });

      let updatedPo = null;
      let isCompleted = false;

      // Update PO Line and PO Status if matched
      if (matchedLine) {
        const updatedLine = await tx.purchaseOrderLine.update({
          where: { id: matchedLine.id },
          data: { receivedQty: { increment: qty } }
        });

        // Check overall PO status
        const allLines = await tx.purchaseOrderLine.findMany({
          where: { poId: matchedLine.poId }
        });
        const allReceived = allLines.every(l => l.receivedQty >= l.orderedQty);
        const someReceived = allLines.some(l => l.receivedQty > 0);

        const newPoStatus = allReceived ? 'RECEIVED' : (someReceived ? 'PARTIALLY_RECEIVED' : 'PENDING');

        updatedPo = await tx.purchaseOrder.update({
          where: { id: matchedLine.poId },
          data: { status: newPoStatus }
        });

        isCompleted = updatedLine.receivedQty >= updatedLine.orderedQty;
      }

      return {
        batch: createdBatch,
        matchedLine,
        updatedPo,
        isCompleted
      };
    });

    res.status(201).json({
      success: true,
      batch: result.batch,
      batchCode: result.batch.batchCode,
      quantity: result.batch.quantity,
      unlinked: isUnlinked,
      matchedPo: result.matchedLine ? {
        poId: result.matchedLine.po.id,
        poNumber: result.matchedLine.po.poNumber,
        targetClient: result.matchedLine.po.targetClient,
        orderedQty: result.matchedLine.orderedQty,
        newReceivedQty: (result.matchedLine.receivedQty || 0) + qty,
        isCompleted: result.isCompleted,
        status: result.updatedPo?.status
      } : null
    });
  } catch (err: any) {
    console.error('Error in receive-roll:', err);
    res.status(500).json({ error: err.message || 'Failed to receive roll' });
  }
});

// GET /api/purchase-orders/supplier-inbound/session-rolls — live session feed of unfinalized rolls received today
router.get('/supplier-inbound/session-rolls', requirePermission('ops.entry_gate'), async (req: Request, res: Response) => {
  try {
    const { supplierId, invoiceRef } = req.query;

    if (!supplierId) {
      return res.json([]);
    }

    const supplier = await prisma.supplier.findUnique({ where: { id: String(supplierId) }, select: { id: true, name: true } });
    if (!supplier) {
      return res.json([]);
    }

    // Every roll from this supplier not yet finalized on a GRN, whatever day it arrived.
    // POs may be linked to the supplier by id or (older entries) by name.
    const where: any = {
      grnId: null,
      poLine: {
        po: {
          OR: [
            { supplierId: supplier.id },
            { supplierName: { equals: supplier.name, mode: 'insensitive' } }
          ]
        }
      }
    };

    if (invoiceRef && String(invoiceRef).trim()) {
      where.invoiceRef = String(invoiceRef).trim();
    }

    const batches = await prisma.itemBatch.findMany({
      where,
      include: {
        poLine: {
          include: { po: true }
        }
      },
      orderBy: { createdAt: 'desc' },
    });

    res.json(batches);
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Failed to fetch session rolls' });
  }
});

// ─── INBOUND BUNDLE DISCREPANCIES (Shortages, Missing Items, Defective Bundles) ─

// POST /api/purchase-orders/supplier-inbound/discrepancies — report item missing/short in bundle
router.post('/supplier-inbound/discrepancies', requirePermission('ops.entry_gate'), async (req: Request, res: Response) => {
  try {
    const {
      supplierId,
      invoiceRef,
      bundleNumber,
      itemType,
      category,
      brand,
      quality,
      shade,
      size,
      name,
      artNo,
      issueType,
      expectedQty,
      receivedQty = 0,
      notes
    } = req.body;

    if (!supplierId || !invoiceRef || !bundleNumber) {
      res.status(400).json({ error: 'Supplier ID, Delivery Invoice/Challan Ref, and Bundle Number are required' });
      return;
    }

    const record = await prisma.inboundDiscrepancy.create({
      data: {
        supplierId,
        invoiceRef: String(invoiceRef).trim(),
        bundleNumber: String(bundleNumber).trim(),
        itemType: itemType || 'FABRIC',
        category: category || null,
        brand: brand || null,
        quality: quality || null,
        shade: shade || null,
        size: size || null,
        name: name || null,
        artNo: artNo || null,
        issueType: issueType || 'MISSING_FROM_BUNDLE',
        expectedQty: expectedQty ? parseFloat(expectedQty) : null,
        receivedQty: receivedQty ? parseFloat(receivedQty) : 0,
        notes: notes ? String(notes).trim() : null,
        reportedById: req.user!.userId
      },
      include: {
        reportedBy: { select: { id: true, name: true, username: true } },
        supplier: { select: { id: true, name: true, code: true } }
      }
    });
    res.status(201).json(record);
  } catch (err: any) {
    console.error('Error in creating discrepancy:', err);
    res.status(500).json({ error: err.message || 'Failed to record bundle discrepancy' });
  }
});

// GET /api/purchase-orders/supplier-inbound/discrepancies — list discrepancies for this delivery
router.get('/supplier-inbound/discrepancies', requirePermission('ops.entry_gate'), async (req: Request, res: Response) => {
  try {
    const { supplierId, invoiceRef } = req.query;

    const where: any = {};
    if (supplierId) where.supplierId = String(supplierId);
    if (invoiceRef) where.invoiceRef = String(invoiceRef).trim();

    const records = await prisma.inboundDiscrepancy.findMany({
      where,
      include: {
        reportedBy: { select: { id: true, name: true, username: true } },
        supplier: { select: { id: true, name: true, code: true } }
      },
      orderBy: { createdAt: 'desc' }
    });
    res.json(records);
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Failed to fetch discrepancies' });
  }
});

// DELETE /api/purchase-orders/supplier-inbound/discrepancies/:id — delete a discrepancy
router.delete('/supplier-inbound/discrepancies/:id', requirePermission('ops.entry_gate'), async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    await prisma.inboundDiscrepancy.deleteMany({ where: { id: id as string } });
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Failed to remove discrepancy' });
  }
});

// GET /api/purchase-orders/:id — single PO detail (supports UUID id and poNumber)
router.get('/:id', requirePermission('po.view', 'po.create', 'ops.entry_gate'), async (req: Request, res: Response) => {
  try {
    const idOrNumber = String(req.params.id || '').trim();

    // 1. Try finding by unique ID first
    let po: any = await prisma.purchaseOrder.findUnique({
      where: { id: idOrNumber },
      include: {
        supplier: true,
        lines: {
          include: {
            batches: true,
            allocations: true,
          }
        },
        grns: {
          include: {
            receivedBy: { select: { id: true, name: true, username: true } },
            _count: { select: { lines: true, batches: true, discrepancies: true } }
          },
          orderBy: { createdAt: 'desc' }
        }
      },
    });

    // 2. If not found by ID, look up by poNumber (e.g. PO-26-0001)
    if (!po) {
      po = await prisma.purchaseOrder.findFirst({
        where: { poNumber: { equals: idOrNumber, mode: 'insensitive' } },
        include: {
          supplier: true,
          lines: {
            include: {
              batches: true,
              allocations: true,
            }
          },
          grns: {
            include: {
              receivedBy: { select: { id: true, name: true, username: true } },
              _count: { select: { lines: true, batches: true, discrepancies: true } }
            },
            orderBy: { createdAt: 'desc' }
          }
        },
      });
    }

    if (!po) {
      res.status(404).json({ error: 'Purchase Order not found' });
      return;
    }

    res.json({
      ...po,
      clientBreakdown: computeClientBreakdown(po),
    });
  } catch (err: any) {
    console.error('Error fetching PO detail:', err);
    res.status(500).json({ error: err.message || 'Failed to fetch purchase order' });
  }
});

// POST /api/purchase-orders
router.post('/', requirePermission('po.create'), async (req: Request, res: Response) => {
  const { supplierId, supplierName, expectedDate, targetClient, notes, lines } = req.body;
  if ((!supplierId && !supplierName) || !expectedDate || !lines || lines.length === 0) {
    res.status(400).json({ error: 'supplier, expectedDate, and lines are required' });
    return;
  }

  // Create PO within a transaction to ensure SKUs and suppliers are linked safely
  const po = await prisma.$transaction(async (tx) => {
    let finalSupplierId = supplierId || null;
    let finalSupplierName = (supplierName || '').trim();

    if (finalSupplierId) {
      const sup = await tx.supplier.findUnique({ where: { id: finalSupplierId } });
      if (sup) {
        finalSupplierName = sup.name;
      }
    } else if (finalSupplierName) {
      // Find matching supplier by name or create one
      let sup = await tx.supplier.findFirst({
        where: { name: { equals: finalSupplierName, mode: 'insensitive' } }
      });
      if (sup) {
        finalSupplierId = sup.id;
      }
    }

    // Generate PO-YY-XXXX (e.g. PO-26-0001)
    const yearTwoDigits = String(new Date().getFullYear()).slice(-2);
    const prefix = `PO-${yearTwoDigits}-`;

    const latestPo = await tx.purchaseOrder.findFirst({
      where: { poNumber: { startsWith: prefix } },
      orderBy: { poNumber: 'desc' },
      select: { poNumber: true }
    });

    let nextSeq = 1;
    if (latestPo) {
      const parts = latestPo.poNumber.split('-');
      const lastNum = parseInt(parts[parts.length - 1], 10);
      if (!isNaN(lastNum)) {
        nextSeq = lastNum + 1;
      }
    }

    let poNumber = `${prefix}${String(nextSeq).padStart(4, '0')}`;
    while (await tx.purchaseOrder.findUnique({ where: { poNumber } })) {
      nextSeq++;
      poNumber = `${prefix}${String(nextSeq).padStart(4, '0')}`;
    }

    const createdPo = await tx.purchaseOrder.create({
      data: {
        poNumber,
        supplierId: finalSupplierId,
        supplierName: finalSupplierName,
        expectedDate: new Date(expectedDate),
        targetClient,
        notes,
        createdById: req.user!.userId,
      }
    });

    // Process lines one by one
    for (const l of lines) {
      const itemType = l.itemType || 'FABRIC';
      const category = l.category || null;
      const brand = (l.brand || '').trim() || null;
      const quality = (l.quality || '').trim() || null;
      const shade = (l.shade || '').trim() || null;
      const size = l.size ? String(l.size).trim() : null;
      const name = (l.name || '').trim() || null;
      const artNo = (l.artNo || '').trim().toUpperCase() || null;

      if (itemType === 'FABRIC' && (!brand || !quality || !shade || !category)) {
        throw new Error('Brand, Quality, Shade, and Category are required for Fabric lines');
      }

      let uom = l.uom;
      if (!uom) {
        if (itemType === 'FABRIC') uom = 'METERS';
        else if (itemType === 'READY_MADE') uom = 'PCS';
        else {
          const cat = (category || '').toUpperCase();
          uom = (cat === 'SHOES' || cat === 'SOCKS') ? 'PAIRS' : 'PCS';
        }
      }

      const createdLine = await tx.purchaseOrderLine.create({
        data: {
          poId: createdPo.id,
          itemType: itemType as any,
          category,
          brand,
          quality,
          shade,
          size,
          name,
          artNo,
          uom,
          orderedQty: parseFloat(l.orderedQty),
          notes: l.notes,
        }
      });

      const allocList = (Array.isArray(l.allocations) && l.allocations.length > 0)
        ? l.allocations.filter((a: any) => parseFloat(a.allocatedQty) > 0)
        : (targetClient && String(targetClient).trim()
            ? [{ clientName: String(targetClient).trim(), allocatedQty: parseFloat(l.orderedQty) }]
            : []);

      for (const alloc of allocList) {
        const allocQty = parseFloat(alloc.allocatedQty);
        if (!allocQty || allocQty <= 0) continue;
        const cName = (alloc.clientName || '').trim() || (targetClient && String(targetClient).trim()) || 'General Stock';
        await tx.poLineAllocation.create({
          data: {
            poLineId: createdLine.id,
            clientId: alloc.clientId || null,
            clientName: cName,
            allocatedQty: allocQty,
            notes: alloc.notes?.trim() || null
          }
        });
      }
    }

    return tx.purchaseOrder.findUnique({
      where: { id: createdPo.id },
      include: {
        lines: {
          include: {
            allocations: true,
          }
        }
      }
    });
  });

  // Auto-learn typed attributes into column master data
  const attributesToLearn: Array<{ type: string; value?: string | null; category?: string | null }> = [];
  for (const l of lines) {
    if (l.brand) attributesToLearn.push({ type: 'BRAND', value: l.brand });
    if (l.quality) attributesToLearn.push({ type: 'QUALITY', value: l.quality, category: l.category });
    if (l.shade) attributesToLearn.push({ type: 'SHADE', value: l.shade });
    if (l.name) attributesToLearn.push({ type: 'ITEM_NAME', value: l.name, category: l.category });
    if (l.artNo) attributesToLearn.push({ type: 'ART_NO', value: l.artNo });
  }
  if (attributesToLearn.length > 0) {
    autoLearnAttributes(attributesToLearn).catch(() => {});
  }

  res.status(201).json(po);
});

// DELETE /api/purchase-orders/:id — Soft delete a PO
router.delete('/:id', requirePermission('po.create'), async (req: Request, res: Response) => {
  const { id } = req.params;
  const po = await prisma.purchaseOrder.findUnique({ where: { id: id as string } });
  if (!po || po.isDeleted) return void res.status(404).json({ error: 'Purchase Order not found' });
  if (po.status !== 'PENDING') {
    return void res.status(400).json({ error: 'Cannot delete a PO that has been partially or fully received. Cancel it instead.' });
  }

  await prisma.purchaseOrder.update({
    where: { id: id as string },
    data: {
      status: 'CANCELLED',
      isDeleted: true,
      deletedAt: new Date()
    }
  });
  res.json({ success: true, message: `Purchase Order ${po.poNumber} cancelled and removed.` });
});

// PUT /api/purchase-orders/:id — Full update of PO and its lines
router.put('/:id', requirePermission('po.create'), async (req: Request, res: Response) => {
  const { id } = req.params;
  const { supplierId, supplierName, expectedDate, targetClient, notes, lines } = req.body;

  const po = await prisma.purchaseOrder.findUnique({ where: { id: id as string } });
  if (!po || po.isDeleted) return void res.status(404).json({ error: 'Purchase Order not found' });
  if (po.status !== 'PENDING') {
    return void res.status(400).json({ error: 'Cannot fully edit a PO that has been partially or fully received' });
  }

  const updatedPo = await prisma.$transaction(async (tx) => {
    let finalSupplierId = supplierId !== undefined ? (supplierId || null) : po.supplierId;
    let finalSupplierName = (supplierName || '').trim() || po.supplierName;

    if (finalSupplierId) {
      const sup = await tx.supplier.findUnique({ where: { id: finalSupplierId } });
      if (sup) {
        finalSupplierName = sup.name;
      }
    } else if (finalSupplierName) {
      let sup = await tx.supplier.findFirst({
        where: { name: { equals: finalSupplierName, mode: 'insensitive' } }
      });
      if (sup) {
        finalSupplierId = sup.id;
      }
    }

    // 1. Update Header
    await tx.purchaseOrder.update({
      where: { id: id as string },
      data: {
        supplierId: finalSupplierId,
        supplierName: finalSupplierName,
        expectedDate: new Date(expectedDate),
        targetClient: targetClient ? String(targetClient).trim() : null,
        notes: notes ? String(notes).trim() : null,
      }
    });

    // 2. Delete all existing lines
    await tx.purchaseOrderLine.deleteMany({ where: { poId: id as string } });

    // 3. Re-create all lines
    for (const l of lines) {
      const itemType = l.itemType || 'FABRIC';
      const category = l.category || null;
      const brand = (l.brand || '').trim() || null;
      const quality = (l.quality || '').trim() || null;
      const shade = (l.shade || '').trim() || null;
      const size = l.size ? String(l.size).trim() : null;
      const name = (l.name || '').trim() || null;
      const artNo = (l.artNo || '').trim().toUpperCase() || null;

      if (itemType === 'FABRIC' && (!brand || !quality || !shade || !category)) {
        throw new Error('Brand, Quality, Shade, and Category are required for Fabric lines');
      }

      let uom = l.uom;
      if (!uom) {
        if (itemType === 'FABRIC') uom = 'METERS';
        else if (itemType === 'READY_MADE') uom = 'PCS';
        else {
          const cat = (category || '').toUpperCase();
          uom = (cat === 'SHOES' || cat === 'SOCKS') ? 'PAIRS' : 'PCS';
        }
      }

      const createdLine = await tx.purchaseOrderLine.create({
        data: {
          poId: id as string,
          itemType: itemType as any,
          category,
          brand,
          quality,
          shade,
          size,
          name,
          artNo,
          uom,
          orderedQty: parseFloat(l.orderedQty),
          notes: l.notes,
        }
      });

      const allocList = (Array.isArray(l.allocations) && l.allocations.length > 0)
        ? l.allocations.filter((a: any) => parseFloat(a.allocatedQty) > 0)
        : (targetClient && String(targetClient).trim()
            ? [{ clientName: String(targetClient).trim(), allocatedQty: parseFloat(l.orderedQty) }]
            : []);

      for (const alloc of allocList) {
        const allocQty = parseFloat(alloc.allocatedQty);
        if (!allocQty || allocQty <= 0) continue;
        const cName = (alloc.clientName || '').trim() || (targetClient && String(targetClient).trim()) || 'General Stock';
        await tx.poLineAllocation.create({
          data: {
            poLineId: createdLine.id,
            clientId: alloc.clientId || null,
            clientName: cName,
            allocatedQty: allocQty,
            notes: alloc.notes?.trim() || null
          }
        });
      }
    }

    return tx.purchaseOrder.findUnique({
      where: { id: id as string },
      include: {
        lines: {
          include: {
            allocations: true,
          }
        }
      }
    });
  });

  // Auto-learn typed attributes into column master data
  const attributesToLearn: Array<{ type: string; value?: string | null; category?: string | null }> = [];
  for (const l of lines) {
    if (l.brand) attributesToLearn.push({ type: 'BRAND', value: l.brand });
    if (l.quality) attributesToLearn.push({ type: 'QUALITY', value: l.quality, category: l.category });
    if (l.shade) attributesToLearn.push({ type: 'SHADE', value: l.shade });
    if (l.name) attributesToLearn.push({ type: 'ITEM_NAME', value: l.name, category: l.category });
    if (l.artNo) attributesToLearn.push({ type: 'ART_NO', value: l.artNo });
  }
  if (attributesToLearn.length > 0) {
    autoLearnAttributes(attributesToLearn).catch(() => {});
  }

  res.json(updatedPo);
});

// PATCH /api/purchase-orders/:id — edit PO header or cancel (strictly allowed only for PENDING status)
router.patch('/:id', requirePermission('po.create'), async (req: Request, res: Response) => {
  const { id } = req.params;
  const { notes, status, cancellationReason } = req.body;

  const existingPo = await prisma.purchaseOrder.findUnique({ where: { id: id as string } });
  if (!existingPo || existingPo.isDeleted) return void res.status(404).json({ error: 'Purchase Order not found' });

  // Strict Rule: If PO is partially or fully received, NO editing or cancellation is allowed
  if (existingPo.status !== 'PENDING') {
    return void res.status(400).json({ error: 'Cannot edit or cancel a Purchase Order that has already been partially or fully received.' });
  }

  let finalNotes = notes;
  if (cancellationReason && status === 'CANCELLED') {
    const reasonLine = `[Cancellation Reason: ${String(cancellationReason).trim()}]`;
    finalNotes = existingPo.notes ? `${existingPo.notes}\n${reasonLine}` : reasonLine;
  }

  const po = await prisma.purchaseOrder.update({
    where: { id: id as string },
    data: {
      ...(finalNotes !== undefined && { notes: finalNotes }),
      ...(status !== undefined && { status }),
    },
  });
  res.json(po);
});

// POST /api/purchase-orders/:id/lines/:lineId/receive — log batches for a line
router.post('/:id/lines/:lineId/receive', requirePermission('ops.entry_gate'), async (req: Request, res: Response) => {
  const { id, lineId } = req.params;
  const { batches, skuOverride } = req.body; // Array of { quantity: number }, optional skuOverride

  if (!Array.isArray(batches) || batches.length === 0) {
    res.status(400).json({ error: 'batches array is required' }); return;
  }

  const line = await prisma.purchaseOrderLine.findUnique({
    where: { id: lineId as string },
    include: { po: true }
  });
  if (!line || line.poId !== id) { res.status(404).json({ error: 'Line not found' }); return; }

  // Prevent duplicate additions if line is already completely received
  if (line.receivedQty >= line.orderedQty || (line.orderedQty - line.receivedQty) <= 0.001) {
    res.status(400).json({ error: 'This PO line has already been completely received and fulfilled.' });
    return;
  }

  let totalReceived = 0;
  const newRolls: any[] = [];

  // Transaction to create batches, update line received amount, update PO status, and log transaction
  const result = await prisma.$transaction(async (tx) => {
    const brandVal = (skuOverride?.brand || line.brand || 'ITEM').trim();
    const qualityVal = (skuOverride?.quality || line.quality || '').trim();
    const shadeVal = (skuOverride?.shade || line.shade || '').trim();
    const sizeVal = (skuOverride?.size || line.size || null);
    const categoryVal = (skuOverride?.category || line.category || null);
    const nameVal = (skuOverride?.name || line.name || null);
    const artNoVal = (skuOverride?.artNo || line.artNo || null);

    for (const batch of batches) {
      const qty = parseFloat(batch.quantity);
      totalReceived += qty;

      const prefix = generateSmartBatchCodePrefix(brandVal, qualityVal, shadeVal, {
        itemType: line.itemType,
        name: nameVal || line.name || '',
        size: sizeVal || line.size || '',
        category: categoryVal || line.category || '',
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
      const requestedName = batch.clientName && String(batch.clientName).trim() ? String(batch.clientName).trim() : null;
      const allocation = await recordAllocationReceipt(tx, lineId as string, qty, { clientId: batch.clientId, clientName: requestedName });
      const rollClientId = batch.clientId || allocation?.clientId || null;
      const rollClientName = requestedName || allocation?.clientName || null;

      // Newly received rolls start unfinalized (grnId = null) until explicitly finalized via GRN action
      const createdRoll = await tx.itemBatch.create({
        data: {
          batchCode,
          itemType: line.itemType || 'FABRIC',
          category: categoryVal,
          brand: brandVal,
          quality: qualityVal || null,
          shade: shadeVal || null,
          size: sizeVal,
          name: nameVal,
          artNo: artNoVal,
          uom: line.uom || (line.itemType === 'FABRIC' ? 'METERS' : 'PCS'),
          quantity: qty,
          poLineId: lineId as string,
          supplierBundle: batch.supplierBundle || null,
          invoiceRef: batch.invoiceRef || null,
          clientId: rollClientId,
          clientName: rollClientName,
        }
      });
      newRolls.push(createdRoll);

      await tx.transaction.create({
        data: {
          batchId: createdRoll.id,
          type: 'STOCK_IN',
          quantityMoved: qty,
          operatorId: req.user!.userId,
        }
      });
    }

    const currentLineData = await tx.purchaseOrderLine.findUnique({ where: { id: lineId as string } });
    const roundedReceived = Math.round(((currentLineData?.receivedQty || 0) + totalReceived) * 100) / 100;
    const updatedLine = await tx.purchaseOrderLine.update({
      where: { id: lineId as string },
      data: { receivedQty: roundedReceived }
    });

    // Check all lines to see if PO is now fully RECEIVED or just PARTIALLY
    const allLines = await tx.purchaseOrderLine.findMany({ where: { poId: id } });
    const allReceived = allLines.every(l => l.receivedQty >= l.orderedQty);
    const someReceived = allLines.some(l => l.receivedQty > 0);

    const newStatus = allReceived ? 'RECEIVED' : (someReceived ? 'PARTIALLY_RECEIVED' : 'PENDING');
    
    await tx.purchaseOrder.update({
      where: { id },
      data: { status: newStatus }
    });

    return { updatedLine, newRolls, newStatus };
  });

  res.status(201).json(result);
});

// GET /api/purchase-orders/:id/print & /pdf — generates a clean, professional A4 document
const handlePOPrint = async (req: Request, res: Response) => {
  const { id } = req.params;
  try {
    const idOrNum = String(id).trim();
    let po = await prisma.purchaseOrder.findUnique({
      where: { id: idOrNum },
      include: {
        lines: {
          include: {
            allocations: true,
          }
        },
        createdBy: true,
        supplier: true
      }
    });

    if (!po) {
      po = await prisma.purchaseOrder.findFirst({
        where: { poNumber: { equals: idOrNum, mode: 'insensitive' } },
        include: {
          lines: {
            include: {
              allocations: true,
            }
          },
          createdBy: true,
          supplier: true
        }
      });
    }

    if (!po) {
      res.status(404).send('<h3>Purchase order not found</h3>');
      return;
    }

    const logoDataUri = companyLogoDataUri();

    // Generate Code 128 barcode for PO number
    let barcodeDataUri = '';
    try {
      const barcodeBuffer = await bwipjs.toBuffer({
        bcid: 'code128',
        text: po.poNumber,
        scale: 3,
        height: 12,
        includetext: true,
        textxalign: 'center',
        textsize: 10
      } as any);
      barcodeDataUri = `data:image/png;base64,${barcodeBuffer.toString('base64')}`;
    } catch (err) {
      console.error('Barcode generation failed', err);
    }

    // Build metadata list in GRN format
    const metaItems: { label: string; value: string }[] = [];
    
    // 1. Supplier Name
    metaItems.push({ label: 'Supplier:', value: `${po.supplierName}${po.supplier?.code ? ` (${po.supplier.code})` : ''}` });
    
    // 2. Order Date
    metaItems.push({ label: 'Order Date:', value: formatDate(po.createdAt) });
    
    // 3. Expected Delivery
    metaItems.push({ label: 'Expected Delivery:', value: formatDate(po.expectedDate) });

    // 4. Order Status
    metaItems.push({ label: 'Order Status:', value: po.status.replace('_', ' ') });

    // 5. Created By
    metaItems.push({ label: 'Created By:', value: po.createdBy?.name || '—' });

    // 6. Target Client / Supplier Address
    if (po.targetClient && po.targetClient.trim()) {
      metaItems.push({ label: 'Target Client:', value: po.targetClient.trim() });
    } else {
      const supAddr = po.supplier?.address || po.supplier?.city;
      if (supAddr && supAddr.trim()) {
        metaItems.push({ label: 'Supplier Address:', value: supAddr.trim() });
      }
    }

    let metaRowsHtml = '';
    for (let i = 0; i < metaItems.length; i += 2) {
      const item1 = metaItems[i];
      const item2 = metaItems[i + 1];
      metaRowsHtml += `
        <tr>
          <td class="meta-label">${item1.label}</td>
          <td><strong>${escapeHtml(item1.value)}</strong></td>
          ${item2 ? `<td class="meta-label">${item2.label}</td><td><strong>${escapeHtml(item2.value)}</strong></td>` : '<td></td><td></td>'}
        </tr>
      `;
    }

    const isFabric = po.lines.some((l: any) => l.itemType === 'FABRIC' || (l.uom || '').toUpperCase().startsWith('M'));
    const isReadyMade = !isFabric && po.lines.some((l: any) => l.itemType === 'READY_MADE' || (l.uom || '').toUpperCase().startsWith('P'));

    let linesHtml = '';
    for (let i = 0; i < po.lines.length; i++) {
      const line = po.lines[i];
      const brand = escapeHtml(line.brand || '—');
      const quality = escapeHtml(line.quality || '—');
      const shade = escapeHtml(line.shade || '—');
      const category = escapeHtml(line.category || '—');
      const size = escapeHtml(line.size || '—');
      const name = escapeHtml(line.name || '—');
      const artNo = escapeHtml(line.artNo || '—');
      const unit = escapeHtml(line.uom || (isFabric ? 'Meters' : (isReadyMade ? 'Pieces' : 'Units')));

      // Client allocation summary string
      const lineAllocs = line.allocations;
      const allocSummaryHtml = lineAllocs.length > 0
        ? `<div style="font-size: 10px; color: #1e40af; margin-top: 2px; font-weight: 500;">
             Allocated: ${lineAllocs.map((a: any) => `<strong>${escapeHtml(a.clientName)}</strong> (${a.allocatedQty}${isFabric ? 'm' : ''})`).join(' · ')}
           </div>`
        : (po.targetClient && po.targetClient.trim()
            ? `<div style="font-size: 10px; color: #1e40af; margin-top: 2px; font-weight: 500;">Client: <strong>${escapeHtml(po.targetClient)}</strong></div>`
            : '');

      if (isFabric) {
        linesHtml += `
          <tr>
            <td style="text-align: center;">${i + 1}</td>
            <td><strong>${category === 'PLAIN_SHIRTING' ? 'Plain Shirting' : category}</strong></td>
            <td>
              <strong>${brand}</strong>
              ${allocSummaryHtml}
            </td>
            <td>${quality}</td>
            <td>${shade}</td>
            <td style="text-align: right; font-weight: bold;">${line.orderedQty.toFixed(1)} ${unit}</td>
          </tr>
        `;
      } else {
        linesHtml += `
          <tr>
            <td style="text-align: center;">${i + 1}</td>
            <td>
              <strong>${name !== '—' ? name : brand}</strong>
              ${allocSummaryHtml}
            </td>
            <td>${category !== '—' ? category : quality}</td>
            <td>${artNo !== '—' ? artNo : quality}</td>
            <td>${shade !== '—' ? shade : size}</td>
            <td style="text-align: center;">${size !== '—' ? size : '—'}</td>
            <td style="text-align: right; font-weight: bold;">${Math.round(line.orderedQty)} ${unit}</td>
          </tr>
        `;
      }
    }

    const totalQty = po.lines.reduce((sum, l) => sum + l.orderedQty, 0);

    let tableHeadHtml = '';
    let tableFootHtml = '';

    if (isFabric) {
      tableHeadHtml = `
        <tr>
          <th style="width: 32px; text-align: center;">#</th>
          <th style="text-align: left;">Fabric Category</th>
          <th style="text-align: left;">Brand</th>
          <th style="text-align: left;">Quality</th>
          <th style="text-align: left;">Shade</th>
          <th style="width: 120px; text-align: right;">Ordered (Meters)</th>
        </tr>
      `;
      tableFootHtml = `
        <tr style="font-weight: bold; background: #f9f9f9; border-top: 2px solid #000; border-bottom: 2px solid #000;">
          <td colspan="5" style="text-align: right; padding: 8px;">TOTAL (METERS):</td>
          <td style="text-align: right; padding: 8px;">${totalQty.toFixed(1)} Meters</td>
        </tr>
      `;
    } else {
      tableHeadHtml = `
        <tr>
          <th style="width: 32px; text-align: center;">#</th>
          <th style="text-align: left;">Item Name / Brand</th>
          <th style="text-align: left;">Category</th>
          <th style="text-align: left;">Art No / Quality</th>
          <th style="text-align: left;">Color / Shade</th>
          <th style="width: 60px; text-align: center;">Size</th>
          <th style="width: 120px; text-align: right;">Ordered (${isReadyMade ? 'Pieces' : 'Units'})</th>
        </tr>
      `;
      tableFootHtml = `
        <tr style="font-weight: bold; background: #f9f9f9; border-top: 2px solid #000; border-bottom: 2px solid #000;">
          <td colspan="6" style="text-align: right; padding: 8px;">TOTAL (${isReadyMade ? 'PIECES' : 'UNITS'}):</td>
          <td style="text-align: right; padding: 8px;">${Math.round(totalQty)} ${isReadyMade ? 'Pieces' : 'Units'}</td>
        </tr>
      `;
    }

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>${po.poNumber} — Purchase Order</title>
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
          <div class="title">${po.poNumber}</div>
          ${barcodeDataUri ? `<img src="${barcodeDataUri}" alt="${po.poNumber}" style="height: 42px; object-fit: contain; margin-top: 2px;" />` : `<div class="doc-ref">${po.poNumber}</div>`}
        </div>
      </div>

      <table class="meta-table">
        ${metaRowsHtml}
      </table>

      <table class="data-table">
        <thead>
          ${tableHeadHtml}
        </thead>
        <tbody>
          ${linesHtml}
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
            <div style="font-size: 11px; font-weight: bold; margin-bottom: 2px;">Prepared By</div>
            <div style="font-size: 9.5px; color: #444;">Signature &amp; Date</div>
          </td>
          <td class="sign-cell" style="padding-left: 15px; padding-right: 15px;">
            <div class="sign-line"></div>
            <div style="font-size: 11px; font-weight: bold; margin-bottom: 2px;">Purchase Manager</div>
            <div style="font-size: 9.5px; color: #444;">Signature &amp; Date</div>
          </td>
          <td class="sign-cell" style="padding-left: 15px;">
            <div class="sign-line"></div>
            <div style="font-size: 11px; font-weight: bold; margin-bottom: 2px;">Authorized Signatory</div>
            <div style="font-size: 9.5px; color: #444;">Signature &amp; Date</div>
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
  } catch (err) {
    console.error('PO print error', err);
    res.status(500).send('<h3>Failed to generate Purchase Order document</h3>');
  }
};

router.get('/:id/print', requirePermission('po.view', 'po.create'), handlePOPrint);

export default router;
