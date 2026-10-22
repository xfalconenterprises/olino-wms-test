import { Router, Request, Response } from 'express';
import prisma from '../../lib/prisma';
import { requireAuth, requirePermission } from '../../middleware/auth';
import { unitLabel, unitName } from '../../utils/units';

const router = Router();

router.use(requireAuth);

// Shoes and socks are stored as accessories with that category; reports count them in pairs
function reportKind(batch?: { itemType?: string | null; category?: string | null } | null): string {
  const itemType = batch?.itemType || 'FABRIC';
  if (itemType === 'ACCESSORY') {
    const category = (batch?.category || '').toLowerCase();
    if (category.includes('shoe')) return 'SHOES';
    if (category.includes('sock')) return 'SOCKS';
  }
  return itemType;
}

// ─── 1. Periodic Throughput (Daily / Monthly / Yearly) ───────────────────────────
router.get('/periodic', requirePermission('admin.reports'), async (req: Request, res: Response) => {
  const period = (req.query.period as string) || 'daily';
  const targetDateStr = (req.query.date as string) || new Date().toISOString().slice(0, 10);
  const itemTypeFilter = (req.query.itemType as string) || 'ALL';
  const categoryFilter = (req.query.category as string) || '';

  let startDate: Date;
  let endDate: Date;

  if (period === 'daily') {
    // Single day: 00:00:00 to 23:59:59
    const parts = targetDateStr.split('-');
    const year = parseInt(parts[0], 10);
    const month = parseInt(parts[1], 10) - 1;
    const day = parseInt(parts[2], 10);
    startDate = new Date(year, month, day, 0, 0, 0, 0);
    endDate = new Date(year, month, day, 23, 59, 59, 999);
  } else if (period === 'monthly') {
    // Full month: from 1st of month to last day of month
    const parts = targetDateStr.split('-');
    const year = parseInt(parts[0], 10);
    const month = parseInt(parts[1], 10) - 1;
    startDate = new Date(year, month, 1, 0, 0, 0, 0);
    endDate = new Date(year, month + 1, 0, 23, 59, 59, 999);
  } else {
    // Yearly: from Jan 1 to Dec 31
    const year = parseInt(targetDateStr.slice(0, 4), 10) || new Date().getFullYear();
    startDate = new Date(year, 0, 1, 0, 0, 0, 0);
    endDate = new Date(year, 11, 31, 23, 59, 59, 999);
  }

  // Fetch all transactions in the time window
  const transactions = await prisma.transaction.findMany({
    where: {
      createdAt: {
        gte: startDate,
        lte: endDate,
      },
      ...(itemTypeFilter === 'SHOES' || itemTypeFilter === 'SOCKS'
        ? {
            batch: {
              itemType: 'ACCESSORY',
              category: { contains: itemTypeFilter === 'SHOES' ? 'shoe' : 'sock', mode: 'insensitive' as const },
            },
          }
        : itemTypeFilter !== 'ALL' && {
            batch: {
              itemType: itemTypeFilter,
              ...(categoryFilter && { category: categoryFilter }),
            },
          }),
    },
    include: {
      batch: {
        include: {
          batchLocations: { include: { location: true } },
        },
      },
      operator: { select: { name: true } },
    },
    orderBy: { createdAt: 'desc' },
  });

  // Calculate aggregations
  let inwardFabricMeters = 0;
  let inwardFabricKg = 0;
  let inwardReadyMadePcs = 0;
  let inwardAccessoryQty = 0;
  let inwardShoesPairs = 0;
  let inwardSocksPairs = 0;

  let outwardFabricMeters = 0;
  let outwardFabricKg = 0;
  let outwardReadyMadePcs = 0;
  let outwardAccessoryQty = 0;
  let outwardShoesPairs = 0;
  let outwardSocksPairs = 0;

  const timelineMap: Record<string, { date: string; inwardQty: number; outwardQty: number; txCount: number }> = {};

  for (const tx of transactions) {
    const itemType = reportKind(tx.batch);
    const qty = tx.quantityMoved || 0;

    // Format date key (YYYY-MM-DD for monthly/daily, YYYY-MM for yearly)
    const dateKey = period === 'yearly' 
      ? tx.createdAt.toISOString().slice(0, 7) // YYYY-MM
      : tx.createdAt.toISOString().slice(0, 10); // YYYY-MM-DD

    if (!timelineMap[dateKey]) {
      timelineMap[dateKey] = {
        date: dateKey,
        inwardQty: 0,
        outwardQty: 0,
        txCount: 0,
      };
    }

    timelineMap[dateKey].txCount++;

    if (tx.type === 'STOCK_IN') {
      if (itemType === 'FABRIC') {
        if (tx.batch?.uom === 'KG') inwardFabricKg += qty; else inwardFabricMeters += qty;
      } else if (itemType === 'READY_MADE') {
        inwardReadyMadePcs += qty;
      } else if (itemType === 'ACCESSORY') {
        inwardAccessoryQty += qty;
      } else if (itemType === 'SHOES') {
        inwardShoesPairs += qty;
      } else if (itemType === 'SOCKS') {
        inwardSocksPairs += qty;
      }
      timelineMap[dateKey].inwardQty += qty;
    } else if (tx.type === 'STOCK_OUT' || tx.type === 'PARTIAL_CUT') {
      if (itemType === 'FABRIC') {
        if (tx.batch?.uom === 'KG') outwardFabricKg += qty; else outwardFabricMeters += qty;
      } else if (itemType === 'READY_MADE') {
        outwardReadyMadePcs += qty;
      } else if (itemType === 'ACCESSORY') {
        outwardAccessoryQty += qty;
      } else if (itemType === 'SHOES') {
        outwardShoesPairs += qty;
      } else if (itemType === 'SOCKS') {
        outwardSocksPairs += qty;
      }
      timelineMap[dateKey].outwardQty += qty;
    }
  }

  // Selected KPI metrics based on filter
  let selectedInward = 0;
  let selectedOutward = 0;
  let unit = 'Meters';
  // Fabric in kg alongside the main figure when a selection has both (never added to meters)
  let secondary: { inward: number; outward: number; delta: number; unit: string } | null = null;

  if (itemTypeFilter === 'FABRIC') {
    const onlyKg = inwardFabricMeters + outwardFabricMeters === 0 && inwardFabricKg + outwardFabricKg > 0;
    selectedInward = onlyKg ? inwardFabricKg : inwardFabricMeters;
    selectedOutward = onlyKg ? outwardFabricKg : outwardFabricMeters;
    unit = onlyKg ? 'Kg' : 'Meters';
    if (!onlyKg && inwardFabricKg + outwardFabricKg > 0) {
      secondary = {
        inward: parseFloat(inwardFabricKg.toFixed(2)), outward: parseFloat(outwardFabricKg.toFixed(2)),
        delta: parseFloat((inwardFabricKg - outwardFabricKg).toFixed(2)), unit: 'Kg',
      };
    }
  } else if (itemTypeFilter === 'READY_MADE') {
    selectedInward = inwardReadyMadePcs;
    selectedOutward = outwardReadyMadePcs;
    unit = 'Pieces';
  } else if (itemTypeFilter === 'ACCESSORY') {
    // Shoes and socks are accessories too
    selectedInward = inwardAccessoryQty + inwardShoesPairs + inwardSocksPairs;
    selectedOutward = outwardAccessoryQty + outwardShoesPairs + outwardSocksPairs;
    unit = 'Units';
  } else if (itemTypeFilter === 'SHOES') {
    selectedInward = inwardShoesPairs;
    selectedOutward = outwardShoesPairs;
    unit = 'Pairs';
  } else if (itemTypeFilter === 'SOCKS') {
    selectedInward = inwardSocksPairs;
    selectedOutward = outwardSocksPairs;
    unit = 'Pairs';
  } else {
    selectedInward = inwardFabricMeters + inwardFabricKg + inwardReadyMadePcs + inwardAccessoryQty + inwardShoesPairs + inwardSocksPairs;
    selectedOutward = outwardFabricMeters + outwardFabricKg + outwardReadyMadePcs + outwardAccessoryQty + outwardShoesPairs + outwardSocksPairs;
    unit = 'Mixed';
  }

  res.json({
    period,
    itemType: itemTypeFilter,
    category: categoryFilter,
    unit,
    startDate: startDate.toISOString(),
    endDate: endDate.toISOString(),
    selectedKPI: {
      inward: parseFloat(selectedInward.toFixed(2)),
      outward: parseFloat(selectedOutward.toFixed(2)),
      delta: parseFloat((selectedInward - selectedOutward).toFixed(2)),
      unit,
      secondary,
    },
    inward: {
      fabricMeters: parseFloat(inwardFabricMeters.toFixed(2)),
      fabricKg: parseFloat(inwardFabricKg.toFixed(2)),
      readyMadePcs: inwardReadyMadePcs,
      accessoryQty: inwardAccessoryQty,
      shoesPairs: inwardShoesPairs,
      socksPairs: inwardSocksPairs,
      totalPairs: inwardShoesPairs + inwardSocksPairs,
    },
    outward: {
      fabricMeters: parseFloat(outwardFabricMeters.toFixed(2)),
      fabricKg: parseFloat(outwardFabricKg.toFixed(2)),
      readyMadePcs: outwardReadyMadePcs,
      accessoryQty: outwardAccessoryQty,
      shoesPairs: outwardShoesPairs,
      socksPairs: outwardSocksPairs,
      totalPairs: outwardShoesPairs + outwardSocksPairs,
    },
    timeline: Object.values(timelineMap).sort((a, b) => a.date.localeCompare(b.date)),
    transactionsCount: transactions.length,
    transactions: transactions.map(t => ({
      id: t.id,
      type: t.type,
      batchCode: t.batch?.batchCode || '—',
      product: `${t.batch?.name || `${t.batch?.brand || ''} ${t.batch?.quality || ''}${t.batch?.qualityName ? ` (${t.batch.qualityName})` : ''} ${t.batch?.shade || ''}`}`.trim() || 'Item',
      itemType: t.batch?.itemType || 'FABRIC',
      category: t.batch?.category || null,
      size: t.batch?.size || null,
      quantity: t.quantityMoved,
      unit: unitLabel(t.batch?.uom || ((t.batch?.itemType || 'FABRIC') === 'FABRIC' ? 'METERS' : 'PCS')),
      operator: t.operator?.name || 'System',
      referenceId: t.referenceId || null,
      referenceType: t.referenceType || null,
      notes: t.notes,
      timestamp: t.createdAt,
    })),
  });
});

