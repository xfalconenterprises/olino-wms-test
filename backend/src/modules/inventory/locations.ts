import { Router, Request, Response } from 'express';
import type { Prisma } from '@prisma/client';
import prisma from '../../lib/prisma';
import { requireAuth, requirePermission } from '../../middleware/auth';
import { code128Png, code128Svg, BARCODE_HEIGHT_MM, BARCODE_X_MM } from '../../utils/barcode';
import { createZip, type ZipEntry } from '../../utils/zip';

const router = Router();
router.use(requireAuth);

// ─── Layout rules ───────────────────────────────────────────────────────────
// Rack (A, B, C…) → Bay (B1, B2…) → Level (L1 = bottom shelf) → Position (P1, P2…).
// Code: "A-B1-L1-P1". Every level of a bay has the same number of positions.

const RACK_NAME = /^[A-Z0-9]{1,5}$/;
const RACK_CODE = /^[A-Z0-9]{1,5}-B\d+-L\d+-P\d+$/;
const MAX_BAYS_PER_REQUEST = 50;
const MAX_LEVELS = 20;
const MAX_POSITIONS = 50;

type Tx = Prisma.TransactionClient;

/** A layout change that can't be made; the message is shown to the user as-is. */
class LayoutError extends Error {}

export function rackLocationCode(rack: string, bay: number, level: number, position: number): string {
  return `${rack}-B${bay}-L${level}-P${position}`;
}

interface BaySize { levels: number; positions: number }

/** Reads `levels` and `positions` from a request body; null when either is out of range. */
function parseBaySize(body: any): BaySize | null {
  const levels = parseCount(body.levels, 1, MAX_LEVELS);
  const positions = parseCount(body.positions, 3, MAX_POSITIONS);
  return levels === null || positions === null ? null : { levels, positions };
}

const BAY_SIZE_ERROR = `Levels must be 1–${MAX_LEVELS} and positions per level 1–${MAX_POSITIONS}.`;

function parseCount(value: unknown, fallback: number, max: number): number | null {
  if (value === undefined || value === null || value === '') return fallback;
  const n = Number(value);
  return Number.isInteger(n) && n >= 1 && n <= max ? n : null;
}

// Racks sort A…Z, then AA…; numeric names sort 1…9, 10…
function byRackName(a: { name: string }, b: { name: string }) {
  return a.name.length - b.name.length || a.name.localeCompare(b.name);
}

/**
 * Makes levels 1…L × positions 1…P of a bay active and retires every slot outside that grid
 * (refused while a retiring slot holds stock).
 */
async function syncBaySlots(tx: Tx, bay: { id: string; number: number }, rackName: string, size: BaySize) {
  const existing = await tx.location.findMany({
    where: { bayId: bay.id },
    include: { _count: { select: { batchLocations: true } } },
  });

  const inGrid = (l: { level: number | null; position: number | null }) =>
    (l.level ?? 0) >= 1 && (l.level ?? 0) <= size.levels && (l.position ?? 0) >= 1 && (l.position ?? 0) <= size.positions;
  const retiring = existing.filter(l => l.isActive && !inGrid(l));
  const occupied = retiring.filter(l => l._count.batchLocations > 0);
  if (occupied.length > 0) {
    throw new LayoutError(`${occupied.map(l => l.code).join(', ')} still hold stock. Move it before making the bay smaller.`);
  }
  if (retiring.length > 0) {
    await tx.location.updateMany({ where: { id: { in: retiring.map(l => l.id) } }, data: { isActive: false } });
  }

  const bySlot = new Map(existing.map(l => [`${l.level}-${l.position}`, l]));
  const reactivate: string[] = [];
  const create: Prisma.LocationCreateManyInput[] = [];
  for (let lv = 1; lv <= size.levels; lv++) {
    for (let p = 1; p <= size.positions; p++) {
      const loc = bySlot.get(`${lv}-${p}`);
      if (!loc) create.push({ code: rackLocationCode(rackName, bay.number, lv, p), type: 'BAY', bayId: bay.id, level: lv, position: p });
      else if (!loc.isActive) reactivate.push(loc.id);
    }
  }
  if (reactivate.length > 0) {
    await tx.location.updateMany({ where: { id: { in: reactivate } }, data: { isActive: true } });
  }
  if (create.length > 0) {
    const clash = await tx.location.findFirst({ where: { code: { in: create.map(c => c.code) } } });
    if (clash) throw new LayoutError(`Location code "${clash.code}" is already in use.`);
    await tx.location.createMany({ data: create });
  }

  await tx.bay.update({ where: { id: bay.id }, data: { levels: size.levels, positions: size.positions, isActive: true } });
}

