import { Router, Request, Response } from 'express';
import type { Prisma } from '@prisma/client';
import { istDateKey, istDayEnd, istDayStart } from '../../utils/format';
import { pageOf, pageReply } from '../../utils/paging';
import prisma from '../../lib/prisma';
import { requireAuth, requirePermission, hasCostAccess, type AuthUser } from '../../middleware/auth';
import { totalsByUnit, unitLabel, unitName } from '../../utils/units';
import { ownPasswordRefusal } from './cost-prices';
import { saveClosingStock } from '../accounts/valuation';

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
  const targetDateStr = (req.query.date as string) || istDateKey();
  const itemTypeFilter = (req.query.itemType as string) || 'ALL';
  const categoryFilter = (req.query.category as string) || '';

  let startDate: Date;
  let endDate: Date;

  // Day, month and year boundaries are IST midnights, wherever the server runs
  const pad = (n: number) => String(n).padStart(2, '0');
  const [yearPart, monthPart] = targetDateStr.split('-');
  const year = parseInt(yearPart, 10) || parseInt(istDateKey().slice(0, 4), 10);
  const month = parseInt(monthPart, 10) || 1;

  if (period === 'daily') {
    startDate = istDayStart(targetDateStr) as Date;
    endDate = istDayEnd(targetDateStr) as Date;
  } else if (period === 'monthly') {
    const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
    startDate = istDayStart(`${year}-${pad(month)}-01`) as Date;
    endDate = istDayEnd(`${year}-${pad(month)}-${pad(lastDay)}`) as Date;
  } else {
    startDate = istDayStart(`${year}-01-01`) as Date;
    endDate = istDayEnd(`${year}-12-31`) as Date;
  }
  if (!startDate || !endDate) { res.status(400).json({ error: 'Choose a valid date.' }); return; }

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
    // Fixing a mistake takes back the movement it fixes instead of counting as a new one:
    // an undone receipt or cancelled customer return lowers inward, a cancelled supplier return lowers outward
    const reversesInward = tx.type === 'STOCK_OUT' && (tx.referenceType === 'RECEIPT_CORRECTION' || tx.referenceType === 'RETURN_CANCELLED');
    const reversesOutward = tx.type === 'STOCK_IN' && tx.referenceType === 'RETURN_CANCELLED';
    const qty = (tx.quantityMoved || 0) * (reversesInward || reversesOutward ? -1 : 1);
    const inward = reversesInward || (tx.type === 'STOCK_IN' && !reversesOutward);

    // Grouped by IST day (or IST month for a yearly report)
    const dateKey = period === 'yearly' ? istDateKey(tx.createdAt).slice(0, 7) : istDateKey(tx.createdAt);

    if (!timelineMap[dateKey]) {
      timelineMap[dateKey] = {
        date: dateKey,
        inwardQty: 0,
        outwardQty: 0,
        txCount: 0,
      };
    }

    timelineMap[dateKey].txCount++;

    if (inward) {
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
    } else if (tx.type === 'STOCK_OUT' || tx.type === 'PARTIAL_CUT' || reversesOutward) {
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
// With ?limit a page ({ rows, total, hasMore }); ?type=FABRIC|READY_MADE keeps challans carrying that kind
router.get('/customer-shipments', requirePermission('admin.reports', 'inv.delivery_challans'), async (req: Request, res: Response) => {
  const { from, to } = req.query;
  const search = String(req.query.search || '').trim();
  const type = String(req.query.type || '');
  const page = pageOf(req.query);
  const contains = (value: string) => ({ contains: value, mode: 'insensitive' as const });

  const where: Prisma.DeliveryChallanWhereInput = {
    status: 'DISPATCHED',
    ...(search && {
      OR: [
        { challanNumber: contains(search) },
        { customerName: contains(search) },
        { destination: contains(search) },
        { createdBy: { name: contains(search) } },
        { lines: { some: { batch: { OR: [
          { batchCode: contains(search) }, { brand: contains(search) }, { quality: contains(search) }, { shade: contains(search) }, { name: contains(search) },
        ] } } } },
      ],
    }),
    ...(type === 'FABRIC' && { lines: { some: { batch: { itemType: 'FABRIC' } } } }),
    ...(type === 'READY_MADE' && { lines: { some: { batch: { itemType: { not: 'FABRIC' } } } } }),
    ...(from || to
      ? {
          createdAt: {
            ...(from && { gte: new Date(from as string) }),
            ...(to && { lte: new Date(to as string) }),
          },
        }
      : {}),
  };

  const challans = await prisma.deliveryChallan.findMany({
    where,
    include: {
      createdBy: { select: { name: true } },
      lines: {
        include: {
          batch: true,
        },
      },
    },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    ...(page && { take: page.take, skip: page.skip }),
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

  if (!page) { res.json(result); return; }
  res.json(pageReply(result, await prisma.deliveryChallan.count({ where }), page));
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

// ─── 6. Year-End Stock Statement (the business's own years) ────────────────────────
// Every change to a roll's quantity is a movement (in: STOCK_IN; out: STOCK_OUT, PARTIAL_CUT), so a
// roll's movements add up to its stock. For a period: opening stock is everything before its first day,
// the period's movements are split by what they were, and closing = opening + those movements.
// Years are the business's own, not the financial year: the current year is ended on any date, and the
// next one starts the day after. The first year starts on the first stock record.

interface ItemKey {
  itemType: string; category: string | null; brand: string | null; quality: string | null; qualityName: string | null;
  shade: string | null; size: string | null; name: string | null; artNo: string | null; uom: string;
}

const round3 = (n: number) => Math.round((Number(n) || 0) * 1000) / 1000;

const dayKey = (d: Date) => d.toISOString().slice(0, 10);            // a DATE column → YYYY-MM-DD
const asDate = (key: string) => new Date(`${key}T00:00:00.000Z`);    // YYYY-MM-DD → a DATE column
const isDayKey = (v: unknown): v is string =>
  typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !isNaN(asDate(v).getTime()) && dayKey(asDate(v)) === v;
const nextDay = (key: string) => { const d = asDate(key); d.setUTCDate(d.getUTCDate() + 1); return dayKey(d); };
const ddmmyyyy = (key: string) => key.split('-').reverse().join('-');

// A year-end can be undone (a wrong date) for this many days after it was made
const UNDO_DAYS = 15;
const undoUntil = (endedAt: Date) => new Date(endedAt.getTime() + UNDO_DAYS * 86_400_000);

// Ending or undoing a year is kept to full administrators and cost-price holders
const canEndYears = (user: AuthUser) => (user.permissions || []).includes('*') || hasCostAccess(user);

/** The ended years (newest first) and the day the current year started. */
export async function stockYears() {
  const ended = await prisma.stockYear.findMany({ orderBy: { endsOn: 'desc' } });
  const [first] = await prisma.$queryRaw<{ first: Date | null }[]>`SELECT MIN("createdAt") AS first FROM transactions`;
  const firstDay = first.first ? istDateKey(first.first) : istDateKey();
  return { ended, currentStarts: ended.length ? nextDay(dayKey(ended[0].endsOn)) : firstDay };
}

/** Stock movement per item, and what each client was sent, from the first day to the last (IST, inclusive). */
async function stockStatement(fromKey: string, toKey: string) {
  const start = istDayStart(fromKey)!;
  const end = istDayEnd(toKey)!;

  const movements = await prisma.$queryRaw<(ItemKey & {
    opening: number; received: number; customerReturns: number; dispatched: number; supplierReturns: number; adjustments: number;
  })[]>`
    WITH m AS (
      SELECT t."batchId", t."createdAt",
        CASE WHEN t.type = 'STOCK_IN' THEN t."quantityMoved" ELSE -t."quantityMoved" END AS delta,
        CASE
          WHEN t."referenceType" = 'DELIVERY_CHALLAN' THEN 'dispatched'
          WHEN t."referenceType" = 'SUPPLIER_RETURN' THEN 'supplierReturns'
          WHEN t."referenceType" = 'RETURN_CANCELLED' AND t.type = 'STOCK_IN' THEN 'supplierReturns'   -- a return to supplier undone
          WHEN t."referenceType" IN ('CUSTOMER_RETURN', 'RETURN_CANCELLED') THEN 'customerReturns'    -- incl. a customer return undone
          WHEN t."referenceType" IN ('SUPERVISOR_ADJUSTMENT', 'STOCK_COUNT') THEN 'adjustments'
          WHEN t.type = 'STOCK_IN' OR t."referenceType" = 'RECEIPT_CORRECTION' THEN 'received'
          ELSE 'adjustments'
        END AS bucket
      FROM transactions t
      WHERE t."createdAt" <= ${end} AND t.type <> 'INTERNAL_TRANSFER'
    )
    SELECT b."itemType" AS "itemType", b.category, b.brand, b.quality, b.quality_name AS "qualityName", b.shade, b.size,
           b.name, b."artNo" AS "artNo", b.uom,
           SUM(CASE WHEN m."createdAt" < ${start} THEN m.delta ELSE 0 END) AS opening,
           SUM(CASE WHEN m."createdAt" >= ${start} AND m.bucket = 'received' THEN m.delta ELSE 0 END) AS received,
           SUM(CASE WHEN m."createdAt" >= ${start} AND m.bucket = 'customerReturns' THEN m.delta ELSE 0 END) AS "customerReturns",
           SUM(CASE WHEN m."createdAt" >= ${start} AND m.bucket = 'dispatched' THEN m.delta ELSE 0 END) AS dispatched,
           SUM(CASE WHEN m."createdAt" >= ${start} AND m.bucket = 'supplierReturns' THEN m.delta ELSE 0 END) AS "supplierReturns",
           SUM(CASE WHEN m."createdAt" >= ${start} AND m.bucket = 'adjustments' THEN m.delta ELSE 0 END) AS adjustments
    FROM m JOIN item_batches b ON b.id = m."batchId"
    GROUP BY 1, 2, 3, 4, 5, 6, 7, 8, 9, 10`;

  // Out-movements are shown as the amount that went out (dispatched 120, not -120)
  const items = movements.map(r => {
    const opening = round3(r.opening);
    const received = round3(r.received);
    const customerReturns = round3(r.customerReturns);
    const dispatched = round3(-r.dispatched);
    const supplierReturns = round3(-r.supplierReturns);
    const adjustments = round3(r.adjustments);
    const closing = round3(opening + received + customerReturns - dispatched - supplierReturns + adjustments);
    return { ...pickKey(r), opening, received, customerReturns, dispatched, supplierReturns, adjustments, closing };
  })
    .filter(i => [i.opening, i.received, i.customerReturns, i.dispatched, i.supplierReturns, i.adjustments, i.closing].some(v => Math.abs(v) >= 0.0005))
    .sort((a, b) => [a.itemType, a.brand || a.name || '', a.quality || '', a.shade || ''].join('|')
      .localeCompare([b.itemType, b.brand || b.name || '', b.quality || '', b.shade || ''].join('|'), undefined, { numeric: true }));

  // What each client was sent in the period, per item
  const sent = await prisma.$queryRaw<(ItemKey & { customerName: string; quantity: number; challans: bigint })[]>`
    SELECT dc."customerName" AS "customerName", b."itemType" AS "itemType", b.category, b.brand, b.quality, b.quality_name AS "qualityName",
           b.shade, b.size, b.name, b."artNo" AS "artNo", b.uom, SUM(l.quantity) AS quantity, COUNT(DISTINCT dc.id) AS challans
    FROM delivery_challan_lines l
    JOIN delivery_challans dc ON dc.id = l."dcId"
    JOIN item_batches b ON b.id = l."batchId"
    WHERE dc.status = 'DISPATCHED' AND dc.is_deleted = false AND dc."dispatchedAt" BETWEEN ${start} AND ${end}
    GROUP BY 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11`;
  const challanCounts = await prisma.$queryRaw<{ customerName: string; challans: bigint }[]>`
    SELECT "customerName" AS "customerName", COUNT(*) AS challans FROM delivery_challans
    WHERE status = 'DISPATCHED' AND is_deleted = false AND "dispatchedAt" BETWEEN ${start} AND ${end}
    GROUP BY 1`;
  const clients = challanCounts
    .map(c => ({
      customerName: c.customerName,
      challans: Number(c.challans),
      totals: totalsByUnit(sent.filter(s => s.customerName === c.customerName).map(s => ({ uom: s.uom, quantity: s.quantity }))),
      items: sent.filter(s => s.customerName === c.customerName)
        .map(s => ({ ...pickKey(s), quantity: round3(s.quantity), challans: Number(s.challans) }))
        .sort((a, b) => b.quantity - a.quantity),
    }))
    .sort((a, b) => a.customerName.localeCompare(b.customerName));

  return { items, clients };
}

// GET /api/reports/year-end?from=YYYY-MM-DD&to=YYYY-MM-DD — the current year (from the day after the last
// year-end, to today) unless dates are given; any ended year is just its own dates
router.get('/year-end', requirePermission('admin.reports'), async (req: Request, res: Response) => {
  const today = istDateKey();
  const { ended, currentStarts } = await stockYears();
  const from = isDayKey(req.query.from) ? req.query.from : currentStarts;
  // A year ended today leaves the current year starting tomorrow: shown as that one (still empty) day
  const to = isDayKey(req.query.to) && req.query.to < today ? req.query.to : (!isDayKey(req.query.from) && from > today ? from : today);
  if (from > to) { res.status(400).json({ error: 'The first day must be on or before the last day.' }); return; }

  const { items, clients } = await stockStatement(from, to);
  res.json({
    from,
    to,
    toToday: to === today,   // closing is the stock on hand today
    currentYear: { from: currentStarts, to: currentStarts > today ? currentStarts : today },
    currentStarted: currentStarts <= today,   // a year ended today leaves nothing to end until tomorrow
    endedYears: ended.map(y => ({ id: y.id, from: dayKey(y.startsOn), to: dayKey(y.endsOn), endedByName: y.endedByName, endedAt: y.createdAt })),
    canEndYear: canEndYears(req.user!),
    // Only the latest year-end can be undone, and only for a while after it was made
    latestUndoUntil: ended.length && undoUntil(ended[0].createdAt).getTime() > Date.now() ? undoUntil(ended[0].createdAt) : null,
    items,
    clients,
  });
});

// POST /api/reports/year-end/end { endsOn, password } — ends the current year on that day; the next starts the day after
router.post('/year-end/end', requirePermission('admin.reports'), async (req: Request, res: Response) => {
  if (!canEndYears(req.user!)) { res.status(403).json({ error: 'You cannot end the year.' }); return; }
  const endsOn = req.body?.endsOn;
  if (!isDayKey(endsOn)) { res.status(400).json({ error: 'Choose the last day of the year.' }); return; }
  if (endsOn > istDateKey()) { res.status(400).json({ error: 'A year cannot end on a future date.' }); return; }
  const { currentStarts } = await stockYears();
  if (endsOn < currentStarts) {
    res.status(400).json({ error: `This year began on ${ddmmyyyy(currentStarts)}, so it must end on or after that day.` });
    return;
  }
  // Confirmed with the person's own password
  const refusal = await ownPasswordRefusal(req.user!.userId, req.user!.username, req.body?.password);
  if (refusal) { res.status(refusal.status).json({ error: refusal.error, code: 'CONFIRM_PASSWORD' }); return; }
  try {
    const year = await prisma.stockYear.create({
      data: { startsOn: asDate(currentStarts), endsOn: asDate(endsOn), endedById: req.user!.userId, endedByName: req.user!.name },
    });
    console.log(`[YEAR-END] '${req.user!.username}' ended the year ${currentStarts} to ${endsOn}`);
    // The closing stock at cost is kept for Accounts. The year stays ended if this fails: it can be saved there later
    try {
      await saveClosingStock(year.id, req.user!);
    } catch (err) {
      console.error('[YEAR-END] Closing stock could not be saved:', err);
    }
    res.status(201).json({ id: year.id, from: currentStarts, to: endsOn });
  } catch (err: any) {
    if (err?.code === 'P2002') { res.status(409).json({ error: 'That year has just been ended. Refresh to see it.' }); return; }
    throw err;
  }
});

// DELETE /api/reports/year-end/latest — undoes the most recent year-end (a wrong date); that year joins the current one again
router.delete('/year-end/latest', requirePermission('admin.reports'), async (req: Request, res: Response) => {
  if (!canEndYears(req.user!)) { res.status(403).json({ error: 'You cannot undo a year-end.' }); return; }
  const latest = await prisma.stockYear.findFirst({ orderBy: { endsOn: 'desc' } });
  if (!latest) { res.status(404).json({ error: 'No year has been ended yet.' }); return; }
  if (undoUntil(latest.createdAt).getTime() <= Date.now()) {
    res.status(400).json({ error: `A year-end can be undone only within ${UNDO_DAYS} days of ending it.` });
    return;
  }
  await prisma.stockYear.delete({ where: { id: latest.id } });
  console.log(`[YEAR-END] '${req.user!.username}' undid the year-end of ${dayKey(latest.endsOn)}`);
  res.json({ from: dayKey(latest.startsOn), to: dayKey(latest.endsOn) });
});

function pickKey(r: ItemKey): ItemKey {
  return {
    itemType: r.itemType || 'FABRIC', category: r.category, brand: r.brand, quality: r.quality, qualityName: r.qualityName,
    shade: r.shade, size: r.size, name: r.name, artNo: r.artNo, uom: r.uom,
  };
}

export default router;
