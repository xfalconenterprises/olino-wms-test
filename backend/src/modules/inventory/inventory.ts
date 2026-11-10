import { Router, Request, Response } from 'express';
import { istDayEnd, istDayStart } from '../../utils/format';
import { userMessage } from '../../utils/errors';
import prisma from '../../lib/prisma';
import { requireAuth, requirePermission } from '../../middleware/auth';
import { Prisma } from '@prisma/client';
import { pageOf, pageReply } from '../../utils/paging';

const router = Router();
router.use(requireAuth);

// ─── GET /api/inventory/summary — Global Real-time Inventory Health ───────────
router.get('/summary', requirePermission('inv.dashboard', 'admin.dashboard'), async (_req: Request, res: Response) => {
  try {
    const [stockStats, dockStats, locStats] = await Promise.all([
      prisma.$queryRaw<any[]>`
        SELECT
          COUNT(*)::int AS "totalBatches",
          COUNT(*) FILTER (WHERE "itemType" = 'FABRIC')::int AS "fabricLumpCount",
          COALESCE(SUM(quantity) FILTER (WHERE "itemType" = 'FABRIC' AND uom <> 'KG'), 0)::float AS "fabricMeters",
          COALESCE(SUM(quantity) FILTER (WHERE "itemType" = 'FABRIC' AND uom = 'KG'), 0)::float AS "fabricKg",
          COUNT(*) FILTER (WHERE "itemType" = 'FABRIC' AND status = 'IN_STOCK')::int AS "fabricFullRolls",
          COUNT(*) FILTER (WHERE "itemType" = 'FABRIC' AND status = 'PARTIALLY_USED')::int AS "fabricPartialRolls",
          COUNT(*) FILTER (WHERE "itemType" = 'READY_MADE')::int AS "readyMadePackCount",
          COALESCE(SUM(quantity) FILTER (WHERE "itemType" = 'READY_MADE'), 0)::float AS "readyMadePcs",
          COUNT(*) FILTER (WHERE "itemType" = 'ACCESSORY')::int AS "accessoryItemCount",
          COALESCE(SUM(quantity) FILTER (WHERE "itemType" = 'ACCESSORY'), 0)::float AS "accessoryUnits",
          COUNT(*) FILTER (WHERE status = 'QC_HOLD')::int AS "qcHoldCount",
          COALESCE(SUM(quantity) FILTER (WHERE status = 'QC_HOLD' AND "itemType" = 'FABRIC' AND uom <> 'KG'), 0)::float AS "qcHoldMeters",
          COALESCE(SUM(quantity) FILTER (WHERE status = 'QC_HOLD' AND "itemType" = 'FABRIC' AND uom = 'KG'), 0)::float AS "qcHoldKg"
        FROM item_batches
        WHERE status IN ('IN_STOCK', 'PARTIALLY_USED', 'QC_HOLD') AND quantity > 0;
      `,
      prisma.$queryRaw<any[]>`
        SELECT
          COUNT(*)::int AS "unassignedCount",
          COALESCE(SUM(quantity) FILTER (WHERE "itemType" = 'FABRIC' AND uom <> 'KG'), 0)::float AS "unassignedFabricMeters",
          COALESCE(SUM(quantity) FILTER (WHERE "itemType" = 'FABRIC' AND uom = 'KG'), 0)::float AS "unassignedFabricKg",
          COALESCE(SUM(quantity) FILTER (WHERE "itemType" = 'READY_MADE'), 0)::float AS "unassignedReadyMadePcs",
          COALESCE(SUM(quantity) FILTER (WHERE "itemType" = 'ACCESSORY'), 0)::float AS "unassignedAccessoryUnits"
        FROM item_batches b
        WHERE b.status IN ('IN_STOCK', 'PARTIALLY_USED', 'QC_HOLD')
          AND b.quantity > 0
          AND NOT EXISTS (
            SELECT 1 FROM batch_locations bl
            WHERE bl."batchId" = b.id AND bl.quantity > 0
          );
      `,
      prisma.$queryRaw<any[]>`
        SELECT
          (SELECT COUNT(*)::int FROM locations WHERE "isActive" = true) AS "totalLocations",
          (SELECT COUNT(DISTINCT "locationId")::int FROM batch_locations WHERE quantity > 0) AS "occupiedLocations";
      `
    ]);

    const s = stockStats[0] || {};
    const d = dockStats[0] || {};
    const l = locStats[0] || {};

    const totalLocs = l.totalLocations || 0;
    const occupiedLocs = l.occupiedLocations || 0;

    res.json({
      totalBatches: s.totalBatches || 0,
      fabric: {
        totalMeters: parseFloat(Number(s.fabricMeters || 0).toFixed(1)),
        totalKg: parseFloat(Number(s.fabricKg || 0).toFixed(2)),
        lumpCount: s.fabricLumpCount || 0,
        fullRolls: s.fabricFullRolls || 0,
        partialRolls: s.fabricPartialRolls || 0,
      },
      readyMade: {
        totalPcs: Math.round(Number(s.readyMadePcs || 0)),
        packCount: s.readyMadePackCount || 0,
      },
      accessory: {
        totalUnits: Math.round(Number(s.accessoryUnits || 0)),
        itemCount: s.accessoryItemCount || 0,
      },
      qcHold: {
        count: s.qcHoldCount || 0,
        meters: parseFloat(Number(s.qcHoldMeters || 0).toFixed(1)),
        kg: parseFloat(Number(s.qcHoldKg || 0).toFixed(2)),
      },
      dockQueue: {
        unassignedCount: d.unassignedCount || 0,
        unassignedFabricMeters: parseFloat(Number(d.unassignedFabricMeters || 0).toFixed(1)),
        unassignedFabricKg: parseFloat(Number(d.unassignedFabricKg || 0).toFixed(2)),
        unassignedReadyMadePcs: Math.round(Number(d.unassignedReadyMadePcs || 0)),
        unassignedAccessoryUnits: Math.round(Number(d.unassignedAccessoryUnits || 0)),
      },
      locations: {
        total: totalLocs,
        occupied: occupiedLocs,
        empty: Math.max(0, totalLocs - occupiedLocs),
        occupancyRate: totalLocs > 0 ? parseFloat(((occupiedLocs / totalLocs) * 100).toFixed(1)) : 0,
      }
    });
  } catch (err: any) {
    console.error('Inventory summary error:', err);
    res.status(500).json({ error: userMessage(err, 'Something went wrong. Please try again.') });
  }
});