// ─── 2. Customer Shipments & Delivery Challans Tracker ─────────────────────────
router.get('/customer-shipments', requirePermission('admin.reports', 'inv.delivery_challans'), async (req: Request, res: Response) => {
  const { search, from, to } = req.query;

  const challans = await prisma.deliveryChallan.findMany({
    where: {
      status: 'DISPATCHED',
      ...(search && {
        OR: [
          { challanNumber: { contains: search as string, mode: 'insensitive' } },
          { customerName: { contains: search as string, mode: 'insensitive' } },
          { destination: { contains: search as string, mode: 'insensitive' } },
        ],
      }),
      ...(from || to
        ? {
            createdAt: {
              ...(from && { gte: new Date(from as string) }),
              ...(to && { lte: new Date(to as string) }),
            },
          }
        : {}),
    },
    include: {
      createdBy: { select: { name: true } },
      lines: {
        include: {
          batch: true,
        },
      },
    },
    orderBy: { createdAt: 'desc' },
  });

  const result = challans.map((dc: any) => {
    let totalFabricMeters = 0;
    let totalFabricKg = 0;
    let totalReadyMadePcs = 0;
    let totalAccessoryUnits = 0;
    let totalShoePairs = 0;
    let totalSockPairs = 0;

    const lines = (dc.lines || []).map((line: any) => {
      const itemType = line.batch?.itemType || 'FABRIC';
      const kind = reportKind(line.batch);
      if (kind === 'FABRIC' && line.batch?.uom === 'KG') totalFabricKg += line.quantity;
      else if (kind === 'FABRIC') totalFabricMeters += line.quantity;
      else if (kind === 'READY_MADE') totalReadyMadePcs += line.quantity;
      else if (kind === 'SHOES') totalShoePairs += line.quantity;
      else if (kind === 'SOCKS') totalSockPairs += line.quantity;
      else totalAccessoryUnits += line.quantity;

      return {
        id: line.id,
        batchCode: line.batch?.batchCode || '—',
        brand: line.batch?.brand || line.batch?.name || '',
        quality: line.batch?.quality || '',
        qualityName: line.batch?.qualityName || null,
        shade: line.batch?.shade || '',
        category: line.batch?.category || null,
        size: line.batch?.size || null,
        itemType,
        quantity: line.quantity,
        isPartialCut: line.isPartialCut,
        unit: unitName(line.batch?.uom || (itemType === 'FABRIC' ? 'METERS' : 'PCS')),
      };
    });

    const totalOtherUnits = totalReadyMadePcs + totalAccessoryUnits + totalShoePairs + totalSockPairs;

    return {
      id: dc.id,
      challanNumber: dc.challanNumber,
      customerName: dc.customerName,
      customerId: dc.customerId || null,
      destination: dc.destination || '',
      dispatchedAt: dc.dispatchedAt || dc.createdAt,
      createdAt: dc.createdAt,
      operator: dc.createdBy?.name || 'System',
      remarks: dc.remarks || null,
      totalFabricMeters: parseFloat(totalFabricMeters.toFixed(2)),
      totalFabricKg: parseFloat(totalFabricKg.toFixed(2)),
      totalReadyMadePcs: Math.round(totalReadyMadePcs),
      totalAccessoryUnits: Math.round(totalAccessoryUnits),
      totalShoePairs,
      totalSockPairs,
      totalPairs: totalShoePairs + totalSockPairs,
      totalUnits: Math.round(totalOtherUnits),
      linesCount: lines.length,
      lines,
    };
  });

  res.json(result);
});

