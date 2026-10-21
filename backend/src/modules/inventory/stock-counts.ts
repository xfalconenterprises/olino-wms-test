import { Router, Request, Response } from 'express';
import { Prisma } from '@prisma/client';
import prisma from '../../lib/prisma';
import { requireAuth, requirePermission } from '../../middleware/auth';
import { nextDocumentNumber } from '../../utils/document-number';
import { itemDescription, unitLabel } from './returns';

// Stock counts (cycle counts / stock takes).
// 1. A count covers a set of locations. 2. Staff scan what is on each location without seeing
// what the system expects, then finish the location (the system stock is recorded at that
// moment). 3. A supervisor reviews the differences and approves; corrections are applied with
// a full audit trail. Rolls that moved after their location was counted are flagged, not changed.
const router = Router();
router.use(requireAuth);

const COUNT = requirePermission('inv.stock_count');
const APPROVE = requirePermission('inv.adjustments');

type Db = Prisma.TransactionClient | typeof prisma;

class CountError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}

async function run(res: Response, work: () => Promise<unknown>, status = 200) {
  try {
    res.status(status).json(await work());
  } catch (err: any) {
    if (err instanceof CountError) { res.status(err.status).json({ error: err.message }); return; }
    if (err?.code === 'P2002') { res.status(409).json({ error: 'That was saved at the same moment by someone else. Please try again.' }); return; }
    console.error('Stock count error:', err);
    res.status(500).json({ error: 'Stock count action failed' });
  }
}

const round3 = (n: number) => Math.round(n * 1000) / 1000;
const byCode = (a: { code: string }, b: { code: string }) => a.code.localeCompare(b.code, undefined, { numeric: true });

async function openCount(db: Db, id: string) {
  const count = await db.stockCount.findUnique({ where: { id } });
  if (!count) throw new CountError('Stock count not found', 404);
  if (count.status !== 'OPEN') throw new CountError(`${count.countNumber} is ${count.status.toLowerCase()} and can no longer be changed.`);
  return count;
}

async function countLocation(db: Db, countId: string, code: string) {
  const cl = await db.stockCountLocation.findFirst({
    where: { countId, location: { code: code.trim().toUpperCase() } },
    include: { location: { select: { id: true, code: true, type: true } }, countedBy: { select: { name: true } } },
  });
  if (!cl) throw new CountError(`Location "${code}" is not part of this count.`, 404);
  return cl;
}

// ─── Setting up ──────────────────────────────────────────────────────────────

// POST /api/stock-counts — open a count for the whole warehouse, some racks, or the floor spots
router.post('/', COUNT, async (req: Request, res: Response) => {
  const scope = String(req.body.scope ?? '');
  const rackIds: string[] = Array.isArray(req.body.rackIds) ? req.body.rackIds.map(String) : [];

  await run(res, async () => {
    let where: Prisma.LocationWhereInput;
    let scopeLabel: string;
    if (scope === 'ALL') {
      where = { isActive: true };
      scopeLabel = 'Whole warehouse';
    } else if (scope === 'RACKS') {
      if (rackIds.length === 0) throw new CountError('Choose at least one rack.');
      const racks = await prisma.rack.findMany({ where: { id: { in: rackIds }, isActive: true }, orderBy: { name: 'asc' } });
      if (racks.length !== rackIds.length) throw new CountError('One of the chosen racks no longer exists.');
      where = { isActive: true, type: 'BAY', bay: { isActive: true, rackId: { in: rackIds } } };
      scopeLabel = `Rack${racks.length > 1 ? 's' : ''} ${racks.map(r => r.name).join(', ')}`;
    } else if (scope === 'FLOOR') {
      where = { isActive: true, type: 'FLOOR' };
      scopeLabel = 'Floor spots';
    } else {
      throw new CountError('Choose what to count.');
    }

    const locations = await prisma.location.findMany({ where, select: { id: true } });
    if (locations.length === 0) throw new CountError('There are no locations in that area.');

    // A location can be in only one open count at a time
    const busy = await prisma.stockCountLocation.findFirst({
      where: { locationId: { in: locations.map(l => l.id) }, count: { status: 'OPEN' } },
      include: { count: { select: { countNumber: true } }, location: { select: { code: true } } },
    });
    if (busy) throw new CountError(`${busy.location.code} is already in open count ${busy.count.countNumber}. Finish or cancel that count first.`, 409);

    return prisma.$transaction(async (tx) => {
      const countNumber = await nextDocumentNumber('SC', async prefix =>
        (await tx.stockCount.findFirst({ where: { countNumber: { startsWith: prefix } }, orderBy: { countNumber: 'desc' }, select: { countNumber: true } }))?.countNumber);
      const count = await tx.stockCount.create({
        data: { countNumber, scopeLabel, wholeWarehouse: scope === 'ALL', notes: String(req.body.notes ?? '').trim() || null, createdById: req.user!.userId },
      });
      await tx.stockCountLocation.createMany({ data: locations.map(l => ({ countId: count.id, locationId: l.id })) });
      return { ...count, locationCount: locations.length };
    });
  }, 201);
});