/** Adds `count` bays after the rack's highest active bay; previously removed numbers come back. */
async function appendBays(tx: Tx, rack: { id: string; name: string }, count: number, size: BaySize) {
  const bays = await tx.bay.findMany({ where: { rackId: rack.id } });
  const highestActive = bays.filter(b => b.isActive).reduce((max, b) => Math.max(max, b.number), 0);
  for (let n = highestActive + 1; n <= highestActive + count; n++) {
    const bay = bays.find(b => b.number === n) ?? await tx.bay.create({ data: { rackId: rack.id, number: n, ...size } });
    await syncBaySlots(tx, bay, rack.name, size);
  }
}

async function runLayoutChange(res: Response, change: () => Promise<unknown>, status = 200) {
  try {
    const result = await change();
    res.status(status).json(result ?? { success: true });
  } catch (err: any) {
    if (err instanceof LayoutError) { res.status(400).json({ error: err.message }); return; }
    if (err.code === 'P2002') { res.status(409).json({ error: 'That rack, bay or location already exists.' }); return; }
    console.error('Location layout change failed:', err);
    res.status(500).json({ error: 'Failed to update the location layout' });
  }
}

// ─── Layout ─────────────────────────────────────────────────────────────────

// GET /api/locations/hierarchy — racks with their bays and positions
router.get('/hierarchy', requirePermission('admin.locations'), async (_req: Request, res: Response) => {
  const racks = await prisma.rack.findMany({
    where: { isActive: true },
    include: {
      bays: {
        where: { isActive: true },
        orderBy: { number: 'asc' },
        include: {
          locations: {
            where: { isActive: true },
            orderBy: [{ level: 'asc' }, { position: 'asc' }],
            include: { _count: { select: { batchLocations: true } } },
          },
        },
      },
    },
  });
  res.json(racks.sort(byRackName));
});

// GET /api/locations/floor — all floor spots
router.get('/floor', requirePermission('admin.locations'), async (_req: Request, res: Response) => {
  const spots = await prisma.location.findMany({
    where: { type: 'FLOOR', isActive: true },
    include: {
      _count: { select: { batchLocations: true } },
      batchLocations: {
        include: { batch: true },
      },
    },
    orderBy: { code: 'asc' },
  });
  res.json(spots);
});

// POST /api/locations/racks — add a rack, optionally with its first bays
router.post('/racks', requirePermission('admin.locations'), async (req: Request, res: Response) => {
  const name = String(req.body.name || '').trim().toUpperCase();
  if (!RACK_NAME.test(name)) {
    res.status(400).json({ error: 'Rack name must be 1–5 letters or digits (e.g. A, B, C).' });
    return;
  }
  const bays = req.body.bays === 0 || req.body.bays === '0' ? 0 : parseCount(req.body.bays, 0, MAX_BAYS_PER_REQUEST);
  const size = parseBaySize(req.body);
  if (bays === null) { res.status(400).json({ error: `Bays must be 0–${MAX_BAYS_PER_REQUEST}.` }); return; }
  if (!size) { res.status(400).json({ error: BAY_SIZE_ERROR }); return; }

  const existing = await prisma.rack.findUnique({ where: { name } });
  if (existing?.isActive) { res.status(409).json({ error: `Rack "${name}" already exists` }); return; }

  await runLayoutChange(res, () => prisma.$transaction(async (tx) => {
    const rack = existing
      ? await tx.rack.update({ where: { id: existing.id }, data: { isActive: true } })
      : await tx.rack.create({ data: { name } });
    if (bays > 0) await appendBays(tx, rack, bays, size);
    return rack;
  }), 201);
});

// POST /api/locations/racks/:id/bays — add bays after the rack's last bay
router.post('/racks/:id/bays', requirePermission('admin.locations'), async (req: Request, res: Response) => {
  const count = parseCount(req.body.count, 1, MAX_BAYS_PER_REQUEST);
  const size = parseBaySize(req.body);
  if (count === null) { res.status(400).json({ error: `Bays must be 1–${MAX_BAYS_PER_REQUEST}.` }); return; }
  if (!size) { res.status(400).json({ error: BAY_SIZE_ERROR }); return; }
  const rack = await prisma.rack.findFirst({ where: { id: req.params.id as string, isActive: true } });
  if (!rack) { res.status(404).json({ error: 'Rack not found' }); return; }

  await runLayoutChange(res, () => prisma.$transaction(tx => appendBays(tx, rack, count, size)), 201);
});

