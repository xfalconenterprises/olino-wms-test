import { Router, Request, Response } from 'express';
import argon2 from 'argon2';
import { Prisma } from '@prisma/client';
import prisma from '../../lib/prisma';
import { requireAuth, requireCostAccess, requireCostUnlock, signCostUnlockToken, COST_UNLOCK_MINUTES } from '../../middleware/auth';
import { decodeCost, encodeCost, normaliseCostCodeConfig, type CostCodeConfig } from '../../utils/cost-code';
import { itemDescription } from '../inventory/returns';

// Confidential cost prices. Costs are entered on PO lines (write-only there) and can only be read
// here: the user needs the Cost Prices permission granted by name, and unlocks the tab by
// re-entering their password. Labels carry the cost only as the secret code.

const router = Router();
router.use(requireAuth, requireCostAccess);

const IN_STOCK = ['IN_STOCK', 'PARTIALLY_USED', 'QC_HOLD'] as const;
const money = (v: Prisma.Decimal | number | null | undefined) => (v === null || v === undefined ? null : Number(v));

// ─── Shared with purchase orders and labels ─────────────────────────────────

/** A cost as typed on a PO line: undefined when left blank, a message when invalid. */
export function parseCostPrice(value: unknown, label: string): number | undefined | string {
  if (value === undefined || value === null || String(value).trim() === '') return undefined;
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0 || n >= 1e10) return `${label}: enter a cost price above 0.`;
  if (Math.abs(n * 100 - Math.round(n * 100)) > 1e-6) return `${label}: cost price can have at most 2 decimals.`;
  return Math.round(n * 100) / 100;
}

export async function logCostChange(
  tx: Prisma.TransactionClient,
  entry: { poId?: string | null; poNumber?: string | null; lineLabel: string; oldPrice?: number | null; newPrice?: number | null; source: string },
  user: { userId: string; name: string },
) {
  await tx.costPriceLog.create({
    data: { ...entry, oldPrice: entry.oldPrice ?? null, newPrice: entry.newPrice ?? null, changedById: user.userId, changedByName: user.name },
  });
}

export function poLineLabel(line: Parameters<typeof itemDescription>[0]): string {
  return itemDescription(line) || line.itemType;
}

async function loadConfig(): Promise<CostCodeConfig | null> {
  const row = await prisma.costCodeSettings.findUnique({ where: { id: 1 } });
  return row ? { codeWord: row.codeWord, repeatLetter: row.repeatLetter, prefix: row.prefix, suffix: row.suffix } : null;
}

/**
 * The secret cost code for a roll's label ('' when no code word is set or no cost was entered).
 * A roll received against a PO line takes that line's cost; a roll created by a customer return
 * takes the cost of the roll it was shipped from.
 */
export async function costCodeForBatch(batch: { id: string; poLineId: string | null }): Promise<string> {
  const config = await loadConfig();
  if (!config) return '';
  let current: { id: string; poLineId: string | null } | null = batch;
  for (let hops = 0; current && !current.poLineId && hops < 5; hops++) {
    const returned: { dcLine: { batch: { id: string; poLineId: string | null } } } | null = await prisma.customerReturnLine.findFirst({
      where: { batchId: current.id },
      select: { dcLine: { select: { batch: { select: { id: true, poLineId: true } } } } },
    });
    current = returned?.dcLine.batch ?? null;
  }
  if (!current?.poLineId) return '';
  const cost = await prisma.poLineCost.findUnique({ where: { poLineId: current.poLineId } });
  return cost ? encodeCost(Number(cost.costPrice), config) : '';
}

// ─── Unlock ─────────────────────────────────────────────────────────────────

const failedUnlocks = new Map<string, { count: number; lockedUntil: number }>();
const MAX_UNLOCK_ATTEMPTS = 5;

router.post('/unlock', async (req: Request, res: Response) => {
  const userId = req.user!.userId;
  const record = failedUnlocks.get(userId);
  if (record && Date.now() < record.lockedUntil) {
    res.status(429).json({ error: `Too many wrong passwords. Try again in ${Math.ceil((record.lockedUntil - Date.now()) / 60000)} minute(s).` });
    return;
  }
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { passwordHash: true } });
  const valid = Boolean(user && req.body?.password && await argon2.verify(user.passwordHash, String(req.body.password)));
  if (!valid) {
    const cur = record ?? { count: 0, lockedUntil: 0 };
    cur.count++;
    if (cur.count >= MAX_UNLOCK_ATTEMPTS) {
      cur.lockedUntil = Date.now() + 15 * 60 * 1000;
      cur.count = 0;
    }
    failedUnlocks.set(userId, cur);
    console.warn(`[COST] Failed unlock for '${req.user!.username}'`);
    res.status(403).json({ error: 'Incorrect password.' });
    return;
  }
  failedUnlocks.delete(userId);
  res.json({ ...signCostUnlockToken(userId), minutes: COST_UNLOCK_MINUTES });
});