// GET /api/stock-counts — all counts with progress
router.get('/', COUNT, async (_req: Request, res: Response) => {
  const counts = await prisma.stockCount.findMany({
    include: {
      createdBy: { select: { name: true } },
      closedBy: { select: { name: true } },
      locations: { select: { countedAt: true } },
    },
    orderBy: { createdAt: 'desc' },
    take: 100,
  });
  res.json(counts.map(({ locations, ...c }) => ({
    ...c,
    locationCount: locations.length,
    countedCount: locations.filter(l => l.countedAt).length,
  })));
});

// GET /api/stock-counts/scopes — what can be counted: racks, floor spots, everything
router.get('/scopes', COUNT, async (_req: Request, res: Response) => {
  const [racks, floor, total] = await Promise.all([
    prisma.rack.findMany({
      where: { isActive: true },
      select: { id: true, name: true, bays: { where: { isActive: true }, select: { _count: { select: { locations: { where: { isActive: true } } } } } } },
    }),
    prisma.location.count({ where: { isActive: true, type: 'FLOOR' } }),
    prisma.location.count({ where: { isActive: true } }),
  ]);
  res.json({
    racks: racks
      .map(r => ({ id: r.id, name: r.name, locationCount: r.bays.reduce((t, b) => t + b._count.locations, 0) }))
      .sort((a, b) => a.name.length - b.name.length || a.name.localeCompare(b.name)),
    floorCount: floor,
    totalCount: total,
  });
});

// GET /api/stock-counts/:id/lookup/:batchCode — what a scanned barcode is (no location info: counts stay blind)
router.get('/:id/lookup/:batchCode', COUNT, async (req: Request, res: Response) => {
  const batch = await prisma.itemBatch.findUnique({ where: { batchCode: String(req.params.batchCode).trim().toUpperCase() } });
  if (!batch) {
    res.status(404).json({ error: `Barcode "${req.params.batchCode}" is not in the system. Set the item aside and report it to a supervisor.` });
    return;
  }
  res.json({
    batchCode: batch.batchCode, itemType: batch.itemType, description: itemDescription(batch),
    uom: batch.uom, unit: unitLabel(batch.uom), labelQty: batch.quantity, usedUp: batch.status === 'OUT',
  });
});

// GET /api/stock-counts/:id — the count with each location's progress
router.get('/:id', COUNT, async (req: Request, res: Response) => {
  const count = await prisma.stockCount.findUnique({
    where: { id: req.params.id as string },
    include: {
      createdBy: { select: { name: true } },
      closedBy: { select: { name: true } },
      locations: {
        include: {
          location: { select: { code: true, type: true } },
          countedBy: { select: { name: true } },
          _count: { select: { entries: true } },
        },
      },
    },
  });
  if (!count) { res.status(404).json({ error: 'Stock count not found' }); return; }
  const locations = count.locations
    .map(l => ({ id: l.id, code: l.location.code, type: l.location.type, countedAt: l.countedAt, countedBy: l.countedBy?.name ?? null, entryCount: l._count.entries }))
    .sort(byCode);
  res.json({ ...count, locations });
});

// POST /api/stock-counts/:id/cancel
router.post('/:id/cancel', APPROVE, async (req: Request, res: Response) => {
  await run(res, async () => {
    const count = await openCount(prisma, req.params.id as string);
    return prisma.stockCount.update({
      where: { id: count.id },
      data: { status: 'CANCELLED', closedById: req.user!.userId, closedAt: new Date() },
    });
  });
});

// ─── Counting a location ─────────────────────────────────────────────────────