// ─── 3. Stock Inventory Master Report ──────────────────────────────────────────
router.get('/stock-master', requirePermission('admin.reports'), async (req: Request, res: Response) => {
  const { itemType, category, search } = req.query;

  const batches = await prisma.itemBatch.findMany({
    where: {
      status: { not: 'OUT' },
      quantity: { gt: 0 },
      ...(itemType && itemType !== 'ALL' && { itemType: itemType as string }),
      ...(category && { category: category as string }),
      ...(search && {
        OR: [
          { batchCode: { contains: search as string, mode: 'insensitive' } },
          { brand: { contains: search as string, mode: 'insensitive' } },
          { quality: { contains: search as string, mode: 'insensitive' } },
          { shade: { contains: search as string, mode: 'insensitive' } },
          { name: { contains: search as string, mode: 'insensitive' } },
          { artNo: { contains: search as string, mode: 'insensitive' } },
        ],
      }),
    },
    include: {
      batchLocations: { include: { location: true } },
    },
    orderBy: { createdAt: 'desc' },
  });

  const grouped: Record<string, {
    itemType: string;
    category: string | null;
    brand: string;
    quality: string;
    qualityName: string | null;
    shade: string;
    size: string | null;
    unitCount: number;
    totalQuantity: number;
    unit: string;
    locations: string[];
    skus: string[];
  }> = {};

  for (const b of batches) {
    const itemType = b.itemType || 'FABRIC';
    const category = b.category || null;
    const brand = b.brand || b.name || '';
    const quality = b.quality || '';
    const shade = b.shade || '';
    const size = b.size || null;

    const key = `${itemType}|${category || ''}|${brand}|${quality}|${b.qualityName || ''}|${shade}|${size || ''}|${b.uom}`;
    if (!grouped[key]) {
      grouped[key] = {
        itemType,
        category,
        brand,
        quality,
        qualityName: b.qualityName || null,
        shade,
        size,
        unitCount: 0,
        totalQuantity: 0,
        unit: unitName(b.uom || (itemType === 'FABRIC' ? 'METERS' : 'PCS')),
        locations: [],
        skus: [],
      };
    }

    grouped[key].unitCount++;
    grouped[key].totalQuantity = parseFloat((grouped[key].totalQuantity + b.quantity).toFixed(2));
    grouped[key].skus.push(b.batchCode);

    for (const bl of b.batchLocations) {
      if (bl.location?.code && !grouped[key].locations.includes(bl.location.code)) {
        grouped[key].locations.push(bl.location.code);
      }
    }
  }

  const result = Object.values(grouped).sort((a, b) => b.totalQuantity - a.totalQuantity);
  res.json(result);
});