router.use(requireCostUnlock);

// ─── Cost code settings ─────────────────────────────────────────────────────

router.get('/settings', async (_req: Request, res: Response) => {
  const row = await prisma.costCodeSettings.findUnique({ where: { id: 1 } });
  res.json(row
    ? { codeWord: row.codeWord, repeatLetter: row.repeatLetter ?? '', prefix: row.prefix ?? '', suffix: row.suffix ?? '', updatedAt: row.updatedAt }
    : { codeWord: '', repeatLetter: '', prefix: '', suffix: '', updatedAt: null });
});

router.put('/settings', async (req: Request, res: Response) => {
  const config = normaliseCostCodeConfig(req.body ?? {});
  if (typeof config === 'string') { res.status(400).json({ error: config }); return; }
  await prisma.$transaction(async (tx) => {
    await tx.costCodeSettings.upsert({
      where: { id: 1 },
      create: { id: 1, ...config, updatedById: req.user!.userId },
      update: { ...config, updatedById: req.user!.userId },
    });
    await logCostChange(tx, { lineLabel: 'Secret code settings changed', source: 'CODE_SETTINGS' }, req.user!);
  });
  res.json({ ...config, repeatLetter: config.repeatLetter ?? '', prefix: config.prefix ?? '', suffix: config.suffix ?? '' });
});

// Codes for sample prices with the given (unsaved) settings, or the saved ones
router.post('/preview', async (req: Request, res: Response) => {
  const config = req.body?.settings ? normaliseCostCodeConfig(req.body.settings) : await loadConfig();
  if (!config) { res.status(400).json({ error: 'Set the secret code word first.' }); return; }
  if (typeof config === 'string') { res.status(400).json({ error: config }); return; }
  const prices = (Array.isArray(req.body?.prices) ? req.body.prices : [req.body?.price]).slice(0, 20).map(Number);
  if (prices.length === 0 || prices.some((p: number) => !Number.isFinite(p) || p < 0)) { res.status(400).json({ error: 'Enter a price.' }); return; }
  res.json({ codes: prices.map((p: number) => ({ price: p, code: encodeCost(p, config) })) });
});

// Reads a code from a label back into rupees
router.post('/decode', async (req: Request, res: Response) => {
  const config = await loadConfig();
  if (!config) { res.status(400).json({ error: 'Set the secret code word first.' }); return; }
  const price = decodeCost(String(req.body?.code ?? ''), config);
  if (price === null) { res.status(400).json({ error: 'That is not a valid code for the current code word.' }); return; }
  res.json({ price });
});

// ─── PO line costs ──────────────────────────────────────────────────────────

const PAGE_SIZE = 50;