// PATCH /api/locations/bays/:id — change a bay's levels and/or positions per level
router.patch('/bays/:id', requirePermission('admin.locations'), async (req: Request, res: Response) => {
  const bay = await prisma.bay.findFirst({ where: { id: req.params.id as string, isActive: true }, include: { rack: true } });
  if (!bay) { res.status(404).json({ error: 'Bay not found' }); return; }
  // Omitted values keep the bay's current size; given values must be valid
  const size = parseBaySize({ levels: req.body.levels ?? bay.levels, positions: req.body.positions ?? bay.positions });
  if (!size) { res.status(400).json({ error: BAY_SIZE_ERROR }); return; }

  await runLayoutChange(res, () => prisma.$transaction(tx => syncBaySlots(tx, bay, bay.rack.name, size)));
});

// DELETE /api/locations/bays/:id — remove an empty bay
router.delete('/bays/:id', requirePermission('admin.locations'), async (req: Request, res: Response) => {
  const bay = await prisma.bay.findFirst({
    where: { id: req.params.id as string, isActive: true },
    include: { locations: { where: { isActive: true }, include: { _count: { select: { batchLocations: true } } } } },
  });
  if (!bay) { res.status(404).json({ error: 'Bay not found' }); return; }
  if (bay.locations.some(l => l._count.batchLocations > 0)) {
    res.status(400).json({ error: 'This bay still holds stock. Move it first.' });
    return;
  }

  await runLayoutChange(res, () => prisma.$transaction([
    prisma.location.updateMany({ where: { bayId: bay.id }, data: { isActive: false } }),
    prisma.bay.update({ where: { id: bay.id }, data: { isActive: false } }),
  ]).then(() => ({ success: true })));
});

// DELETE /api/locations/racks/:id — remove an empty rack with all its bays
router.delete('/racks/:id', requirePermission('admin.locations'), async (req: Request, res: Response) => {
  const rack = await prisma.rack.findFirst({ where: { id: req.params.id as string, isActive: true } });
  if (!rack) { res.status(404).json({ error: 'Rack not found' }); return; }
  const stocked = await prisma.location.count({
    where: { isActive: true, bay: { rackId: rack.id }, batchLocations: { some: {} } },
  });
  if (stocked > 0) {
    res.status(400).json({ error: `Rack ${rack.name} still holds stock in ${stocked} position(s). Move it first.` });
    return;
  }

  await runLayoutChange(res, () => prisma.$transaction([
    prisma.location.updateMany({ where: { bay: { rackId: rack.id } }, data: { isActive: false } }),
    prisma.bay.updateMany({ where: { rackId: rack.id }, data: { isActive: false } }),
    prisma.rack.update({ where: { id: rack.id }, data: { isActive: false } }),
  ]).then(() => ({ success: true })));
});

// POST /api/locations/floor — add a floor spot
router.post('/floor', requirePermission('admin.locations'), async (req: Request, res: Response) => {
  const { code } = req.body;

  let floorCode = code ? String(code).trim().toUpperCase() : '';
  if (floorCode && (!/^[A-Z0-9-]{1,30}$/.test(floorCode) || RACK_CODE.test(floorCode))) {
    res.status(400).json({ error: 'Floor spot codes may only contain letters, numbers and hyphens (max 30), and cannot look like a rack code' });
    return;
  }
  if (!floorCode) {
    const lastFloor = await prisma.location.findFirst({
      where: { type: 'FLOOR' },
      orderBy: { code: 'desc' },
    });
    const lastNum = lastFloor ? parseInt(lastFloor.code.replace('FR-', ''), 10) : 0;
    floorCode = `FR-${String(lastNum + 1).padStart(2, '0')}`;
  }

  const existing = await prisma.location.findUnique({ where: { code: floorCode } });
  if (existing) { res.status(409).json({ error: `Location "${floorCode}" already exists` }); return; }

  const location = await prisma.location.create({
    data: {
      code: floorCode,
      type: 'FLOOR',
    },
  });

  res.status(201).json(location);
});

// ─── Barcodes for label designers ───────────────────────────────────────────

interface ExportRow { code: string; type: 'RACK' | 'FLOOR'; rack: string; bay: string; level: string; position: string }