const entryView = (e: { id: string; quantity: number; batch: any }) => ({
  id: e.id,
  quantity: e.quantity,
  batch: {
    batchCode: e.batch.batchCode, itemType: e.batch.itemType, description: itemDescription(e.batch),
    uom: e.batch.uom, unit: unitLabel(e.batch.uom),
  },
});

// GET /api/stock-counts/:id/locations/:code — what has been scanned on this location so far
router.get('/:id/locations/:code', COUNT, async (req: Request, res: Response) => {
  await run(res, async () => {
    const cl = await countLocation(prisma, req.params.id as string, req.params.code as string);
    const entries = await prisma.stockCountEntry.findMany({ where: { countLocationId: cl.id }, include: { batch: true }, orderBy: { createdAt: 'asc' } });
    return {
      location: { code: cl.location.code, type: cl.location.type, countedAt: cl.countedAt, countedBy: cl.countedBy?.name ?? null },
      entries: entries.map(entryView),
    };
  });
});

// POST /api/stock-counts/:id/locations/:code/entries — record a scanned roll/box (scanning again updates it)
router.post('/:id/locations/:code/entries', COUNT, async (req: Request, res: Response) => {
  await run(res, async () => {
    await openCount(prisma, req.params.id as string);
    const cl = await countLocation(prisma, req.params.id as string, req.params.code as string);
    if (cl.countedAt) throw new CountError(`${cl.location.code} is already finished. Reopen it to change what was counted.`, 409);

    const batchCode = String(req.body.batchCode ?? '').trim().toUpperCase();
    const batch = await prisma.itemBatch.findUnique({ where: { batchCode } });
    if (!batch) throw new CountError(`Barcode "${batchCode}" is not in the system. Set the item aside and report it to a supervisor.`, 404);

    const quantity = Number(req.body.quantity);
    if (!Number.isFinite(quantity) || quantity <= 0) throw new CountError('Enter the quantity found (above 0).');
    if (batch.uom !== 'METERS' && !Number.isInteger(quantity)) throw new CountError(`${unitLabel(batch.uom)} must be a whole number.`);

    const entry = await prisma.stockCountEntry.upsert({
      where: { countLocationId_batchId: { countLocationId: cl.id, batchId: batch.id } },
      create: { countLocationId: cl.id, batchId: batch.id, quantity: round3(quantity) },
      update: { quantity: round3(quantity) },
      include: { batch: true },
    });
    return {
      ...entryView(entry),
      warning: batch.status === 'OUT' ? 'The system shows this item as used up or dispatched. It will be flagged for review.' : null,
    };
  });
});

// DELETE /api/stock-counts/:id/locations/:code/entries/:entryId
router.delete('/:id/locations/:code/entries/:entryId', COUNT, async (req: Request, res: Response) => {
  await run(res, async () => {
    await openCount(prisma, req.params.id as string);
    const cl = await countLocation(prisma, req.params.id as string, req.params.code as string);
    if (cl.countedAt) throw new CountError(`${cl.location.code} is already finished. Reopen it first.`, 409);
    await prisma.stockCountEntry.deleteMany({ where: { id: req.params.entryId as string, countLocationId: cl.id } });
    return { success: true };
  });
});

// POST /api/stock-counts/:id/locations/:code/finish — done with this location; record the system stock now
router.post('/:id/locations/:code/finish', COUNT, async (req: Request, res: Response) => {
  await run(res, async () => {
    await openCount(prisma, req.params.id as string);
    const cl = await countLocation(prisma, req.params.id as string, req.params.code as string);
    if (cl.countedAt) return { success: true, alreadyFinished: true };
    return prisma.$transaction(async (tx) => {
      const placed = await tx.batchLocation.findMany({ where: { locationId: cl.location.id, quantity: { gt: 0 } } });
      await tx.stockCountLocation.update({
        where: { id: cl.id },
        data: {
          countedAt: new Date(),
          countedById: req.user!.userId,
          expected: placed.map(p => ({ batchId: p.batchId, quantity: p.quantity })),
        },
      });
      return { success: true };
    });
  });
});

// POST /api/stock-counts/:id/locations/:code/reopen — count this location again
router.post('/:id/locations/:code/reopen', COUNT, async (req: Request, res: Response) => {
  await run(res, async () => {
    await openCount(prisma, req.params.id as string);
    const cl = await countLocation(prisma, req.params.id as string, req.params.code as string);
    await prisma.stockCountLocation.update({ where: { id: cl.id }, data: { countedAt: null, countedById: null, expected: Prisma.DbNull } });
    return { success: true };
  });
});

