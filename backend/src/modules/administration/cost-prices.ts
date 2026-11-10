import { Router, Request, Response } from 'express';
import argon2 from 'argon2';
import { Prisma } from '@prisma/client';
import prisma from '../../lib/prisma';
import { requireAuth, requireCostAccess, requireCostUnlock, signCostUnlockToken, COST_UNLOCK_MINUTES } from '../../middleware/auth';
import { costLetters, decodeCost, encodeCost, normaliseCostCodeConfig, type CostCodeConfig } from '../../utils/cost-code';
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
  return row ? { codeWord: row.codeWord } : null;
}
export const costCodeConfig = loadConfig;

type Roll = { id: string; poLineId: string | null };

/**
 * A roll's cost per unit in rupees, or null. A roll received against a PO line takes that line's
 * cost; a roll received without a PO takes its own (Direct Inward Excel); a roll created by a
 * customer return takes the cost of the roll it was shipped from. Never sent to a screen.
 */
async function costOfRoll(roll: Roll): Promise<number | null> {
  let current: Roll | null = roll;
  for (let hops = 0; current && hops < 6; hops++) {
    if (current.poLineId) {
      const cost = await prisma.poLineCost.findUnique({ where: { poLineId: current.poLineId } });
      return cost ? Number(cost.costPrice) : null;
    }
    const own = await prisma.batchCost.findUnique({ where: { batchId: current.id } });
    if (own) return Number(own.costPrice);
    const returned: { dcLine: { batch: Roll } } | null = await prisma.customerReturnLine.findFirst({
      where: { batchId: current.id },
      select: { dcLine: { select: { batch: { select: { id: true, poLineId: true } } } } },
    });
    current = returned?.dcLine.batch ?? null;
  }
  return null;
}

/** The same for many rolls at once: roll id → cost (rolls without a cost are left out). */
export async function costsOfRolls(rolls: Roll[]): Promise<Map<string, number>> {
  const result = new Map<string, number>();
  if (rolls.length === 0) return result;
  const lineIds = [...new Set(rolls.map(r => r.poLineId).filter((id): id is string => !!id))];
  const lineCosts = new Map((lineIds.length ? await prisma.poLineCost.findMany({ where: { poLineId: { in: lineIds } } }) : [])
    .map(c => [c.poLineId, Number(c.costPrice)]));
  const withoutLine = rolls.filter(r => !r.poLineId).map(r => r.id);
  const ownCosts = new Map((withoutLine.length ? await prisma.batchCost.findMany({ where: { batchId: { in: withoutLine } } }) : [])
    .map(c => [c.batchId, Number(c.costPrice)]));
  const rest: string[] = [];
  for (const r of rolls) {
    const cost = r.poLineId ? lineCosts.get(r.poLineId) : ownCosts.get(r.id);
    if (cost !== undefined) result.set(r.id, cost);
    else if (!r.poLineId) rest.push(r.id);
  }
  // Rolls made by a customer return (few): followed back one by one
  if (rest.length) {
    const returned = await prisma.customerReturnLine.findMany({ where: { batchId: { in: rest } }, select: { batchId: true } });
    for (const { batchId } of returned) {
      const cost = await costOfRoll({ id: batchId, poLineId: null });
      if (cost !== null) result.set(batchId, cost);
    }
  }
  return result;
}

/** The secret cost code for a roll's label ('' when no code word is set or no cost was entered). */
export async function costCodeForBatch(batch: { id: string; poLineId: string | null; batchCode: string }): Promise<string> {
  const config = await loadConfig();
  if (!config) return '';
  const costPrice = await costOfRoll(batch);
  // Decoys are chosen for the roll being labelled, so each roll's code looks different
  return costPrice !== null ? encodeCost(costPrice, config, batch.batchCode) : '';
}

// ─── Unlock ─────────────────────────────────────────────────────────────────

const failedUnlocks = new Map<string, { count: number; lockedUntil: number }>();
const MAX_UNLOCK_ATTEMPTS = 5;