function csvLine(values: string[]): string {
  return values.map(v => (/[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v)).join(',');
}

const DESIGNER_README = `OLINO WMS — LOCATION BARCODES
==============================

locations.csv   One row per location. Use it for data merge / print merge in your
                label software (CorelDRAW, InDesign, Illustrator, BarTender...).
svg/            Vector barcode per location (best quality). File name = location code.
png/            Same barcodes as high-resolution PNG (609.6 dpi).

Columns
  Location Code   Text to print in large letters on the label (e.g. A-B1-L1-P1).
  Barcode Value   What the barcode encodes. Same as the location code.
  @Barcode SVG    Relative path of the SVG barcode (InDesign uses "@" for image fields).
  @Barcode PNG    Relative path of the PNG barcode.
  Some programs need full paths: unzip first and replace the folder prefix.

Barcode specification
  Symbology       Code 128
  Narrow bar (X)  ${BARCODE_X_MM} mm (3 dots on a 203 dpi printer)
  Height          ${BARCODE_HEIGHT_MM} mm as supplied
  Quiet zone      10 bars (about ${(10 * BARCODE_X_MM).toFixed(2)} mm) of white space on both sides, already
                  included in the files

Rules so the labels scan reliably
  1. Keep the barcode WIDTH at 100%. You may change the height, never stretch or
     squash the width. If it must be smaller, use 2/3 (X = 0.25 mm) at most.
  2. Keep the white space on the left and right of the bars clear of borders,
     text and graphics.
  3. Print black bars on a white or very light background only.
  4. Print the location code as readable text near the barcode.
  5. If you generate barcodes in your own software instead, encode exactly the
     "Barcode Value" column as Code 128.
  6. Test-scan a printed sample before printing the whole batch.
`;

// GET /api/locations/export?rackId=… — ZIP for label designers: location list, barcodes, instructions.
// Without rackId: every active rack position plus floor spots.
router.get('/export', requirePermission('admin.locations'), async (req: Request, res: Response) => {
  const rackId = typeof req.query.rackId === 'string' && req.query.rackId ? req.query.rackId : null;

  const racks = await prisma.rack.findMany({
    where: { isActive: true, ...(rackId && { id: rackId }) },
    include: {
      bays: {
        where: { isActive: true },
        orderBy: { number: 'asc' },
        include: { locations: { where: { isActive: true }, orderBy: [{ level: 'asc' }, { position: 'asc' }] } },
      },
    },
  });
  if (rackId && racks.length === 0) { res.status(404).json({ error: 'Rack not found' }); return; }

  const rows: ExportRow[] = [];
  for (const rack of racks.sort(byRackName)) {
    for (const bay of rack.bays) {
      for (const loc of bay.locations) {
        rows.push({ code: loc.code, type: 'RACK', rack: rack.name, bay: `B${bay.number}`, level: `L${loc.level}`, position: `P${loc.position}` });
      }
    }
  }
  if (!rackId) {
    const floor = await prisma.location.findMany({ where: { type: 'FLOOR', isActive: true }, orderBy: { code: 'asc' } });
    for (const loc of floor) rows.push({ code: loc.code, type: 'FLOOR', rack: '', bay: '', level: '', position: '' });
  }
  if (rows.length === 0) { res.status(404).json({ error: 'No locations to export' }); return; }

  const header = ['Location Code', 'Type', 'Rack', 'Bay', 'Level', 'Position', 'Barcode Value', '@Barcode SVG', '@Barcode PNG'];
  const csv = '﻿' + [header, ...rows.map(r => [
    r.code, r.type, r.rack, r.bay, r.level, r.position, r.code, `svg/${r.code}.svg`, `png/${r.code}.png`,
  ])].map(csvLine).join('\r\n') + '\r\n';

  const scope = rackId ? `rack-${racks[0].name}` : 'all';
  const baseName = `olino-locations-${scope}-${new Date().toISOString().slice(0, 10)}`;

  try {
    const entries: ZipEntry[] = [
      { name: 'README.txt', data: DESIGNER_README.replace(/\n/g, '\r\n') },
      { name: 'locations.csv', data: csv },
    ];
    for (const r of rows) {
      entries.push({ name: `svg/${r.code}.svg`, data: code128Svg(r.code) });
      entries.push({ name: `png/${r.code}.png`, data: await code128Png(r.code) });
    }
    res.set('Content-Type', 'application/zip');
    res.set('Content-Disposition', `attachment; filename="${baseName}.zip"`);
    res.send(createZip(entries));
  } catch (err) {
    console.error('Location barcode export failed:', err);
    res.status(500).json({ error: 'Failed to generate the barcode export' });
  }
});

// GET /api/locations/barcode/:code?format=svg|png — one location's barcode
router.get('/barcode/:code', requirePermission('admin.locations'), async (req: Request, res: Response) => {
  const location = await prisma.location.findUnique({ where: { code: String(req.params.code).toUpperCase() } });
  if (!location) { res.status(404).json({ error: 'Location not found' }); return; }

  try {
    if (req.query.format === 'png') {
      res.set('Content-Type', 'image/png');
      res.set('Content-Disposition', `inline; filename="${location.code}.png"`);
      res.send(await code128Png(location.code));
    } else {
      res.set('Content-Type', 'image/svg+xml');
      res.set('Content-Disposition', `inline; filename="${location.code}.svg"`);
      res.send(code128Svg(location.code));
    }
  } catch (err) {
    console.error('Location barcode failed:', err);
    res.status(500).json({ error: 'Failed to generate barcode' });
  }
});

// ─── Querying & Assigning ──────────────────────────────────────────────────

// GET /api/locations/by-code/:code — scan lookup
router.get('/by-code/:code', requirePermission('ops.put_away', 'ops.dock_queue', 'admin.locations'), async (req: Request, res: Response) => {
  const location = await prisma.location.findUnique({
    where: { code: (req.params.code as string).trim().toUpperCase() },
    include: {
      bay: { include: { rack: true } },
      batchLocations: {
        include: {
          batch: true,
          operator: { select: { name: true } },
        },
        orderBy: { assignedAt: 'desc' },
      },
    },
  });
  if (!location) { res.status(404).json({ error: 'Location not found' }); return; }
  res.json(location);
});

// POST /api/locations/assign — unified transactional put-away with audit logging
router.post('/assign', requirePermission('ops.put_away', 'ops.dock_queue'), async (req: Request, res: Response) => {
  const batchCode = (req.body.batchCode || '').trim();
  const locationCode = (req.body.locationCode || '').trim().toUpperCase();
  const quantity = req.body.quantity;

  if (!batchCode || !locationCode || quantity === undefined || quantity === null) {
    res.status(400).json({ error: 'batchCode, locationCode, and quantity are required' });
    return;
  }

  const numQty = parseFloat(quantity);
  if (isNaN(numQty) || numQty <= 0) {
    res.status(400).json({ error: 'quantity must be a positive number' });
    return;
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
      // 1. Validate Batch
      const batch = await tx.itemBatch.findUnique({
        where: { batchCode },
        include: { batchLocations: true },
      });
      if (!batch) throw new Error(`Batch code "${batchCode}" not found in inventory`);
      if (batch.status === 'OUT' || batch.quantity <= 0) {
        throw new Error(`Batch "${batchCode}" is already stocked out or depleted`);
      }

      // 2. Validate Location
      const location = await tx.location.findUnique({
        where: { code: locationCode },
      });
      if (!location) throw new Error(`Location "${locationCode}" not found`);
      if (!location.isActive) throw new Error(`Location "${locationCode}" has been removed from the layout`);

      // 3. Check Quantity
      const currentlyAssigned = batch.batchLocations.reduce((sum, bl) => sum + bl.quantity, 0);
      const availableToAssign = parseFloat((batch.quantity - currentlyAssigned).toFixed(2));

      if (numQty > availableToAssign + 0.001) {
        throw new Error(`Cannot assign ${numQty}. Only ${availableToAssign} left to assign from this batch (Batch total: ${batch.quantity}, already placed: ${currentlyAssigned}).`);
      }

      // 4. Upsert BatchLocation
      let batchLoc = await tx.batchLocation.findFirst({
        where: { batchId: batch.id, locationId: location.id },
      });

      if (batchLoc) {
        batchLoc = await tx.batchLocation.update({
          where: { id: batchLoc.id },
          data: {
            quantity: { increment: numQty },
            assignedAt: new Date(),
            assignedBy: req.user!.userId,
          },
        });
      } else {
        batchLoc = await tx.batchLocation.create({
          data: {
            batchId: batch.id,
            locationId: location.id,
            quantity: numQty,
            assignedBy: req.user!.userId,
          },
        });
      }

      // 5. Create Transaction audit record
      await tx.transaction.create({
        data: {
          batchId: batch.id,
          type: 'INTERNAL_TRANSFER',
          quantityMoved: numQty,
          operatorId: req.user!.userId,
          fromLocationId: null,
          toLocationId: location.id,
          referenceType: 'PUT_AWAY',
          notes: `Stock put-away: assigned ${numQty} ${batch.uom.toLowerCase()} to ${location.code}`,
        },
      });

      return {
        batchLocation: batchLoc,
        batchCode: batch.batchCode,
        locationCode: location.code,
        quantityAssigned: numQty,
        remainingUnassigned: Math.max(0, parseFloat((availableToAssign - numQty).toFixed(2))),
      };
    });

    res.status(201).json({ success: true, ...result });
  } catch (err: any) {
    res.status(400).json({ error: err.message || 'Failed to assign location' });
  }
});

export default router;