// ─── GET /api/inventory/skus — Aggregated Rollup View via High-Performance SQL ───
async function findSkus(query: Request['query']) {
  const { search, brand, quality, shade, itemType, startDate, endDate, client } = query;

  const conditions: Prisma.Sql[] = [
    Prisma.sql`b.status IN ('IN_STOCK', 'PARTIALLY_USED', 'QC_HOLD') AND b.quantity > 0`
  ];

  if (itemType && itemType !== 'ALL') {
    conditions.push(Prisma.sql`b."itemType" = ${String(itemType)}`);
  }

  if (brand) {
    conditions.push(Prisma.sql`b.brand ILIKE ${'%' + String(brand) + '%'}`);
  }

  if (quality) {
    conditions.push(Prisma.sql`b.quality ILIKE ${'%' + String(quality) + '%'}`);
  }

  if (shade) {
    conditions.push(Prisma.sql`b.shade ILIKE ${'%' + String(shade) + '%'}`);
  }

  if (client) {
    if (client === 'GENERAL' || client === 'UNASSIGNED') {
      conditions.push(Prisma.sql`(b.client_id IS NULL AND b.client_name IS NULL)`);
    } else {
      conditions.push(Prisma.sql`(b.client_id = ${String(client)} OR b.client_name ILIKE ${'%' + String(client) + '%'})`);
    }
  }

  if (startDate) {
    const s = istDayStart(startDate);
    if (s) conditions.push(Prisma.sql`b."createdAt" >= ${s}`);
  }

  if (endDate) {
    const e = istDayEnd(endDate);
    if (e) conditions.push(Prisma.sql`b."createdAt" <= ${e}`);
  }

  if (search) {
    const q = '%' + String(search) + '%';
    conditions.push(Prisma.sql`(
      b.brand ILIKE ${q} OR
      b.quality ILIKE ${q} OR
      b.shade ILIKE ${q} OR
      b.category ILIKE ${q} OR
      b.name ILIKE ${q} OR
      b."artNo" ILIKE ${q} OR
      b."batchCode" ILIKE ${q} OR
      b."invoiceRef" ILIKE ${q} OR
      b."supplierBundle" ILIKE ${q} OR
      b.client_name ILIKE ${q}
    )`);
  }

  const whereClause = Prisma.sql`WHERE ${Prisma.join(conditions, ' AND ')}`;

  const rows = await prisma.$queryRaw<any[]>`
    SELECT
      b."itemType",
      COALESCE(b.brand, '') AS brand,
      b.quality,
      b.quality_name AS "qualityName",
      b.shade,
      b.category,
      b.size,
      b.name,
      b."artNo",
      COALESCE(b.uom, CASE WHEN b."itemType" = 'FABRIC' THEN 'METERS' ELSE 'PCS' END) AS uom,
      ROUND(SUM(b.quantity)::numeric, 2)::float AS "totalQuantity",
      COUNT(b.id)::int AS "activeBatches",
      COUNT(b.id) FILTER (WHERE b.status = 'IN_STOCK')::int AS "fullRollsCount",
      COUNT(b.id) FILTER (WHERE b.status = 'PARTIALLY_USED')::int AS "partialRollsCount",
      COUNT(b.id) FILTER (WHERE b.status = 'QC_HOLD')::int AS "qcHoldCount",
      COALESCE(ARRAY_REMOVE(ARRAY_AGG(DISTINCT l.code), NULL), ARRAY[]::text[]) AS locations
    FROM item_batches b
    LEFT JOIN batch_locations bl ON bl."batchId" = b.id AND bl.quantity > 0
    LEFT JOIN locations l ON l.id = bl."locationId"
    ${whereClause}
    GROUP BY
      b."itemType",
      COALESCE(b.brand, ''),
      b.quality,
      b.quality_name,
      b.shade,
      b.category,
      b.size,
      b.name,
      b."artNo",
      COALESCE(b.uom, CASE WHEN b."itemType" = 'FABRIC' THEN 'METERS' ELSE 'PCS' END)
    ORDER BY brand ASC, b.quality ASC;
  `;

  const formatted = rows.map(r => {
    const key = `${r.itemType}_${r.brand || ''}_${r.quality || ''}_${r.qualityName || ''}_${r.shade || ''}_${r.category || ''}_${r.size || ''}_${r.name || ''}_${r.artNo || ''}_${r.uom}`;
    return {
      id: key,
      itemType: r.itemType,
      brand: r.brand,
      quality: r.quality,
      qualityName: r.qualityName,
      shade: r.shade,
      size: r.size,
      category: r.category,
      name: r.name,
      artNo: r.artNo,
      uom: r.uom,
      totalQuantity: r.totalQuantity,
      activeBatches: r.activeBatches,
      fullRollsCount: r.fullRollsCount,
      partialRollsCount: r.partialRollsCount,
      qcHoldCount: r.qcHoldCount,
      locations: Array.isArray(r.locations) ? r.locations : [],
      batches: [] // Loaded on demand when accordion is expanded
    };
  });

  return formatted;
}