// ─── Review & approval ───────────────────────────────────────────────────────

export type LineType = 'MATCH' | 'QTY_CHANGE' | 'MOVED' | 'MISSING' | 'FOUND';
export type Resolution = 'APPLY' | 'WRITE_OFF' | 'UNPLACE' | 'MOVE_HERE' | 'ADD' | 'SKIP';

interface Place { locationId: string; code: string; quantity: number }

export interface ReviewLine {
  batchId: string;
  batchCode: string;
  description: string;
  uom: string;
  unit: string;
  status: string;
  systemQty: number;
  type: LineType;
  expected: Place[];
  counted: Place[];
  elsewhere: Place[];          // placed at locations not counted in this count
  unplaced: number;            // stock not on any location
  resolutions: Resolution[];
  defaultResolution: Resolution;
  conflict: boolean;           // the item moved after its location was counted
}

/** Compares what was counted with the system stock recorded for every finished location. */
async function buildReview(db: Db, countId: string) {
  const count = await db.stockCount.findUnique({
    where: { id: countId },
    include: {
      locations: {
        include: { location: { select: { id: true, code: true } }, entries: true },
      },
    },
  });
  if (!count) throw new CountError('Stock count not found', 404);

  const finished = count.locations.filter(l => l.countedAt);
  const finishedIds = new Set(finished.map(l => l.locationId));

  // Per batch: what the system had and what was counted, per finished location
  const perBatch = new Map<string, { expected: Place[]; counted: Place[]; firstCountedAt: Date }>();
  const slot = (batchId: string, at: Date) => {
    let s = perBatch.get(batchId);
    if (!s) { s = { expected: [], counted: [], firstCountedAt: at }; perBatch.set(batchId, s); }
    if (at < s.firstCountedAt) s.firstCountedAt = at;
    return s;
  };
  for (const cl of finished) {
    const at = cl.countedAt!;
    for (const e of (cl.expected as { batchId: string; quantity: number }[] | null) ?? []) {
      slot(e.batchId, at).expected.push({ locationId: cl.locationId, code: cl.location.code, quantity: e.quantity });
    }
    for (const e of cl.entries) {
      slot(e.batchId, at).counted.push({ locationId: cl.locationId, code: cl.location.code, quantity: e.quantity });
    }
  }

  const ids = [...perBatch.keys()];
  const batches = await db.itemBatch.findMany({
    where: { id: { in: ids } },
    include: { batchLocations: { include: { location: { select: { code: true } } } } },
  });
  const earliest = finished.reduce<Date | null>((min, l) => (!min || l.countedAt! < min ? l.countedAt! : min), null);
  const laterMoves = earliest
    ? await db.transaction.findMany({ where: { batchId: { in: ids }, createdAt: { gt: earliest } }, select: { batchId: true, createdAt: true } })
    : [];

  const lines: ReviewLine[] = [];
  for (const b of batches) {
    const s = perBatch.get(b.id)!;
    const sum = (p: Place[]) => round3(p.reduce((t, x) => t + x.quantity, 0));
    const expectedTotal = sum(s.expected);
    const countedTotal = sum(s.counted);
    const elsewhere = b.batchLocations
      .filter(bl => !finishedIds.has(bl.locationId) && bl.quantity > 0)
      .map(bl => ({ locationId: bl.locationId, code: bl.location.code, quantity: bl.quantity }));
    const placedTotal = b.batchLocations.reduce((t, bl) => t + bl.quantity, 0);
    const unplaced = Math.max(0, round3(b.quantity - placedTotal));

    let type: LineType;
    if (expectedTotal > 0 && countedTotal > 0) {
      const key = (p: Place[]) => p.map(x => x.locationId).sort().join(',');
      const sameQty = s.counted.every(c => Math.abs(c.quantity - (s.expected.find(e => e.locationId === c.locationId)?.quantity ?? -1)) < 0.001);
      type = key(s.expected) !== key(s.counted) ? 'MOVED' : sameQty ? 'MATCH' : 'QTY_CHANGE';
    } else if (expectedTotal > 0) {
      type = 'MISSING';
    } else {
      type = 'FOUND';
    }

    let resolutions: Resolution[];
    let defaultResolution: Resolution;
    if (type === 'MATCH') { resolutions = []; defaultResolution = 'SKIP'; }
    else if (type === 'MISSING') {
      resolutions = ['WRITE_OFF', 'UNPLACE', 'SKIP'];
      // In a full stock take a missing item is gone; in a partial count it may sit on an uncounted shelf
      defaultResolution = count.wholeWarehouse ? 'WRITE_OFF' : 'UNPLACE';
    } else if (type === 'FOUND') {
      resolutions = elsewhere.length > 0 ? ['MOVE_HERE', 'ADD', 'SKIP'] : ['ADD', 'SKIP'];
      defaultResolution = elsewhere.length > 0 ? 'MOVE_HERE' : 'ADD';
    } else {
      resolutions = ['APPLY', 'SKIP'];
      defaultResolution = 'APPLY';
    }

    lines.push({
      batchId: b.id, batchCode: b.batchCode, description: itemDescription(b), uom: b.uom, unit: unitLabel(b.uom),
      status: b.status, systemQty: b.quantity, type,
      expected: s.expected.sort(byCode), counted: s.counted.sort(byCode), elsewhere: elsewhere.sort(byCode), unplaced,
      resolutions, defaultResolution,
      conflict: type !== 'MATCH' && laterMoves.some(t => t.batchId === b.id && t.createdAt > s.firstCountedAt),
    });
  }

  const order: LineType[] = ['MISSING', 'FOUND', 'QTY_CHANGE', 'MOVED', 'MATCH'];
  lines.sort((a, b) => order.indexOf(a.type) - order.indexOf(b.type) || a.batchCode.localeCompare(b.batchCode));
  return {
    count,
    finishedIds,
    lines,
    finishedLocations: finished.length,
    unfinishedLocations: count.locations.length - finished.length,
  };
}