router.get('/lines', async (req: Request, res: Response) => {
  const search = String(req.query.search ?? '').trim();
  const missing = req.query.missing === '1' || req.query.missing === 'true';
  const page = Math.max(1, parseInt(String(req.query.page ?? '1'), 10) || 1);

  const contains = (field: string) => ({ [field]: { contains: search, mode: 'insensitive' } });
  const where: Prisma.PurchaseOrderLineWhereInput = {
    po: { isDeleted: false, status: { not: 'CANCELLED' } },
    ...(missing && { cost: { is: null } }),
    ...(search && {
      OR: [
        { po: { OR: [contains('poNumber'), contains('supplierName')] } },
        ...['brand', 'quality', 'qualityName', 'shade', 'name', 'artNo', 'category'].map(contains),
      ] as Prisma.PurchaseOrderLineWhereInput[],
    }),
  };

  const [total, lines] = await Promise.all([
    prisma.purchaseOrderLine.count({ where }),
    prisma.purchaseOrderLine.findMany({
      where,
      include: { cost: true, po: { select: { id: true, poNumber: true, supplierName: true, createdAt: true, status: true } } },
      orderBy: [{ po: { createdAt: 'desc' } }, { createdAt: 'asc' }],
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
    }),
  ]);

  const stock = await prisma.itemBatch.groupBy({
    by: ['poLineId'],
    where: { poLineId: { in: lines.map(l => l.id) }, status: { in: [...IN_STOCK] }, quantity: { gt: 0 } },
    _sum: { quantity: true },
  });
  const inStock = new Map(stock.map(s => [s.poLineId, s._sum.quantity ?? 0]));
  const config = await loadConfig();

  // Whole-warehouse figures, not just this page
  const [valueRow] = await prisma.$queryRaw<{ value: number | null; lines: number }[]>`
    SELECT COALESCE(SUM(b.quantity * c.cost_price), 0)::float AS value, COUNT(DISTINCT c.po_line_id)::int AS lines
    FROM item_batches b JOIN po_line_costs c ON c.po_line_id = b."poLineId"
    WHERE b.status::text IN ('IN_STOCK', 'PARTIALLY_USED', 'QC_HOLD') AND b.quantity > 0`;
  const missingCount = await prisma.purchaseOrderLine.count({
    where: { po: { isDeleted: false, status: { not: 'CANCELLED' } }, cost: { is: null } },
  });

  res.json({
    page, pageSize: PAGE_SIZE, total,
    summary: { stockValue: Math.round((valueRow?.value ?? 0) * 100) / 100, missingCount, codeWordSet: Boolean(config) },
    lines: lines.map(l => {
      const cost = money(l.cost?.costPrice);
      const qty = Math.round((inStock.get(l.id) ?? 0) * 1000) / 1000;
      return {
        id: l.id,
        poId: l.po.id, poNumber: l.po.poNumber, supplierName: l.po.supplierName, poDate: l.po.createdAt, poStatus: l.po.status,
        itemType: l.itemType, description: poLineLabel(l), uom: l.uom,
        orderedQty: l.orderedQty, receivedQty: l.receivedQty, inStockQty: qty,
        costPrice: cost,
        code: cost !== null && config ? encodeCost(cost, config) : '',
        stockValue: cost !== null ? Math.round(cost * qty * 100) / 100 : null,
        updatedAt: l.cost?.updatedAt ?? null,
      };
    }),
  });
});

router.put('/lines/:lineId', async (req: Request, res: Response) => {
  const line = await prisma.purchaseOrderLine.findUnique({
    where: { id: String(req.params.lineId) },
    include: { cost: true, po: { select: { id: true, poNumber: true, isDeleted: true } } },
  });
  if (!line || line.po.isDeleted) { res.status(404).json({ error: 'PO line not found' }); return; }

  const clearing = req.body?.costPrice === null || String(req.body?.costPrice ?? '').trim() === '';
  const parsed = clearing ? undefined : parseCostPrice(req.body.costPrice, 'Cost price');
  if (typeof parsed === 'string') { res.status(400).json({ error: parsed }); return; }

  const oldPrice = money(line.cost?.costPrice);
  const newPrice = parsed ?? null;
  if (oldPrice !== newPrice) {
    await prisma.$transaction(async (tx) => {
      if (newPrice === null) await tx.poLineCost.deleteMany({ where: { poLineId: line.id } });
      else await tx.poLineCost.upsert({
        where: { poLineId: line.id },
        create: { poLineId: line.id, costPrice: newPrice, updatedById: req.user!.userId },
        update: { costPrice: newPrice, updatedById: req.user!.userId },
      });
      await logCostChange(tx, { poId: line.po.id, poNumber: line.po.poNumber, lineLabel: poLineLabel(line), oldPrice, newPrice, source: 'COST_TAB' }, req.user!);
    });
  }
  const config = await loadConfig();
  res.json({ id: line.id, costPrice: newPrice, code: newPrice !== null && config ? encodeCost(newPrice, config) : '' });
});

// ─── Change log ─────────────────────────────────────────────────────────────

router.get('/logs', async (req: Request, res: Response) => {
  const page = Math.max(1, parseInt(String(req.query.page ?? '1'), 10) || 1);
  const [total, rows] = await Promise.all([
    prisma.costPriceLog.count(),
    prisma.costPriceLog.findMany({ orderBy: { changedAt: 'desc' }, skip: (page - 1) * PAGE_SIZE, take: PAGE_SIZE }),
  ]);
  res.json({
    page, pageSize: PAGE_SIZE, total,
    logs: rows.map(r => ({ ...r, oldPrice: money(r.oldPrice), newPrice: money(r.newPrice) })),
  });
});

export default router;