router.get('/skus', requirePermission('inv.dashboard'), async (req: Request, res: Response) => {
  try {
    res.json(await findSkus(req.query));
  } catch (err: any) {
    console.error('Inventory SKUs SQL query error:', err);
    res.status(500).json({ error: userMessage(err, 'Something went wrong. Please try again.') });
  }
});

// ─── GET /api/inventory/skus/batches — On-demand Child Batches for a specific SKU ───
router.get('/skus/batches', requirePermission('inv.dashboard'), async (req: Request, res: Response) => {
  const { itemType, brand, quality, qualityName, shade, size, category, name, artNo, uom, client } = req.query;

  try {
    const where: any = {
      status: { in: ['IN_STOCK', 'PARTIALLY_USED', 'QC_HOLD'] },
      quantity: { gt: 0 }
    };

    if (itemType) where.itemType = String(itemType);
    if (brand) where.brand = String(brand);

    if (quality !== undefined) {
      where.quality = quality ? String(quality) : null;
    }
    if (qualityName !== undefined) {
      where.qualityName = qualityName ? String(qualityName) : null;
    }
    if (uom) where.uom = String(uom);
    if (shade !== undefined) {
      where.shade = shade ? String(shade) : null;
    }
    if (size !== undefined) {
      where.size = size ? String(size) : null;
    }
    if (category !== undefined) {
      where.category = category ? String(category) : null;
    }
    if (name !== undefined) {
      where.name = name ? String(name) : null;
    }
    if (artNo !== undefined) {
      where.artNo = artNo ? String(artNo) : null;
    }

    if (client) {
      if (client === 'GENERAL' || client === 'UNASSIGNED') {
        where.clientId = null;
        where.clientName = null;
      } else {
        where.OR = [
          { clientId: String(client) },
          { clientName: { contains: String(client), mode: 'insensitive' } }
        ];
      }
    }

    const batches = await prisma.itemBatch.findMany({
      where,
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
        }
      },
      orderBy: { createdAt: 'desc' }
    });

    const formatted = batches.map(b => ({
      id: b.id,
      batchCode: b.batchCode,
      quantity: b.quantity,
      status: b.status,
      locationCode: b.batchLocations?.[0]?.location?.code || 'Unassigned',
      supplierBundle: b.supplierBundle,
      invoiceRef: b.invoiceRef,
      createdAt: b.createdAt.toISOString(),
      poLine: b.poLine,
      poLineId: b.poLineId,
      grn: b.grn,
      grnId: b.grnId,
      batchLocations: b.batchLocations,
      clientId: b.clientId,
      clientName: b.clientName,
      itemType: b.itemType,
      brand: b.brand,
      quality: b.quality,
      qualityName: b.qualityName,
      shade: b.shade,
      size: b.size,
      category: b.category,
      name: b.name,
      artNo: b.artNo,
      uom: b.uom
    }));

    res.json(formatted);
  } catch (err: any) {
    console.error('Inventory SKU batches query error:', err);
    res.status(500).json({ error: userMessage(err, 'Something went wrong. Please try again.') });
  }
});