// GET /api/stock-counts/:id/review — differences between counted and system stock
router.get('/:id/review', COUNT, async (req: Request, res: Response) => {
  await run(res, async () => {
    const r = await buildReview(prisma, req.params.id as string);
    const summary: Record<string, number> = { MATCH: 0, QTY_CHANGE: 0, MOVED: 0, MISSING: 0, FOUND: 0 };
    for (const l of r.lines) summary[l.type]++;
    return {
      countNumber: r.count.countNumber, status: r.count.status, wholeWarehouse: r.count.wholeWarehouse,
      finishedLocations: r.finishedLocations, unfinishedLocations: r.unfinishedLocations,
      summary, conflicts: r.lines.filter(l => l.conflict).length,
      lines: r.lines,
    };
  });
});

// POST /api/stock-counts/:id/approve — apply the corrections (body: { resolutions: { [batchId]: Resolution } })
router.post('/:id/approve', APPROVE, async (req: Request, res: Response) => {
  const chosen: Record<string, string> = req.body?.resolutions && typeof req.body.resolutions === 'object' ? req.body.resolutions : {};

  await run(res, async () => prisma.$transaction(async (tx) => {
    const count = await openCount(tx, req.params.id as string);
    const review = await buildReview(tx, count.id);
    if (review.finishedLocations === 0) throw new CountError('No location has been finished yet, so there is nothing to approve.');

    const userId = req.user!.userId;
    const result = { applied: 0, skipped: 0, conflicts: 0, unitsAdded: 0, unitsRemoved: 0, moved: 0, writtenOff: 0 };
    const log = (batchId: string, data: Omit<Prisma.TransactionUncheckedCreateInput, 'batchId' | 'operatorId' | 'referenceType' | 'referenceId'>) =>
      tx.transaction.create({ data: { batchId, operatorId: userId, referenceType: 'STOCK_COUNT', referenceId: count.countNumber, ...data } });

    for (const line of review.lines) {
      if (line.type === 'MATCH') continue;
      if (line.conflict) { result.conflicts++; continue; }
      const resolution = (chosen[line.batchId] ?? line.defaultResolution) as Resolution;
      if (!line.resolutions.includes(resolution)) throw new CountError(`${line.batchCode}: "${resolution}" is not a valid choice.`);
      if (resolution === 'SKIP') { result.skipped++; continue; }

      const batch = await tx.itemBatch.findUnique({ where: { id: line.batchId }, include: { batchLocations: true } });
      if (!batch) continue;
      const expectedTotal = line.expected.reduce((t, p) => t + p.quantity, 0);
      const countedTotal = line.counted.reduce((t, p) => t + p.quantity, 0);
      const elsewhereTotal = line.elsewhere.reduce((t, p) => t + p.quantity, 0);

      let newQty = batch.quantity;
      if (line.type === 'QTY_CHANGE' || line.type === 'MOVED') newQty = batch.quantity - expectedTotal + countedTotal;
      else if (line.type === 'MISSING' && resolution === 'WRITE_OFF') newQty = batch.quantity - expectedTotal;
      else if (line.type === 'FOUND') {
        const available = line.unplaced + (resolution === 'MOVE_HERE' ? elsewhereTotal : 0);
        newQty = batch.quantity + Math.max(0, countedTotal - available);
      }
      newQty = Math.max(0, round3(newQty));

      // Placements: counted locations now hold exactly what was counted
      await tx.batchLocation.deleteMany({ where: { batchId: batch.id, locationId: { in: [...review.finishedIds] } } });
      if (line.type === 'FOUND' && resolution === 'MOVE_HERE') {
        await tx.batchLocation.deleteMany({ where: { batchId: batch.id, locationId: { in: line.elsewhere.map(p => p.locationId) } } });
      }
      if (newQty <= 0.001) {
        await tx.batchLocation.deleteMany({ where: { batchId: batch.id } });
      } else if (line.type !== 'MISSING') {
        await tx.batchLocation.createMany({
          data: line.counted.map(p => ({ batchId: batch.id, locationId: p.locationId, quantity: p.quantity, assignedBy: userId })),
        });
      }

      const status = newQty <= 0.001 ? 'OUT' : batch.status === 'OUT' ? 'IN_STOCK' : batch.status;
      if (newQty !== batch.quantity || status !== batch.status) {
        await tx.itemBatch.update({ where: { id: batch.id }, data: { quantity: newQty, status } });
      }

      const where = (p: Place[]) => p.map(x => `${x.code} (${x.quantity})`).join(', ');
      if (Math.abs(newQty - batch.quantity) > 0.0005) {
        const gained = newQty > batch.quantity;
        const diff = round3(Math.abs(newQty - batch.quantity));
        if (gained) result.unitsAdded += diff; else result.unitsRemoved += diff;
        if (line.type === 'MISSING') result.writtenOff++;
        await log(batch.id, {
          type: gained ? 'STOCK_IN' : 'STOCK_OUT', quantityMoved: diff, previousQuantity: batch.quantity, newQuantity: newQty,
          notes: line.type === 'MISSING'
            ? `Stock count ${count.countNumber}: not found on ${where(line.expected)}; written off`
            : `Stock count ${count.countNumber}: counted ${round3(countedTotal)} on ${where(line.counted)}, system had ${round3(line.type === 'FOUND' ? 0 : expectedTotal)} there`,
        });
      }
      const movedTo = line.counted[0];
      if (line.type === 'MOVED' || (line.type === 'FOUND' && (resolution === 'MOVE_HERE' || line.unplaced > 0)) || (line.type === 'MISSING' && resolution === 'UNPLACE')) {
        result.moved++;
        await log(batch.id, {
          type: 'INTERNAL_TRANSFER', quantityMoved: round3(line.type === 'MISSING' ? expectedTotal : countedTotal),
          fromLocationId: (line.expected[0] ?? (resolution === 'MOVE_HERE' ? line.elsewhere[0] : undefined))?.locationId ?? null,
          toLocationId: line.type === 'MISSING' ? null : movedTo?.locationId ?? null,
          notes: line.type === 'MISSING'
            ? `Stock count ${count.countNumber}: not found on ${where(line.expected)}; moved to the put-away queue`
            : `Stock count ${count.countNumber}: found on ${where(line.counted)}${line.expected.length ? `, system had it on ${where(line.expected)}` : resolution === 'MOVE_HERE' ? `, system had it on ${where(line.elsewhere)}` : ', system had it unplaced'}`,
        });
      }
      result.applied++;
    }

    result.unitsAdded = round3(result.unitsAdded);
    result.unitsRemoved = round3(result.unitsRemoved);
    await tx.stockCount.update({
      where: { id: count.id },
      data: { status: 'COMPLETED', closedById: userId, closedAt: new Date(), resultSummary: result },
    });
    return { success: true, ...result, unfinishedLocations: review.unfinishedLocations };
  }, { timeout: 60_000 }));
});

export default router;