// ─── 4. Supplier Procurement Performance ───────────────────────────────────────
router.get('/supplier-performance', requirePermission('admin.reports'), async (_req: Request, res: Response) => {
  const pos = await prisma.purchaseOrder.findMany({
    include: {
      lines: true,
    },
    orderBy: { createdAt: 'desc' },
  });

  const supplierMap: Record<string, {
    supplierName: string;
    totalPOs: number;
    completedPOs: number;
    pendingPOs: number;
    totalFabricOrdered: number;
    totalFabricReceived: number;
    totalFabricKgOrdered: number;
    totalFabricKgReceived: number;
    totalPairsOrdered: number;
    totalPairsReceived: number;
    lastOrderDate: string;
  }> = {};

  for (const po of pos) {
    const sName = po.supplierName.trim();
    if (!supplierMap[sName]) {
      supplierMap[sName] = {
        supplierName: sName,
        totalPOs: 0,
        completedPOs: 0,
        pendingPOs: 0,
        totalFabricOrdered: 0,
        totalFabricReceived: 0,
        totalFabricKgOrdered: 0,
        totalFabricKgReceived: 0,
        totalPairsOrdered: 0,
        totalPairsReceived: 0,
        lastOrderDate: po.createdAt.toISOString(),
      };
    }

    supplierMap[sName].totalPOs++;
    if (po.status === 'RECEIVED') supplierMap[sName].completedPOs++;
    else supplierMap[sName].pendingPOs++;

    for (const line of po.lines) {
      const isFabric = line.itemType === 'FABRIC';
      if (isFabric && line.uom === 'KG') {
        supplierMap[sName].totalFabricKgOrdered += line.orderedQty;
        supplierMap[sName].totalFabricKgReceived += line.receivedQty;
      } else if (isFabric) {
        supplierMap[sName].totalFabricOrdered += line.orderedQty;
        supplierMap[sName].totalFabricReceived += line.receivedQty;
      } else {
        supplierMap[sName].totalPairsOrdered += line.orderedQty;
        supplierMap[sName].totalPairsReceived += line.receivedQty;
      }
    }
  }

  const result = Object.values(supplierMap).map(s => {
    // Fulfilment per unit group, then averaged (meters, kg and pieces are not added)
    const rates = [
      [s.totalFabricReceived, s.totalFabricOrdered],
      [s.totalFabricKgReceived, s.totalFabricKgOrdered],
      [s.totalPairsReceived, s.totalPairsOrdered],
    ].filter(([, ordered]) => ordered > 0).map(([received, ordered]) => (received / ordered) * 100);
    const overallRate = rates.length ? parseFloat((rates.reduce((t, r) => t + r, 0) / rates.length).toFixed(1)) : 100;

    return {
      ...s,
      fulfillmentRate: Math.min(overallRate, 100),
      totalFabricOrdered: parseFloat(s.totalFabricOrdered.toFixed(1)),
      totalFabricReceived: parseFloat(s.totalFabricReceived.toFixed(1)),
      totalFabricKgOrdered: parseFloat(s.totalFabricKgOrdered.toFixed(1)),
      totalFabricKgReceived: parseFloat(s.totalFabricKgReceived.toFixed(1)),
    };
  }).sort((a, b) => b.totalPOs - a.totalPOs);

  res.json(result);
});

