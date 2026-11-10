import { Router, Request, Response } from 'express';
import { istDayEnd, istDayStart } from '../../utils/format';
import { userMessage } from '../../utils/errors';
import prisma from '../../lib/prisma';
import { requireAuth, requirePermission, hasCostAccess } from '../../middleware/auth';
import { costCodeConfig, costsOfRolls } from '../administration/cost-prices';
import { costLetters, encodeCost, type CostCodeConfig } from '../../utils/cost-code';
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
      COALESCE(ARRAY_REMOVE(ARRAY_AGG(DISTINCT l.code), NULL), ARRAY[]::text[]) AS locations,
      ARRAY_AGG(DISTINCT b.id) AS "rollIds"
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
      rollIds: (Array.isArray(r.rollIds) ? r.rollIds : []) as string[],  // for cost codes; not sent
      batches: [] // Loaded on demand when accordion is expanded
    };
  });

  return formatted;
}

// ─── Cost codes ─────────────────────────────────────────────────────────────
// Everyone who sees the stock sees each roll's secret cost code, exactly as on its label. A value
// (quantity × cost) is shown as code only to people with the Cost Prices permission: next to the
// plain quantities it would let anyone work the code word out. Rupees never leave the server.
type CostRoll = { id: string; poLineId: string | null; quantity: number; itemType: string };
type Viewer = { permissions?: string[] | null };

/** Rolls with `costCode` (and `valueCode` for Cost Prices holders) added when they have a cost. */
async function withRollCodes<T extends { id: string; poLineId: string | null; batchCode: string; quantity: number }>(rows: T[], user: Viewer) {
  const config = await costCodeConfig();
  if (!config || rows.length === 0) return rows;
  const costs = await costsOfRolls(rows);
  const seeValue = hasCostAccess(user);
  return rows.map(r => {
    const cost = costs.get(r.id);
    if (cost === undefined) return r;
    return { ...r, costCode: encodeCost(cost, config, r.batchCode), ...(seeValue && r.quantity > 0 && { valueCode: costLetters(cost * r.quantity, config) }) };
  });
}

/** The rolls behind grouped items, for their codes and value. */
const rollsOf = (items: { rollIds: string[] }[]) => {
  const ids = [...new Set(items.flatMap(i => i.rollIds))];
  return ids.length ? prisma.itemBatch.findMany({ where: { id: { in: ids } }, select: { id: true, poLineId: true, quantity: true, itemType: true } }) : Promise.resolve([] as CostRoll[]);
};

/**
 * Grouped items with `costCode` when every roll in the item has the same cost (rolls from POs at
 * different costs have no single code), and `valueCode` for Cost Prices holders when every roll
 * has a cost. The roll ids used for this are not sent.
 */
async function withItemCodes<T extends { id: string; rollIds: string[] }>(items: T[], user: Viewer, rolls?: CostRoll[]) {
  const strip = (i: T) => { const { rollIds: _ids, ...rest } = i; return rest; };
  const config = await costCodeConfig();
  if (!config || items.length === 0) return items.map(strip);
  const all = rolls ?? await rollsOf(items);
  const byId = new Map(all.map(r => [r.id, r]));
  const costs = await costsOfRolls(all);
  const seeValue = hasCostAccess(user);
  return items.map(item => {
    const own = item.rollIds.map(id => ({ cost: costs.get(id), qty: byId.get(id)?.quantity ?? 0 }));
    const costed = own.length > 0 && own.every(o => o.cost !== undefined);
    const single = costed && own.every(o => o.cost === own[0].cost);
    const value = own.reduce((sum, o) => sum + (o.cost ?? 0) * o.qty, 0);
    return {
      ...strip(item),
      ...(single && { costCode: encodeCost(own[0].cost!, config, item.id) }),
      ...(seeValue && costed && value > 0 && { valueCode: costLetters(value, config) }),
    };
  });
}

/** Total value as code (all, and per item type) and how many rolls have no cost: Cost Prices holders only. */
async function valueTotals(rolls: CostRoll[], config: CostCodeConfig) {
  const costs = await costsOfRolls(rolls);
  const byType: Record<string, number> = {};
  let total = 0, costedRolls = 0, rollsWithoutCost = 0;
  for (const r of rolls) {
    if (r.quantity <= 0) continue;
    const cost = costs.get(r.id);
    if (cost === undefined) { rollsWithoutCost++; continue; }
    costedRolls++;
    total += cost * r.quantity;
    byType[r.itemType] = (byType[r.itemType] ?? 0) + cost * r.quantity;
  }
  return {
    totalCode: costedRolls ? costLetters(total, config) : '',
    byType: Object.fromEntries(Object.entries(byType).map(([type, v]) => [type, costLetters(v, config)])),
    costedRolls,
    rollsWithoutCost,
  };
}

/** The rolls a view's filters cover (for the total value). */
async function rollsForView(view: string, query: Request['query']): Promise<CostRoll[]> {
  if (view === 'GRANULAR') {
    return prisma.itemBatch.findMany({ where: batchesWhere(query), select: { id: true, poLineId: true, quantity: true, itemType: true } });
  }
  return rollsOf(await findSkus(query));
}

// GET /api/inventory/value?view=ROLLUP|GRANULAR&<filters> — the stock value as code, Cost Prices holders only
router.get('/value', requirePermission('inv.dashboard'), async (req: Request, res: Response) => {
  if (!hasCostAccess(req.user!)) { res.status(403).json({ error: 'You do not have access to cost prices' }); return; }
  try {
    const config = await costCodeConfig();
    if (!config) { res.json({ totalCode: '', byType: {}, costedRolls: 0, rollsWithoutCost: 0 }); return; }
    const view = req.query.view === 'GRANULAR' ? 'GRANULAR' : 'ROLLUP';
    res.json(await valueTotals(await rollsForView(view, req.query), config));
  } catch (err: any) {
    console.error('Inventory value error:', err);
    res.status(500).json({ error: userMessage(err, 'Something went wrong. Please try again.') });
  }
});

router.get('/skus', requirePermission('inv.dashboard'), async (req: Request, res: Response) => {
  try {
    res.json(await withItemCodes(await findSkus(req.query), req.user!));
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

    res.json(await withRollCodes(formatted, req.user!));
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
    if (!page) { res.json(await withRollCodes(await findBatches(req.query, 500), req.user!)); return; }
    const [rows, total] = await Promise.all([findBatches(req.query, page.take, page.skip), prisma.itemBatch.count({ where: batchesWhere(req.query) })]);
    res.json(pageReply(await withRollCodes(rows, req.user!), total, page));
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
    // Codes in the file as on screen; the total value as code only for Cost Prices holders
    let rows: unknown[];
    let rolls: CostRoll[];
    if (view === 'GRANULAR') {
      const found = await findBatches(req.query);
      rolls = found;
      rows = await withRollCodes(found, req.user!);
    } else {
      const items = await findSkus(req.query);
      rolls = await rollsOf(items);
      rows = await withItemCodes(items, req.user!, rolls);
    }
    const config = hasCostAccess(req.user!) ? await costCodeConfig() : null;
    const last = await prisma.exportLog.findFirst({
      where: { userId: req.user!.userId, view },
      orderBy: { createdAt: 'desc' },
      select: { choice: true },
    });
    res.json({ rows, lastChoice: last?.choice ?? null, ...(config && { valueTotals: await valueTotals(rolls, config) }) });
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