// ─── GET /api/inventory/batches — Granular Detailed View ───────────────────────
// The rolls matching the Granular view's filters
function batchesWhere(query: Request['query']) {
  const { search, brand, quality, shade, status, location, itemType, unassigned, startDate, endDate, client } = query;

  const where: any = {};

  // Base Search
  if (search) {
    const s = String(search);
    where.OR = [
      { batchCode: { contains: s, mode: 'insensitive' } },
      { supplierBundle: { contains: s, mode: 'insensitive' } },
      { invoiceRef: { contains: s, mode: 'insensitive' } },
      { brand: { contains: s, mode: 'insensitive' } },
      { shade: { contains: s, mode: 'insensitive' } },
      { quality: { contains: s, mode: 'insensitive' } },
      { name: { contains: s, mode: 'insensitive' } },
      { artNo: { contains: s, mode: 'insensitive' } },
      { category: { contains: s, mode: 'insensitive' } },
      { clientName: { contains: s, mode: 'insensitive' } },
      { poLine: { is: { po: { poNumber: { contains: s, mode: 'insensitive' } } } } },
      { poLine: { is: { po: { supplierName: { contains: s, mode: 'insensitive' } } } } },
    ];
  }

  // Direct Filters & Status Handling
  if (status) {
    const s = String(status).toUpperCase();
    if (s === 'DISPATCHED' || s === 'OUT') {
      where.status = 'OUT';
    } else if (s === 'IN_STOCK' || s === 'PARTIALLY_USED' || s === 'QC_HOLD') {
      where.status = s as any;
      where.quantity = { gt: 0 };
    } else if (s === 'ALL') {
      // No status filter
    } else {
      where.status = { in: ['IN_STOCK', 'PARTIALLY_USED', 'QC_HOLD'] };
      where.quantity = { gt: 0 };
    }
  } else {
    where.status = { in: ['IN_STOCK', 'PARTIALLY_USED', 'QC_HOLD'] };
    where.quantity = { gt: 0 };
  }

  if (brand) where.brand = { contains: String(brand), mode: 'insensitive' };
  if (quality) where.quality = { contains: String(quality), mode: 'insensitive' };
  if (shade) where.shade = { contains: String(shade), mode: 'insensitive' };
  if (itemType) where.itemType = String(itemType);

  if (client) {
    if (client === 'GENERAL' || client === 'UNASSIGNED') {
      where.clientId = null;
      where.clientName = null;
    } else {
      where.OR = [
        { clientId: String(client) },
        { clientName: { contains: String(client), mode: 'insensitive' } }
      ];
    }
  }

  if (startDate || endDate) {
    const dateFilter: Prisma.DateTimeFilter = {};
    if (startDate) {
      const s = istDayStart(startDate);
      if (s) dateFilter.gte = s;
    }
    if (endDate) {
      const e = istDayEnd(endDate);
      if (e) dateFilter.lte = e;
    }
    where.createdAt = dateFilter;
  }

  if (unassigned === 'true' || unassigned === '1') {
    where.batchLocations = {
      none: { quantity: { gt: 0 } }
    };
  } else if (location) {
    where.batchLocations = {
      some: { location: { code: { contains: String(location), mode: 'insensitive' } } }
    };
  }
  return where;
}

// Granular view sort: ?sort=code|quantity|date&dir=asc|desc (newest first unless asked)
const BATCH_SORT: Record<string, string> = { code: 'batchCode', quantity: 'quantity', date: 'createdAt' };