// ─── 5. Warehouse Location Capacity Map ───────────────────────────────────────
router.get('/location-map', requirePermission('admin.reports'), async (_req: Request, res: Response) => {
  const locations = await prisma.location.findMany({
    where: { isActive: true },
    include: {
      bay: { include: { rack: true } },
      batchLocations: {
        where: { quantity: { gt: 0 } },
        include: {
          batch: true,
        },
      },
    },
    orderBy: [{ type: 'asc' }, { code: 'asc' }],
  });

  const result = locations.map((loc) => ({
    id: loc.id,
    code: loc.code,
    type: loc.type,
    bay: loc.bay ? `Rack ${loc.bay.rack.name} · Bay B${loc.bay.number} · Level ${loc.level}` : null,
    level: loc.level,
    position: loc.position,
    unitCount: loc.batchLocations.length,
    totalQuantity: parseFloat(loc.batchLocations.reduce((sum, bl) => sum + bl.quantity, 0).toFixed(1)),
    items: loc.batchLocations.map(bl => {
      const b = bl.batch;
      const brand = b.brand || '';
      const shade = b.shade || '';
      const itemType = b.itemType || 'FABRIC';
      return {
        batchCode: b.batchCode,
        product: (b.name || `${brand} ${shade}`).trim() || 'Item',
        quantity: bl.quantity,
        unit: unitLabel(b.uom || (itemType === 'FABRIC' ? 'METERS' : 'PCS')),
      };
    }),
    isEmpty: loc.batchLocations.length === 0,
  }));

  res.json(result);
});

export default router;