/**
 * Checks a user's own password before a confidential action, and refuses after too many wrong
 * tries. Returns the refusal, or null when the password is right.
 */
export async function ownPasswordRefusal(userId: string, username: string, password: unknown): Promise<{ status: number; error: string } | null> {
  const record = failedUnlocks.get(userId);
  if (record && Date.now() < record.lockedUntil) {
    return { status: 429, error: `Too many wrong passwords. Try again in ${Math.ceil((record.lockedUntil - Date.now()) / 60000)} minute(s).` };
  }
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { passwordHash: true } });
  const valid = Boolean(user && password && await argon2.verify(user.passwordHash, String(password)));
  if (!valid) {
    const cur = record ?? { count: 0, lockedUntil: 0 };
    cur.count++;
    if (cur.count >= MAX_UNLOCK_ATTEMPTS) {
      cur.lockedUntil = Date.now() + 15 * 60 * 1000;
      cur.count = 0;
    }
    failedUnlocks.set(userId, cur);
    console.warn(`[COST] Wrong password from '${username}'`);
    return { status: 403, error: 'Incorrect password.' };
  }
  failedUnlocks.delete(userId);
  return null;
}

router.post('/unlock', async (req: Request, res: Response) => {
  const userId = req.user!.userId;
  const refusal = await ownPasswordRefusal(userId, req.user!.username, req.body?.password);
  if (refusal) { res.status(refusal.status).json({ error: refusal.error }); return; }
  res.json({ ...signCostUnlockToken(userId), minutes: COST_UNLOCK_MINUTES });
});

router.use(requireCostUnlock);

// ─── Cost code settings ─────────────────────────────────────────────────────

router.get('/settings', async (_req: Request, res: Response) => {
  const row = await prisma.costCodeSettings.findUnique({ where: { id: 1 } });
  res.json(row
    ? { codeWord: row.codeWord, updatedAt: row.updatedAt }
    : { codeWord: '', updatedAt: null });
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
  res.json(config);
});

// Codes for sample prices with the given (unsaved) settings, or the saved ones
router.post('/preview', async (req: Request, res: Response) => {
  const config = req.body?.settings ? normaliseCostCodeConfig(req.body.settings) : await loadConfig();
  if (!config) { res.status(400).json({ error: 'Set the secret code word first.' }); return; }
  if (typeof config === 'string') { res.status(400).json({ error: config }); return; }
  const prices = (Array.isArray(req.body?.prices) ? req.body.prices : [req.body?.price]).slice(0, 20).map(Number);
  if (prices.length === 0 || prices.some((p: number) => !Number.isFinite(p) || p < 0)) { res.status(400).json({ error: 'Enter a price.' }); return; }
  // The cost letters, and how three different rolls of that cost could look on their labels
  res.json({ codes: prices.map((p: number) => ({
    price: p,
    code: costLetters(p, config),
    examples: [1, 2, 3].map(n => encodeCost(p, config, `example-${p}-${n}`)),
  })) });
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

  // Whole-warehouse figures, not just this page: PO rolls at their line's cost, Direct Inward rolls at their own
  const [valueRow] = await prisma.$queryRaw<{ value: number | null }[]>`
    SELECT (
      COALESCE((SELECT SUM(b.quantity * c.cost_price) FROM item_batches b JOIN po_line_costs c ON c.po_line_id = b."poLineId"
        WHERE b.status::text IN ('IN_STOCK', 'PARTIALLY_USED', 'QC_HOLD') AND b.quantity > 0), 0)
      + COALESCE((SELECT SUM(b.quantity * c.cost_price) FROM item_batches b JOIN batch_costs c ON c.batch_id = b.id
        WHERE b."poLineId" IS NULL AND b.status::text IN ('IN_STOCK', 'PARTIALLY_USED', 'QC_HOLD') AND b.quantity > 0), 0)
    )::float AS value`;
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
        code: cost !== null && config ? costLetters(cost, config) : '',
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
  res.json({ id: line.id, costPrice: newPrice, code: newPrice !== null && config ? costLetters(newPrice, config) : '' });
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