async function findBatches(query: Request['query'], takeLimit?: number, skip = 0) {
  const where = batchesWhere(query);
  const sortField = BATCH_SORT[String(query.sort || '')] ?? 'createdAt';
  const sortDir: Prisma.SortOrder = query.dir === 'asc' ? 'asc' : 'desc';
  const batches = await prisma.itemBatch.findMany({
    where,
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
    },
    orderBy: [{ [sortField]: sortDir }, { id: 'desc' }],
    take: takeLimit,
    skip,
  });

  const formattedBatches = batches.map(b => {
    const brand = b.brand || b.poLine?.brand || '';
    const quality = b.quality || b.poLine?.quality || '';
    const shade = b.shade || b.poLine?.shade || '';
    const size = b.size || b.poLine?.size || null;
    const category = b.category || b.poLine?.category || null;
    const itemType = b.itemType || b.poLine?.itemType || 'FABRIC';
    const name = b.name || b.poLine?.name || null;
    const artNo = b.artNo || b.poLine?.artNo || null;

    return {
      ...b,
      brand,
      quality,
      shade,
      size,
      category,
      itemType,
      name,
      artNo,
      clientId: b.clientId || null,
      clientName: b.clientName || null,
    };
  });

  return formattedBatches;
}

// With ?limit&offset a page ({ rows, total, hasMore }); otherwise the newest 500 as before
router.get('/batches', requirePermission('inv.dashboard'), async (req: Request, res: Response) => {
  try {
    const page = pageOf(req.query);
    if (!page) { res.json(await findBatches(req.query, 500)); return; }
    const [rows, total] = await Promise.all([findBatches(req.query, page.take, page.skip), prisma.itemBatch.count({ where: batchesWhere(req.query) })]);
    res.json(pageReply(rows, total, page));
  } catch (err: any) {
    console.error('Inventory batches query error:', err);
    res.status(500).json({ error: userMessage(err, 'Something went wrong. Please try again.') });
  }
});

// ─── Stock export ───────────────────────────────────────────────────────────
// The stock export needs its own permission, and each file downloaded is logged.
const EXPORT_FILTERS = ['search', 'brand', 'quality', 'shade', 'status', 'location', 'itemType', 'startDate', 'endDate', 'client'];

// GET /api/inventory/export?view=ROLLUP|GRANULAR — every matching row, plus the user's last choices
router.get('/export', requirePermission('export.stock'), async (req: Request, res: Response) => {
  const view = req.query.view === 'GRANULAR' ? 'GRANULAR' : 'ROLLUP';
  try {
    const rows = view === 'GRANULAR' ? await findBatches(req.query) : await findSkus(req.query);
    const last = await prisma.exportLog.findFirst({
      where: { userId: req.user!.userId, view },
      orderBy: { createdAt: 'desc' },
      select: { choice: true },
    });
    res.json({ rows, lastChoice: last?.choice ?? null });
  } catch (err: any) {
    console.error('Stock export error:', err);
    res.status(500).json({ error: userMessage(err, 'Something went wrong. Please try again.') });
  }
});

// POST /api/inventory/export/log — records a file as it is downloaded
router.post('/export/log', requirePermission('export.stock'), async (req: Request, res: Response) => {
  const { view, filters, rowCount, columns, choice } = req.body;
  try {
    await prisma.exportLog.create({
      data: {
        userId: req.user!.userId,
        userName: req.user!.name,
        view: view === 'GRANULAR' ? 'GRANULAR' : 'ROLLUP',
        filters: Object.fromEntries(EXPORT_FILTERS.filter(k => filters?.[k]).map(k => [k, String(filters[k])])),
        rowCount: Number(rowCount) || 0,
        columns: columns ?? {},
        choice: choice ?? {},
      },
    });
    res.status(201).json({ ok: true });
  } catch (err: any) {
    console.error('Stock export log error:', err);
    res.status(500).json({ error: userMessage(err, 'Something went wrong. Please try again.') });
  }
});

// GET /api/inventory/export-log?from=&to= — newest first, days in IST
router.get('/export-log', requirePermission('export.log'), async (req: Request, res: Response) => {
  const from = istDayStart(req.query.from), to = istDayEnd(req.query.to);
  try {
    res.json(await prisma.exportLog.findMany({
      where: from || to ? { createdAt: { ...(from && { gte: from }), ...(to && { lte: to }) } } : {},
      orderBy: { createdAt: 'desc' },
      take: 500,
      select: { id: true, userName: true, view: true, filters: true, rowCount: true, columns: true, createdAt: true },
    }));
  } catch (err: any) {
    console.error('Export log error:', err);
    res.status(500).json({ error: userMessage(err, 'Something went wrong. Please try again.') });
  }
});

export default router;
